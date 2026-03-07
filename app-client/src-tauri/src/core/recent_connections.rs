use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const MAX_RECENT_CONNECTIONS: usize = 25;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRecentConnectionRequest {
    pub profile_name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub relay_target_node_id: Option<String>,
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentConnectionEntry {
    pub id: String,
    pub profile_name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub relay_target_node_id: Option<String>,
    pub environment: Option<String>,
    pub connected_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentConnectionsResponse {
    pub history_path: String,
    pub entries: Vec<RecentConnectionEntry>,
}

pub fn list_recent_connections() -> Result<RecentConnectionsResponse> {
    let history_path = recent_connections_path()?;
    let entries = read_recent_connections(&history_path)?;
    Ok(RecentConnectionsResponse {
        history_path: history_path.display().to_string(),
        entries,
    })
}

pub fn record_recent_connection(
    request: RecordRecentConnectionRequest,
) -> Result<RecentConnectionsResponse> {
    let history_path = recent_connections_path()?;
    if let Some(parent) = history_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create recent connections directory {}",
                parent.display()
            )
        })?;
    }

    let mut entries = read_recent_connections(&history_path)?;
    entries.retain(|entry| {
        !(entry.host == request.host
            && entry.port == request.port
            && entry.username == request.username
            && entry.relay_target_node_id == request.relay_target_node_id)
    });
    entries.insert(
        0,
        RecentConnectionEntry {
            id: Uuid::new_v4().to_string(),
            profile_name: non_empty_or_default(
                request.profile_name,
                &request.username,
                &request.host,
            ),
            host: request.host.trim().to_string(),
            port: request.port,
            username: request.username.trim().to_string(),
            relay_target_node_id: request.relay_target_node_id.and_then(non_empty),
            environment: request.environment.and_then(non_empty),
            connected_at: unix_timestamp(),
        },
    );
    entries.truncate(MAX_RECENT_CONNECTIONS);
    atomic_write(
        &history_path,
        serde_json::to_vec_pretty(&entries)
            .context("failed to serialize recent connections history")?
            .as_slice(),
    )?;

    Ok(RecentConnectionsResponse {
        history_path: history_path.display().to_string(),
        entries,
    })
}

fn read_recent_connections(path: &Path) -> Result<Vec<RecentConnectionEntry>> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_slice(&bytes).context("failed to parse recent connections history")
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, bytes)
        .with_context(|| format!("failed to write {}", temp_path.display()))?;
    if path.exists() {
        fs::remove_file(path).with_context(|| format!("failed to remove {}", path.display()))?;
    }
    fs::rename(&temp_path, path).with_context(|| {
        format!(
            "failed to replace recent connections {} with {}",
            path.display(),
            temp_path.display()
        )
    })?;
    Ok(())
}

fn recent_connections_path() -> Result<PathBuf> {
    if let Some(explicit) = std::env::var_os("OZY_STATE_DIR") {
        return Ok(PathBuf::from(explicit).join("recent-connections.json"));
    }

    let base = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| anyhow::anyhow!("unable to resolve home directory"))?;
    Ok(PathBuf::from(base)
        .join(".ozyterminal")
        .join("recent-connections.json"))
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn non_empty_or_default(value: String, username: &str, host: &str) -> String {
    non_empty(value).unwrap_or_else(|| format!("{username}@{host}"))
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{list_recent_connections, record_recent_connection, RecordRecentConnectionRequest};
    use crate::collab::test_support::lock_test_env;
    use std::path::PathBuf;

    fn temp_state_dir() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("ozyterminal-recents-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn records_recent_connections_without_duplicates() {
        let _guard = lock_test_env();
        let state_dir = temp_state_dir();
        std::env::set_var("OZY_STATE_DIR", &state_dir);

        record_recent_connection(RecordRecentConnectionRequest {
            profile_name: "Demo".into(),
            host: "127.0.0.1".into(),
            port: 22,
            username: "ozy".into(),
            relay_target_node_id: None,
            environment: Some("development".into()),
        })
        .unwrap();
        record_recent_connection(RecordRecentConnectionRequest {
            profile_name: "Demo".into(),
            host: "127.0.0.1".into(),
            port: 22,
            username: "ozy".into(),
            relay_target_node_id: None,
            environment: Some("development".into()),
        })
        .unwrap();

        let response = list_recent_connections().unwrap();
        assert_eq!(response.entries.len(), 1);
        assert_eq!(response.entries[0].profile_name, "Demo");

        std::env::remove_var("OZY_STATE_DIR");
    }
}
