use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedVault {
    pub vault_id: String,
    pub name: String,
    pub version: u64,
    pub root: VaultNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultNodeKind {
    Folder,
    Server,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultNode {
    pub id: String,
    pub kind: VaultNodeKind,
    pub name: String,
    #[serde(default)]
    pub inherit_permissions: bool,
    #[serde(default)]
    pub permissions: Vec<PermissionRule>,
    #[serde(default)]
    pub children: Vec<VaultNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct PermissionRule {
    pub subject: PermissionSubject,
    pub effect: PermissionEffect,
    pub actions: Vec<String>,
}

pub fn resolve_effective_permissions(
    path: &[&VaultNode],
    subject_id: &str,
) -> HashSet<String> {
    let mut allowed = HashSet::new();
    let mut denied = HashSet::new();

    for node in path {
        for rule in &node.permissions {
            if rule.subject.id != subject_id {
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
