use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

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

    Ok(LocalDirectoryResponse {
        current_path: normalize_path(&current_path, true),
        parent_path,
        entries,
    })
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