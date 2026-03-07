use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const SHARED_VAULT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedVault {
    pub vault_id: String,
    pub name: String,
    #[serde(default)]
    pub version: u64,
    #[serde(default)]
    pub updated_at: u64,
    pub root: VaultNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultNodeKind {
    Folder,
    Server,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNode {
    pub id: String,
    pub kind: VaultNodeKind,
    pub name: String,
    #[serde(default = "default_inherit_permissions")]
    pub inherit_permissions: bool,
    #[serde(default)]
    pub permissions: Vec<PermissionRule>,
    #[serde(default)]
    pub children: Vec<VaultNode>,
    #[serde(default)]
    pub server: Option<SharedServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedServerConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub known_host_fingerprint: Option<String>,
    pub relay_target_node_id: Option<String>,
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSubject {
    #[serde(rename = "type")]
    pub subject_type: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionEffect {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRule {
    pub subject: PermissionSubject,
    pub effect: PermissionEffect,
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSharedVaultRequest {
    pub actor_id: String,
    pub vault: SharedVault,
    pub expected_version: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedVaultResponse {
    pub vault: SharedVault,
    pub vault_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSharedVaultEntriesRequest {
    pub actor_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedVaultServerView {
    pub node_id: String,
    pub name: String,
    pub path: Vec<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub known_host_fingerprint: Option<String>,
    pub relay_target_node_id: Option<String>,
    pub environment: Option<String>,
    pub effective_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedVaultEntriesResponse {
    pub vault_id: String,
    pub vault_name: String,
    pub version: u64,
    pub actor_ids: Vec<String>,
    pub entries: Vec<SharedVaultServerView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedVaultRevisionEntry {
    pub revision_id: String,
    pub vault_id: String,
    pub version: u64,
    pub actor_id: String,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedVaultFile {
    version: u32,
    vault: SharedVault,
}

pub fn load_shared_vault() -> Result<SharedVaultResponse> {
    let vault_path = shared_vault_path()?;
    let file = read_shared_vault_file(&vault_path)?;
    Ok(SharedVaultResponse {
        vault: file.vault,
        vault_path: vault_path.display().to_string(),
    })
}

pub fn save_shared_vault(request: SaveSharedVaultRequest) -> Result<SharedVaultResponse> {
    let actor_id = request.actor_id.trim();
    if actor_id.is_empty() {
        return Err(anyhow!("actorId is required"));
    }

    validate_vault(&request.vault)?;
    let vault_path = shared_vault_path()?;
    if let Some(parent) = vault_path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create shared vault directory {}",
                parent.display()
            )
        })?;
    }

    let now = unix_timestamp();
    let existing = read_shared_vault_file_optional(&vault_path)?;
    if let Some(expected_version) = request.expected_version {
        let current_version = existing
            .as_ref()
            .map(|file| file.vault.version)
            .unwrap_or_default();
        if expected_version != current_version {
            return Err(anyhow!(
                "shared vault version mismatch: expected {expected_version}, current {current_version}"
            ));
        }
    }

    let mut vault = request.vault;
    if vault.vault_id.trim().is_empty() {
        vault.vault_id = Uuid::new_v4().to_string();
    }
    vault.version = existing
        .as_ref()
        .map(|file| file.vault.version + 1)
        .unwrap_or_else(|| vault.version.max(1));
    vault.updated_at = now;

    let file = SharedVaultFile {
        version: SHARED_VAULT_VERSION,
        vault: vault.clone(),
    };
    let payload = serde_json::to_vec_pretty(&file).context("failed to serialize shared vault")?;
    atomic_write(&vault_path, &payload)?;
    append_revision_entry(
        &shared_vault_history_path()?,
        &SharedVaultRevisionEntry {
            revision_id: Uuid::new_v4().to_string(),
            vault_id: vault.vault_id.clone(),
            version: vault.version,
            actor_id: actor_id.to_string(),
            updated_at: now,
        },
    )?;

    Ok(SharedVaultResponse {
        vault,
        vault_path: vault_path.display().to_string(),
    })
}

pub fn list_shared_vault_entries(
    request: ListSharedVaultEntriesRequest,
) -> Result<SharedVaultEntriesResponse> {
    let response = load_shared_vault()?;
    let actor_ids = normalize_actor_ids(request.actor_ids);
    if actor_ids.is_empty() {
        return Err(anyhow!("at least one actorId is required"));
    }

    let entries = collect_server_entries(&response.vault, &actor_ids);
    Ok(SharedVaultEntriesResponse {
        vault_id: response.vault.vault_id,
        vault_name: response.vault.name,
        version: response.vault.version,
        actor_ids,
        entries,
    })
}

pub fn bootstrap_demo_shared_vault(actor_id: &str) -> Result<SharedVaultResponse> {
    let actor_id = actor_id.trim();
    if actor_id.is_empty() {
        return Err(anyhow!("actorId is required"));
    }

    let vault = SharedVault {
        vault_id: String::new(),
        name: "OzyTerminal Shared Vault".into(),
        version: 0,
        updated_at: 0,
        root: VaultNode {
            id: "root".into(),
            kind: VaultNodeKind::Folder,
            name: "Infra".into(),
            inherit_permissions: true,
            permissions: vec![
                PermissionRule {
                    subject: PermissionSubject {
                        subject_type: "user".into(),
                        id: actor_id.to_string(),
                    },
                    effect: PermissionEffect::Allow,
                    actions: vec![
                        "connect".into(),
                        "view_session".into(),
                        "share_session".into(),
                    ],
                },
                PermissionRule {
                    subject: PermissionSubject {
                        subject_type: "user".into(),
                        id: "auditor-1".into(),
                    },
                    effect: PermissionEffect::Allow,
                    actions: vec!["view_session".into()],
                },
            ],
            children: vec![
                VaultNode {
                    id: "prod-folder".into(),
                    kind: VaultNodeKind::Folder,
                    name: "Production".into(),
                    inherit_permissions: true,
                    permissions: vec![PermissionRule {
                        subject: PermissionSubject {
                            subject_type: "user".into(),
                            id: "auditor-1".into(),
                        },
                        effect: PermissionEffect::Deny,
                        actions: vec!["connect".into()],
                    }],
                    children: vec![VaultNode {
                        id: "prod-bastion".into(),
                        kind: VaultNodeKind::Server,
                        name: "Prod Bastion".into(),
                        inherit_permissions: true,
                        permissions: vec![],
                        children: vec![],
                        server: Some(SharedServerConfig {
                            host: "10.0.0.10".into(),
                            port: 22,
                            username: "ozy".into(),
                            known_host_fingerprint: Some("SHA256:replace-me-prod".into()),
                            relay_target_node_id: Some("prod-node-1".into()),
                            environment: Some("production".into()),
                        }),
                    }],
                    server: None,
                },
                VaultNode {
                    id: "staging-folder".into(),
                    kind: VaultNodeKind::Folder,
                    name: "Staging".into(),
                    inherit_permissions: true,
                    permissions: vec![PermissionRule {
                        subject: PermissionSubject {
                            subject_type: "user".into(),
                            id: "auditor-1".into(),
                        },
                        effect: PermissionEffect::Allow,
                        actions: vec!["view_session".into()],
                    }],
                    children: vec![VaultNode {
                        id: "staging-web-1".into(),
                        kind: VaultNodeKind::Server,
                        name: "Staging Web 1".into(),
                        inherit_permissions: true,
                        permissions: vec![PermissionRule {
                            subject: PermissionSubject {
                                subject_type: "user".into(),
                                id: "auditor-1".into(),
                            },
                            effect: PermissionEffect::Allow,
                            actions: vec!["connect".into()],
                        }],
                        children: vec![],
                        server: Some(SharedServerConfig {
                            host: "10.0.1.20".into(),
                            port: 22,
                            username: "deploy".into(),
                            known_host_fingerprint: Some("SHA256:replace-me-stage".into()),
                            relay_target_node_id: Some("staging-node-1".into()),
                            environment: Some("staging".into()),
                        }),
                    }],
                    server: None,
                },
            ],
            server: None,
        },
    };

    save_shared_vault(SaveSharedVaultRequest {
        actor_id: actor_id.to_string(),
        vault,
        expected_version: None,
    })
}

pub fn resolve_effective_permissions(path: &[&VaultNode], actor_ids: &[String]) -> HashSet<String> {
    let mut allowed = HashSet::new();
    let mut denied = HashSet::new();
    let actor_ids = actor_ids.iter().map(String::as_str).collect::<HashSet<_>>();

    for node in path {
        if !node.inherit_permissions {
            allowed.clear();
            denied.clear();
        }
        for rule in &node.permissions {
            if !subject_matches(&rule.subject, &actor_ids) {
                continue;
            }
            match rule.effect {
                PermissionEffect::Allow => {
                    for action in &rule.actions {
                        if !denied.contains(action) {
                            allowed.insert(action.clone());
                        }
                    }
                }
                PermissionEffect::Deny => {
                    for action in &rule.actions {
                        allowed.remove(action);
                        denied.insert(action.clone());
                    }
                }
            }
        }
    }

    allowed
}

fn collect_server_entries(vault: &SharedVault, actor_ids: &[String]) -> Vec<SharedVaultServerView> {
    let mut path = Vec::new();
    let mut entries = Vec::new();
    visit_node(&vault.root, actor_ids, &mut path, &mut entries);
    entries.sort_by(|left, right| left.path.cmp(&right.path).then(left.name.cmp(&right.name)));
    entries
}

fn visit_node<'a>(
    node: &'a VaultNode,
    actor_ids: &[String],
    path: &mut Vec<&'a VaultNode>,
    entries: &mut Vec<SharedVaultServerView>,
) {
    path.push(node);
    if let Some(server) = &node.server {
        let mut effective_actions = resolve_effective_permissions(path, actor_ids)
            .into_iter()
            .collect::<Vec<_>>();
        effective_actions.sort();
        if !effective_actions.is_empty() {
            entries.push(SharedVaultServerView {
                node_id: node.id.clone(),
                name: node.name.clone(),
                path: path.iter().map(|item| item.name.clone()).collect(),
                host: server.host.clone(),
                port: server.port,
                username: server.username.clone(),
                known_host_fingerprint: server.known_host_fingerprint.clone(),
                relay_target_node_id: server.relay_target_node_id.clone(),
                environment: server.environment.clone(),
                effective_actions,
            });
        }
    }

    for child in &node.children {
        visit_node(child, actor_ids, path, entries);
    }
    path.pop();
}

fn subject_matches(subject: &PermissionSubject, actor_ids: &HashSet<&str>) -> bool {
    subject.id == "*" || actor_ids.contains(subject.id.as_str()) || subject.subject_type == "anyone"
}

fn normalize_actor_ids(actor_ids: Vec<String>) -> Vec<String> {
    let mut unique = HashSet::new();
    let mut normalized = Vec::new();
    for actor_id in actor_ids {
        let value = actor_id.trim();
        if value.is_empty() {
            continue;
        }
        if unique.insert(value.to_string()) {
            normalized.push(value.to_string());
        }
    }
    normalized.push("*".into());
    normalized
}

fn validate_vault(vault: &SharedVault) -> Result<()> {
    if vault.name.trim().is_empty() {
        return Err(anyhow!("shared vault name is required"));
    }
    validate_node(&vault.root)
}

fn validate_node(node: &VaultNode) -> Result<()> {
    if node.id.trim().is_empty() {
        return Err(anyhow!("vault node id is required"));
    }
    if node.name.trim().is_empty() {
        return Err(anyhow!("vault node name is required"));
    }
    match node.kind {
        VaultNodeKind::Folder => {
            if node.server.is_some() {
                return Err(anyhow!("folder nodes cannot embed server config"));
            }
        }
        VaultNodeKind::Server => {
            let server = node
                .server
                .as_ref()
                .ok_or_else(|| anyhow!("server nodes must embed server config"))?;
            if server.host.trim().is_empty() || server.username.trim().is_empty() {
                return Err(anyhow!("server nodes require host and username"));
            }
        }
    }

    for child in &node.children {
        validate_node(child)?;
    }
    Ok(())
}

fn read_shared_vault_file(path: &Path) -> Result<SharedVaultFile> {
    let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_slice(&bytes).context("failed to parse shared vault file")
}

fn read_shared_vault_file_optional(path: &Path) -> Result<Option<SharedVaultFile>> {
    if !path.exists() {
        return Ok(None);
    }
    read_shared_vault_file(path).map(Some)
}

fn append_revision_entry(path: &Path, entry: &SharedVaultRevisionEntry) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create shared vault history directory {}",
                parent.display()
            )
        })?;
    }
    let line = format!(
        "{}\n",
        serde_json::to_string(entry).context("failed to serialize shared vault revision")?
    );
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("failed to open {}", path.display()))?;
    file.write_all(line.as_bytes())
        .with_context(|| format!("failed to append {}", path.display()))?;
    Ok(())
}

fn atomic_write(path: &Path, payload: &[u8]) -> Result<()> {
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, payload)
        .with_context(|| format!("failed to write {}", temp_path.display()))?;
    if path.exists() {
        fs::remove_file(path).with_context(|| format!("failed to remove {}", path.display()))?;
    }
    fs::rename(&temp_path, path).with_context(|| {
        format!(
            "failed to replace shared vault {} with {}",
            path.display(),
            temp_path.display()
        )
    })?;
    Ok(())
}

