use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogEntry {
    pub id: String,
    pub timestamp: String,
    pub occurred_at: u64,
    pub level: String,
    pub category: String,
    pub host: String,
    pub action: String,
    pub details: String,
    pub metadata: Value,
}

#[derive(Debug, Clone)]
pub struct NewActivityLogEntry {
    pub level: String,
    pub category: String,
    pub host: Option<String>,
    pub action: String,
    pub details: String,
    pub metadata: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogsResponse {
    pub log_path: String,
    pub entries: Vec<ActivityLogEntry>,
}

pub fn record_activity_log(request: NewActivityLogEntry) -> Result<ActivityLogEntry> {
    let action = request.action.trim();
    if action.is_empty() {
        return Err(anyhow::anyhow!("activity log action is required"));
    }

    let occurred_at = unix_timestamp();
    let entry = ActivityLogEntry {
        id: Uuid::new_v4().to_string(),
        timestamp: iso8601_timestamp(occurred_at),
        occurred_at,
        level: normalize_level(&request.level),
        category: normalize_category(&request.category),
        host: request.host.unwrap_or_default().trim().to_string(),
        action: action.to_string(),
        details: request.details.trim().to_string(),
        metadata: request.metadata,
    };

    let log_path = activity_log_path()?;
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("failed to open {}", log_path.display()))?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&entry).context("failed to serialize activity log entry")?
    )
    .with_context(|| format!("failed to append {}", log_path.display()))?;

    Ok(entry)
}

pub fn list_activity_logs(limit: Option<usize>) -> Result<ActivityLogsResponse> {
    let log_path = activity_log_path()?;
    let clamped_limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let entries = if log_path.exists() {
        let content = fs::read_to_string(&log_path)
            .with_context(|| format!("failed to read {}", log_path.display()))?;
        let mut parsed = content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| serde_json::from_str::<ActivityLogEntry>(line).ok())
            .collect::<Vec<_>>();
        parsed.reverse();
        parsed.truncate(clamped_limit);
        parsed
    } else {
        Vec::new()
    };

    Ok(ActivityLogsResponse {
        log_path: log_path.display().to_string(),
        entries,
    })
}

pub fn clear_activity_logs() -> Result<ActivityLogsResponse> {
    let log_path = activity_log_path()?;
    if log_path.exists() {
        fs::remove_file(&log_path)
            .with_context(|| format!("failed to remove {}", log_path.display()))?;
    }

    Ok(ActivityLogsResponse {
        log_path: log_path.display().to_string(),
        entries: Vec::new(),
    })
}

fn normalize_level(level: &str) -> String {
    match level.trim() {
        "success" | "warning" | "error" => level.trim().to_string(),
        _ => "info".into(),
    }
}

fn normalize_category(category: &str) -> String {
    let trimmed = category.trim();
    if trimmed.is_empty() {
        return "system".into();
    }
    trimmed.to_string()
}

fn activity_log_path() -> Result<PathBuf> {
    Ok(state_dir()?.join("activity-log.jsonl"))
}

fn state_dir() -> Result<PathBuf> {
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

fn iso8601_timestamp(unix_timestamp: u64) -> String {
    format_unix_time(unix_timestamp)
}

fn format_unix_time(mut unix_timestamp: u64) -> String {
    let seconds = unix_timestamp % 60;
    unix_timestamp /= 60;
    let minutes = unix_timestamp % 60;
    unix_timestamp /= 60;
    let hours = unix_timestamp % 24;
    let days = unix_timestamp / 24;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}Z"
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = (yoe as i32) + era as i32 * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::{clear_activity_logs, list_activity_logs, record_activity_log, NewActivityLogEntry};
    use crate::collab::test_support::lock_test_env;
    use serde_json::json;
    use std::path::PathBuf;

    fn temp_state_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ozyterminal-activity-log-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn records_lists_and_clears_activity_logs() {
        let _guard = lock_test_env();
        let state_dir = temp_state_dir();
        std::env::set_var("OZY_STATE_DIR", &state_dir);

        record_activity_log(NewActivityLogEntry {
            level: "success".into(),
            category: "ssh".into(),
            host: Some("127.0.0.1".into()),
            action: "SSH session connected".into(),
            details: "Connected as ozy".into(),
            metadata: json!({"port": 22}),
        })
        .unwrap();

        let listed = list_activity_logs(Some(10)).unwrap();
        assert_eq!(listed.entries.len(), 1);
        assert_eq!(listed.entries[0].level, "success");

        let cleared = clear_activity_logs().unwrap();
        assert!(cleared.entries.is_empty());

        std::env::remove_var("OZY_STATE_DIR");
    }
}