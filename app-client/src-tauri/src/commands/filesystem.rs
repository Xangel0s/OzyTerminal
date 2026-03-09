use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use russh_sftp::client::{fs::DirEntry, SftpSession};
use serde::Deserialize;
use serde::Serialize;
use tokio::sync::broadcast;

use crate::commands::storage::{record_remote_sftp_navigation, record_sftp_navigation};
use crate::core::ssh_client::{establish_authenticated_session, SshSessionRequest, TerminalEvent};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryEntry {
    pub name: String,
    pub path: String,
    pub modified_at: Option<u64>,
    pub size_bytes: Option<u64>,
    pub kind: String,
    pub entry_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryResponse {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<LocalDirectoryEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectoryRequest {
    pub request: SshSessionRequest,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectoryResponse {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<LocalDirectoryEntry>,
}

#[tauri::command]
pub fn list_local_directory_command(path: String) -> Result<LocalDirectoryResponse, String> {
    let current_path = PathBuf::from(path.trim());
    if !current_path.exists() {
        return Err("la ruta local no existe".into());
    }

    if !current_path.is_dir() {
        return Err("la ruta local no es un directorio".into());
    }

    let mut entries = fs::read_dir(&current_path)
        .map_err(|err| err.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let entry_path = entry.path();
            let metadata = fs::symlink_metadata(&entry_path).ok()?;
            let file_type = metadata.file_type();
            let entry_type = if file_type.is_dir() {
                "folder"
            } else if file_type.is_symlink() {
                "link"
            } else {
                "file"
            };
            let kind = if entry_type == "folder" {
                "folder".to_string()
            } else if entry_type == "link" {
                "link".to_string()
            } else {
                entry_path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.to_ascii_lowercase())
                    .filter(|extension| !extension.is_empty())
                    .unwrap_or_else(|| "file".to_string())
            };

            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs());

            Some(LocalDirectoryEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: normalize_path(&entry_path, entry_type == "folder"),
                modified_at,
                size_bytes: if entry_type == "file" {
                    Some(metadata.len())
                } else {
                    None
                },
                kind,
                entry_type: entry_type.to_string(),
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        entry_rank(&left.entry_type)
            .cmp(&entry_rank(&right.entry_type))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    let parent_path = current_path
        .parent()
        .filter(|parent| *parent != current_path.as_path())
        .map(|parent| normalize_path(parent, true));

    let response = LocalDirectoryResponse {
        current_path: normalize_path(&current_path, true),
        parent_path,
        entries,
    };

    record_sftp_navigation(&response.current_path, "local", response.entries.len());

    Ok(response)
}

#[tauri::command]
pub async fn list_remote_directory_command(
    request: SshSessionRequest,
    path: Option<String>,
) -> Result<RemoteDirectoryResponse, String> {
    list_remote_directory(request, path.unwrap_or_else(|| ".".into()))
        .await
        .map_err(|err| err.to_string())
}

async fn list_remote_directory(
    request: SshSessionRequest,
    path: String,
) -> Result<RemoteDirectoryResponse> {
    let (event_tx, _) = broadcast::channel::<TerminalEvent>(8);
    let session = establish_authenticated_session(&request, &event_tx).await?;
    let channel = session
        .channel_open_session()
        .await
        .context("ssh sftp channel open failed")?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .context("ssh sftp subsystem request failed")?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .context("failed to initialize sftp session")?;
    let requested_path = sanitize_remote_path(&path);
    let current_path = sftp
        .canonicalize(requested_path)
        .await
        .context("failed to resolve remote path")?;

    let mut entries = sftp
        .read_dir(current_path.clone())
        .await
        .context("failed to list remote directory")?
        .filter_map(|entry| build_remote_directory_entry(&current_path, entry))
        .collect::<Vec<_>>();

    sort_entries(&mut entries);

    let response = RemoteDirectoryResponse {
        current_path: normalize_remote_path(&current_path, true),
        parent_path: remote_parent_path(&current_path),
        entries,
    };

    record_remote_sftp_navigation(
        &request.host,
        &request.username,
        &response.current_path,
        response.entries.len(),
    );

    let _ = sftp.close().await;

    Ok(response)
}

fn normalize_path(path: &Path, force_trailing_slash: bool) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if force_trailing_slash && !normalized.ends_with('/') {
        normalized.push('/');
    }
    normalized
}

fn entry_rank(entry_type: &str) -> u8 {
    match entry_type {
        "folder" => 0,
        "link" => 1,
        _ => 2,
    }
}

fn sort_entries(entries: &mut [LocalDirectoryEntry]) {
    entries.sort_by(|left, right| {
        entry_rank(&left.entry_type)
            .cmp(&entry_rank(&right.entry_type))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

fn sanitize_remote_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        ".".into()
    } else {
        trimmed.replace('\\', "/")
    }
}

fn normalize_remote_path(path: &str, force_trailing_slash: bool) -> String {
    let mut normalized = path.replace('\\', "/");

    if normalized.is_empty() {
        normalized.push('/');
    }

    if !normalized.starts_with('/') {
        normalized.insert(0, '/');
    }

    if force_trailing_slash {
        if !normalized.ends_with('/') {
            normalized.push('/');
        }
    } else if normalized.len() > 1 {
        normalized = normalized.trim_end_matches('/').to_string();
    }

    normalized
}

fn remote_parent_path(path: &str) -> Option<String> {
    let normalized = normalize_remote_path(path, false);
    if normalized == "/" {
        return None;
    }

    let trimmed = normalized.trim_end_matches('/');
    let parent = trimmed.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("/");
    Some(normalize_remote_path(parent, true))
}

fn build_remote_directory_entry(current_path: &str, entry: DirEntry) -> Option<LocalDirectoryEntry> {
    let name = entry.file_name();
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }

    let metadata = entry.metadata();
    let file_type = entry.file_type();
    let entry_type = if file_type.is_dir() {
        "folder"
    } else if file_type.is_symlink() {
        "link"
    } else {
        "file"
    };
    let kind = if entry_type == "folder" {
        "folder".to_string()
    } else if entry_type == "link" {
        "link".to_string()
    } else {
        Path::new(&name)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .filter(|extension| !extension.is_empty())
            .unwrap_or_else(|| "file".to_string())
    };

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());

    Some(LocalDirectoryEntry {
        name: name.clone(),
        path: join_remote_path(current_path, &name, entry_type == "folder"),
        modified_at,
        size_bytes: if entry_type == "file" {
            Some(metadata.len())
        } else {
            None
        },
        kind,
        entry_type: entry_type.to_string(),
    })
}

fn join_remote_path(base_path: &str, name: &str, force_trailing_slash: bool) -> String {
    let base = normalize_remote_path(base_path, false);
    let joined = if base == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", base.trim_end_matches('/'), name)
    };

    normalize_remote_path(&joined, force_trailing_slash)
}

