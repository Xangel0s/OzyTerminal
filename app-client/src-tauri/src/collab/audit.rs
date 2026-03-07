use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 250;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabAuditEntry {
    pub event_id: String,
    pub event_type: String,
    pub actor_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub summary: String,
    pub occurred_at: u64,
    pub metadata: Value,
}

#[derive(Debug, Clone)]
pub struct NewCollabAuditEntry {
    pub event_type: String,
    pub actor_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub summary: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCollabAuditEntriesRequest {
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabAuditEntriesResponse {
    pub audit_path: String,
    pub entries: Vec<CollabAuditEntry>,
}

pub fn record_collab_audit_event(request: NewCollabAuditEntry) -> Result<CollabAuditEntry> {
    let actor_id = request.actor_id.trim();
    let target_id = request.target_id.trim();
    if actor_id.is_empty() || target_id.is_empty() {
        return Err(anyhow!(
            "actorId and targetId are required for collab audit"
        ));
    }

    let entry = CollabAuditEntry {
        event_id: Uuid::new_v4().to_string(),
        event_type: request.event_type,
        actor_id: actor_id.to_string(),
        target_kind: request.target_kind,
        target_id: target_id.to_string(),
        summary: request.summary,
        occurred_at: unix_timestamp(),
        metadata: request.metadata,
    };

    let audit_path = collab_audit_path()?;
    if let Some(parent) = audit_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create collaboration audit directory {}",
                parent.display()
            )
        })?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&audit_path)
        .with_context(|| format!("failed to open {}", audit_path.display()))?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&entry).context("failed to serialize audit entry")?
    )
    .with_context(|| format!("failed to append {}", audit_path.display()))?;

    Ok(entry)
}

pub fn list_collab_audit_entries(
    request: ListCollabAuditEntriesRequest,
) -> Result<CollabAuditEntriesResponse> {
    let audit_path = collab_audit_path()?;
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let entries = if audit_path.exists() {
        let content = fs::read_to_string(&audit_path)
            .with_context(|| format!("failed to read {}", audit_path.display()))?;
        let mut entries = content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| serde_json::from_str::<CollabAuditEntry>(line).ok())
            .collect::<Vec<_>>();
        entries.reverse();
        entries.truncate(limit);
        entries
    } else {
        Vec::new()
    };

    Ok(CollabAuditEntriesResponse {
        audit_path: audit_path.display().to_string(),
        entries,
    })
}

pub fn shared_vault_save_metadata(version: u64, vault_name: &str) -> Value {
    json!({
        "version": version,
        "vaultName": vault_name,
    })
}

pub fn shared_vault_node_metadata(node_id: &str, action: &str, path: Option<&str>) -> Value {
    json!({
        "nodeId": node_id,
        "action": action,
        "path": path,
    })
}

pub fn session_mirror_metadata(
    session_id: &str,
    role: Option<&str>,
    target_actor: Option<&str>,
) -> Value {
    json!({
        "sessionId": session_id,
        "role": role,
        "targetActor": target_actor,
    })
}

fn collab_audit_path() -> Result<PathBuf> {
    let state_dir = if let Some(explicit) = std::env::var_os("OZY_STATE_DIR") {
        PathBuf::from(explicit)
    } else {
        home_dir()
            .map(|base| base.join(".ozyterminal"))
            .unwrap_or_else(|| PathBuf::from(".").join(".ozyterminal"))
    };

    Ok(state_dir.join("collab-audit.jsonl"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        list_collab_audit_entries, record_collab_audit_event, ListCollabAuditEntriesRequest,
        NewCollabAuditEntry,
    };
    use crate::collab::test_support::lock_test_env;
    use serde_json::json;
    use std::path::PathBuf;

    fn temp_state_dir() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("ozyterminal-collab-audit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn records_and_lists_collab_audit_entries() {
        let _guard = lock_test_env();
        let state_dir = temp_state_dir();
        std::env::set_var("OZY_STATE_DIR", &state_dir);

        record_collab_audit_event(NewCollabAuditEntry {
            event_type: "shared_vault_saved".into(),
            actor_id: "owner-1".into(),
            target_kind: "shared_vault".into(),
            target_id: "vault-1".into(),
            summary: "shared vault updated".into(),
            metadata: json!({"version": 1}),
        })
        .unwrap();

        let response =
            list_collab_audit_entries(ListCollabAuditEntriesRequest { limit: Some(10) }).unwrap();
        assert_eq!(response.entries.len(), 1);
        assert_eq!(response.entries[0].event_type, "shared_vault_saved");

        std::env::remove_var("OZY_STATE_DIR");
    }
}