fn shared_vault_path() -> Result<PathBuf> {
    let state_dir = if let Some(explicit) = std::env::var_os("OZY_STATE_DIR") {
        PathBuf::from(explicit)
    } else {
        home_dir()
            .map(|base| base.join(".ozyterminal"))
            .unwrap_or_else(|| PathBuf::from(".").join(".ozyterminal"))
    };

    Ok(state_dir.join("shared-vault.json"))
}

fn shared_vault_history_path() -> Result<PathBuf> {
    Ok(shared_vault_path()?.with_file_name("shared-vault.history.jsonl"))
}

fn default_inherit_permissions() -> bool {
    true
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
        bootstrap_demo_shared_vault, list_shared_vault_entries, load_shared_vault,
        resolve_effective_permissions, save_shared_vault, ListSharedVaultEntriesRequest,
        PermissionEffect, PermissionRule, PermissionSubject, SaveSharedVaultRequest,
        SharedServerConfig, SharedVault, VaultNode, VaultNodeKind,
    };
    use std::{
        path::PathBuf,
        sync::{Mutex, OnceLock},
    };

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn temp_state_dir() -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("ozyterminal-shared-vault-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn test_vault() -> SharedVault {
        SharedVault {
            vault_id: String::new(),
            name: "Shared".into(),
            version: 0,
            updated_at: 0,
            root: VaultNode {
                id: "root".into(),
                kind: VaultNodeKind::Folder,
                name: "Root".into(),
                inherit_permissions: true,
                permissions: vec![PermissionRule {
                    subject: PermissionSubject {
                        subject_type: "user".into(),
                        id: "alice".into(),
                    },
                    effect: PermissionEffect::Allow,
                    actions: vec!["connect".into(), "view_session".into()],
                }],
                children: vec![VaultNode {
                    id: "server-1".into(),
                    kind: VaultNodeKind::Server,
                    name: "Server 1".into(),
                    inherit_permissions: true,
                    permissions: vec![PermissionRule {
                        subject: PermissionSubject {
                            subject_type: "user".into(),
                            id: "alice".into(),
                        },
                        effect: PermissionEffect::Deny,
                        actions: vec!["connect".into()],
                    }],
                    children: vec![],
                    server: Some(SharedServerConfig {
                        host: "127.0.0.1".into(),
                        port: 22,
                        username: "ozy".into(),
                        known_host_fingerprint: None,
                        relay_target_node_id: None,
                        environment: Some("development".into()),
                    }),
                }],
                server: None,
            },
        }
    }

    #[test]
    fn resolves_permissions_with_deny_precedence() {
        let vault = test_vault();
        let path = vec![&vault.root, &vault.root.children[0]];
        let actions = resolve_effective_permissions(&path, &["alice".into()]);
        assert!(actions.contains("view_session"));
        assert!(!actions.contains("connect"));
    }

    #[test]
    fn persists_and_lists_effective_servers() {
        let _guard = env_lock().lock().unwrap();
        let state_dir = temp_state_dir();
        std::env::set_var("OZY_STATE_DIR", &state_dir);

        let saved = save_shared_vault(SaveSharedVaultRequest {
            actor_id: "alice".into(),
            vault: test_vault(),
            expected_version: None,
        })
        .unwrap();
        assert_eq!(saved.vault.version, 1);

        let loaded = load_shared_vault().unwrap();
        assert_eq!(loaded.vault.name, "Shared");

        let entries = list_shared_vault_entries(ListSharedVaultEntriesRequest {
            actor_ids: vec!["alice".into()],
        })
        .unwrap();
        assert_eq!(entries.entries.len(), 1);
        assert_eq!(entries.entries[0].effective_actions, vec!["view_session"]);
        std::env::remove_var("OZY_STATE_DIR");
    }

    #[test]
    fn bootstraps_demo_vault() {
        let _guard = env_lock().lock().unwrap();
        let state_dir = temp_state_dir();
        std::env::set_var("OZY_STATE_DIR", &state_dir);
        let response = bootstrap_demo_shared_vault("owner-1").unwrap();
        assert_eq!(response.vault.version, 1);
        let entries = list_shared_vault_entries(ListSharedVaultEntriesRequest {
            actor_ids: vec!["owner-1".into()],
        })
        .unwrap();
        assert_eq!(entries.entries.len(), 2);
        std::env::remove_var("OZY_STATE_DIR");
    }
}