#[cfg(test)]
mod tests {
    use super::{
        join_remote_path, normalize_remote_path, remote_parent_path, sort_entries,
        LocalDirectoryEntry,
    };

    #[test]
    fn normalizes_remote_paths() {
        assert_eq!(normalize_remote_path("var/log", true), "/var/log/");
        assert_eq!(normalize_remote_path("/", true), "/");
        assert_eq!(normalize_remote_path("/srv/data/", false), "/srv/data");
    }

    #[test]
    fn builds_parent_paths_for_remote_directories() {
        assert_eq!(remote_parent_path("/"), None);
        assert_eq!(remote_parent_path("/srv/"), Some("/".into()));
        assert_eq!(remote_parent_path("/srv/data/releases/"), Some("/srv/data/".into()));
    }

    #[test]
    fn joins_remote_paths_without_double_slashes() {
        assert_eq!(join_remote_path("/", "etc", true), "/etc/");
        assert_eq!(join_remote_path("/srv/data/", "notes.txt", false), "/srv/data/notes.txt");
    }

    #[test]
    fn sorts_directories_before_links_and_files() {
        let mut entries = vec![
            LocalDirectoryEntry {
                name: "zeta.log".into(),
                path: "/tmp/zeta.log".into(),
                modified_at: None,
                size_bytes: Some(42),
                kind: "log".into(),
                entry_type: "file".into(),
            },
            LocalDirectoryEntry {
                name: "beta-link".into(),
                path: "/tmp/beta-link".into(),
                modified_at: None,
                size_bytes: None,
                kind: "link".into(),
                entry_type: "link".into(),
            },
            LocalDirectoryEntry {
                name: "alpha".into(),
                path: "/tmp/alpha/".into(),
                modified_at: None,
                size_bytes: None,
                kind: "folder".into(),
                entry_type: "folder".into(),
            },
        ];

        sort_entries(&mut entries);

        assert_eq!(entries[0].name, "alpha");
        assert_eq!(entries[1].name, "beta-link");
        assert_eq!(entries[2].name, "zeta.log");
    }
}