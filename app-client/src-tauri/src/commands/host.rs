use crate::core::host_discovery::{probe_ssh_host_key, ProbeHostKeyRequest, ProbeHostKeyResponse};

#[tauri::command]
pub async fn probe_ssh_host_key_command(
    request: ProbeHostKeyRequest,
) -> Result<ProbeHostKeyResponse, String> {
    probe_ssh_host_key(request)
        .await
        .map_err(|err| err.to_string())
}
