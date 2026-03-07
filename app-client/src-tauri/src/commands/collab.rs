use tauri::State;

use crate::{
    app_state::AppState,
    collab::{
        session_mirror::{
            ListSessionMirrorsRequest, SessionMirrorAccessRequest, SessionMirrorSnapshot,
            SessionMirrorSummary, ShareSessionMirrorRequest,
        },
        shared_vault::{
            self, ListSharedVaultEntriesRequest, SaveSharedVaultRequest,
            SharedVaultEntriesResponse, SharedVaultResponse,
        },
    },
};

#[tauri::command]
pub fn load_shared_vault_command() -> Result<SharedVaultResponse, String> {
    shared_vault::load_shared_vault().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn save_shared_vault_command(
    request: SaveSharedVaultRequest,
) -> Result<SharedVaultResponse, String> {
    shared_vault::save_shared_vault(request).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_shared_vault_entries_command(
    request: ListSharedVaultEntriesRequest,
) -> Result<SharedVaultEntriesResponse, String> {
    shared_vault::list_shared_vault_entries(request).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn bootstrap_demo_shared_vault_command(
    actor_id: String,
) -> Result<SharedVaultResponse, String> {
    shared_vault::bootstrap_demo_shared_vault(&actor_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn share_session_mirror_command(
    state: State<'_, AppState>,
    request: ShareSessionMirrorRequest,
) -> Result<SessionMirrorSnapshot, String> {
    state
        .session_mirrors
        .write()
        .share_with_actor(request)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_session_mirrors_command(
    state: State<'_, AppState>,
    request: ListSessionMirrorsRequest,
) -> Result<Vec<SessionMirrorSummary>, String> {
    Ok(state
        .session_mirrors
        .read()
        .list_for_actor(&request.actor_id))
}

#[tauri::command]
pub fn get_session_mirror_command(
    state: State<'_, AppState>,
    request: SessionMirrorAccessRequest,
) -> Result<SessionMirrorSnapshot, String> {
    state
        .session_mirrors
        .read()
        .snapshot_for_actor(request.session_id, &request.actor_id)
        .map_err(|err| err.to_string())
}
