use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Context;
use serde::Serialize;
use uuid::Uuid;

#[derive(Clone)]
pub struct AuditLogService {
    log_path: Arc<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub event_id: Uuid,
    pub event_type: String,
    pub actor: String,
    pub auth_mode: String,
    pub certificate_id: Uuid,
    pub key_id: String,
    pub target_host: String,
    pub principals: Vec<String>,
    pub issued_at: u64,
    pub expires_at: u64,
}

impl AuditLogService {
    pub fn new(state_dir: &Path) -> anyhow::Result<Self> {
        fs::create_dir_all(state_dir).with_context(|| {
            format!(
                "failed to create control-plane state directory {}",
                state_dir.display()
            )
        })?;

        Ok(Self {
            log_path: Arc::new(state_dir.join("audit.log")),
        })
    }

    pub fn record(&self, entry: &AuditEntry) -> anyhow::Result<()> {
        let line = serde_json::to_string(entry).context("failed to serialize audit entry")?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.log_path.as_path())
            .with_context(|| format!("failed to open audit log {}", self.log_path.display()))?;
        writeln!(file, "{line}").context("failed to append audit entry")?;
        Ok(())
    }
}
