use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::activity::{
    clear_activity_logs, list_activity_logs, record_activity_log, ActivityLogsResponse,
    NewActivityLogEntry,
};

const APP_DATA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeychainEntry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub fingerprint: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub code: String,
    pub language: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardEntry {
    pub id: String,
    pub name: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub host: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppDataFile {
    version: u32,
    updated_at: u64,
    #[serde(default)]
    keychain_entries: Vec<KeychainEntry>,
    #[serde(default)]
    snippets: Vec<SnippetEntry>,
    #[serde(default)]
    port_forwards: Vec<PortForwardEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataResponse {
    pub keychain_entries: Vec<KeychainEntry>,
    pub snippets: Vec<SnippetEntry>,
    pub port_forwards: Vec<PortForwardEntry>,
    pub updated_at: u64,
    pub storage_path: String,
}

#[tauri::command]
pub fn load_app_data_command() -> Result<AppDataResponse, String> {
    load_app_data().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn save_keychain_entries_command(entries: Vec<KeychainEntry>) -> Result<AppDataResponse, String> {
    save_keychain_entries(entries).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn save_snippets_command(entries: Vec<SnippetEntry>) -> Result<AppDataResponse, String> {
    save_snippets(entries).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn save_port_forwards_command(
    entries: Vec<PortForwardEntry>,
) -> Result<AppDataResponse, String> {
    save_port_forwards(entries).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_activity_logs_command(limit: Option<usize>) -> Result<ActivityLogsResponse, String> {
    list_activity_logs(limit).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn clear_activity_logs_command() -> Result<ActivityLogsResponse, String> {
    clear_activity_logs().map_err(|err| err.to_string())
}

pub fn save_keychain_entries(entries: Vec<KeychainEntry>) -> anyhow::Result<AppDataResponse> {
    let mut current = read_app_data_file()?;
    let previous = current.keychain_entries.clone();
    current.keychain_entries = entries;
    let response = write_app_data_file(&current)?;
    record_collection_change(
        "keychain",
        "Keychain updated",
        &previous,
        &response.keychain_entries,
    );
    Ok(response)
}

pub fn save_snippets(entries: Vec<SnippetEntry>) -> anyhow::Result<AppDataResponse> {
    let mut current = read_app_data_file()?;
    let previous = current.snippets.clone();
    current.snippets = entries;
    let response = write_app_data_file(&current)?;
    record_collection_change("snippets", "Snippets updated", &previous, &response.snippets);
    Ok(response)
}

pub fn save_port_forwards(entries: Vec<PortForwardEntry>) -> anyhow::Result<AppDataResponse> {
    let mut current = read_app_data_file()?;
    let previous = current.port_forwards.clone();
    current.port_forwards = entries;
    let response = write_app_data_file(&current)?;
    record_collection_change(
        "port-forward",
        "Port forwarding updated",
        &previous,
        &response.port_forwards,
    );
    Ok(response)
}

pub fn record_sftp_navigation(path: &str, scope: &str, entry_count: usize) {
    let details = format!("Listed {scope} directory {path}");
    let _ = record_activity_log(NewActivityLogEntry {
        level: "info".into(),
        category: "sftp".into(),
        host: None,
        action: "SFTP directory listed".into(),
        details,
        metadata: json!({
            "scope": scope,
            "path": path,
            "entryCount": entry_count,
        }),
    });
}

pub fn record_remote_sftp_navigation(host: &str, username: &str, path: &str, entry_count: usize) {
    let details = format!("Listed remote directory {path} on {host} as {username}");
    let _ = record_activity_log(NewActivityLogEntry {
        level: "info".into(),
        category: "sftp".into(),
        host: Some(host.to_string()),
        action: "Remote SFTP directory listed".into(),
        details,
        metadata: json!({
            "scope": "remote",
            "host": host,
            "username": username,
            "path": path,
            "entryCount": entry_count,
        }),
    });
}

fn record_collection_change<T>(category: &str, action: &str, previous: &[T], next: &[T])
where
    T: Serialize + Identifiable,
{
    let (created, updated, deleted) = diff_collection(previous, next);
    if created == 0 && updated == 0 && deleted == 0 {
        return;
    }

    let details = format!(
        "created: {created}, updated: {updated}, deleted: {deleted}"
    );
    let _ = record_activity_log(NewActivityLogEntry {
        level: "info".into(),
        category: category.into(),
        host: None,
        action: action.into(),
        details,
        metadata: json!({
            "created": created,
            "updated": updated,
            "deleted": deleted,
            "total": next.len(),
        }),
    });
}

fn diff_collection<T>(previous: &[T], next: &[T]) -> (usize, usize, usize)
where
    T: Serialize + Identifiable,
{
    let previous_map = previous
        .iter()
        .map(|entry| (entry.identifier(), serde_json::to_value(entry).ok()))
        .collect::<HashMap<_, _>>();
    let next_map = next
        .iter()
        .map(|entry| (entry.identifier(), serde_json::to_value(entry).ok()))
        .collect::<HashMap<_, _>>();

    let mut created = 0;
    let mut updated = 0;
    for (id, next_value) in &next_map {
        match previous_map.get(id) {
            None => created += 1,
            Some(previous_value) if previous_value != next_value => updated += 1,
            _ => {}
        }
    }

    let deleted = previous_map
        .keys()
        .filter(|id| !next_map.contains_key(*id))
        .count();

    (created, updated, deleted)
}

fn load_app_data() -> anyhow::Result<AppDataResponse> {
    let file = read_app_data_file()?;
    Ok(app_data_response(&file, &app_data_path()?))
}

fn read_app_data_file() -> anyhow::Result<AppDataFile> {
    let path = app_data_path()?;
    if !path.exists() {
        return Ok(AppDataFile {
            version: APP_DATA_VERSION,
            updated_at: unix_timestamp(),
            keychain_entries: Vec::new(),
            snippets: Vec::new(),
            port_forwards: Vec::new(),
        });
    }

    let bytes = fs::read(&path)?;
    let parsed = serde_json::from_slice::<AppDataFile>(&bytes)?;
    Ok(parsed)
}

fn write_app_data_file(file: &AppDataFile) -> anyhow::Result<AppDataResponse> {
    let path = app_data_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let next = AppDataFile {
        version: APP_DATA_VERSION,
        updated_at: unix_timestamp(),
        keychain_entries: file.keychain_entries.clone(),
        snippets: file.snippets.clone(),
        port_forwards: file.port_forwards.clone(),
    };
    let serialized = serde_json::to_vec_pretty(&next)?;
    atomic_write(&path, &serialized)?;
    Ok(app_data_response(&next, &path))
}

fn app_data_response(file: &AppDataFile, path: &Path) -> AppDataResponse {
    AppDataResponse {
        keychain_entries: file.keychain_entries.clone(),
        snippets: file.snippets.clone(),
        port_forwards: file.port_forwards.clone(),
        updated_at: file.updated_at,
        storage_path: path.display().to_string(),
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, bytes)?;
    fs::rename(&temp_path, path)?;
    Ok(())
}

fn app_data_path() -> anyhow::Result<PathBuf> {
    Ok(state_dir()?.join("app-data.json"))
}

fn state_dir() -> anyhow::Result<PathBuf> {
    if let Some(explicit) = std::env::var_os("OZY_STATE_DIR") {
        return Ok(PathBuf::from(explicit));
    }

    let base = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| anyhow::anyhow!("unable to resolve home directory"))?;
    Ok(PathBuf::from(base).join(".ozyterminal"))
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

trait Identifiable {
    fn identifier(&self) -> String;
}

impl Identifiable for KeychainEntry {
    fn identifier(&self) -> String {
        self.id.clone()
    }
}

impl Identifiable for SnippetEntry {
    fn identifier(&self) -> String {
        self.id.clone()
    }
}

impl Identifiable for PortForwardEntry {
    fn identifier(&self) -> String {
        self.id.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clear_activity_logs_command, load_app_data_command, save_keychain_entries,
        save_port_forwards, save_snippets, KeychainEntry, PortForwardEntry, SnippetEntry,
    };
    use crate::collab::test_support::lock_test_env;
    use std::path::PathBuf;

    fn temp_state_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ozyterminal-app-data-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn persists_all_app_data_domains() {
        let _guard = lock_test_env();
        let state_dir = temp_state_dir();
        std::env::set_var("OZY_STATE_DIR", &state_dir);
        clear_activity_logs_command().unwrap();

        save_keychain_entries(vec![KeychainEntry {
            id: "key-1".into(),
            name: "Prod key".into(),
            entry_type: "ssh-key".into(),
            fingerprint: "SHA256:test".into(),
            created_at: "2025-01-01".into(),
        }])
        .unwrap();
        save_snippets(vec![SnippetEntry {
            id: "snippet-1".into(),
            name: "List".into(),
            description: "List files".into(),
            code: "ls -la".into(),
            language: "bash".into(),
            tags: vec!["ops".into()],
        }])
        .unwrap();
        save_port_forwards(vec![PortForwardEntry {
            id: "forward-1".into(),
            name: "DB".into(),
            local_port: 5432,
            remote_host: "127.0.0.1".into(),
            remote_port: 5432,
            host: "prod".into(),
            is_active: true,
        }])
        .unwrap();

        let loaded = load_app_data_command().unwrap();
        assert_eq!(loaded.keychain_entries.len(), 1);
        assert_eq!(loaded.snippets.len(), 1);
        assert_eq!(loaded.port_forwards.len(), 1);

        std::env::remove_var("OZY_STATE_DIR");
    }
}