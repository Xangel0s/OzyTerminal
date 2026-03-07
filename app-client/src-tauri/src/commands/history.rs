use crate::core::recent_connections::{
    list_recent_connections, record_recent_connection, RecentConnectionsResponse,
    RecordRecentConnectionRequest,
};

#[tauri::command]
pub fn list_recent_connections_command() -> Result<RecentConnectionsResponse, String> {
    list_recent_connections().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn record_recent_connection_command(
    request: RecordRecentConnectionRequest,
) -> Result<RecentConnectionsResponse, String> {
    record_recent_connection(request).map_err(|err| err.to_string())
}
