use tauri::State;

use crate::{
    app_state::AppState,
    collab::{
        audit::{
            self, session_mirror_metadata, shared_vault_node_metadata, shared_vault_save_metadata,
            CollabAuditEntriesResponse, ListCollabAuditEntriesRequest, NewCollabAuditEntry,
        },
        session_mirror::{
            ListSessionMirrorsRequest, SessionMirrorAccessRequest, SessionMirrorSnapshot,
            SessionMirrorSummary, ShareSessionMirrorRequest,
        },
        shared_vault::{
            self, DeleteSharedVaultNodeRequest, ListSharedVaultEntriesRequest,
            SaveSharedVaultRequest, SharedVaultEntriesResponse, SharedVaultResponse,
            UpsertSharedVaultServerRequest,
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
    let response =
        shared_vault::save_shared_vault(request.clone()).map_err(|err| err.to_string())?;
    let _ = audit::record_collab_audit_event(NewCollabAuditEntry {
        event_type: "shared_vault_saved".into(),
        actor_id: request.actor_id,
        target_kind: "shared_vault".into(),
        target_id: response.vault.vault_id.clone(),
        summary: format!("shared vault {} saved", response.vault.name),
        metadata: shared_vault_save_metadata(response.vault.version, &response.vault.name),
    });
    Ok(response)
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
    let response =
        shared_vault::bootstrap_demo_shared_vault(&actor_id).map_err(|err| err.to_string())?;
    let _ = audit::record_collab_audit_event(NewCollabAuditEntry {
        event_type: "shared_vault_bootstrapped".into(),
        actor_id,
        target_kind: "shared_vault".into(),
        target_id: response.vault.vault_id.clone(),
        summary: "demo shared vault bootstrapped".into(),
        metadata: shared_vault_save_metadata(response.vault.version, &response.vault.name),
    });
    Ok(response)
}

#[tauri::command]
pub fn upsert_shared_vault_server_command(
    request: UpsertSharedVaultServerRequest,
) -> Result<SharedVaultResponse, String> {
    let actor_id = request.actor_id.clone();
    let node_id = request.node_id.clone().unwrap_or_default();
    let response =
        shared_vault::upsert_shared_vault_server(request).map_err(|err| err.to_string())?;
    let _ = audit::record_collab_audit_event(NewCollabAuditEntry {
        event_type: "shared_vault_server_upserted".into(),
        actor_id,
        target_kind: "shared_vault_node".into(),
        target_id: if node_id.is_empty() {
            response.vault.vault_id.clone()
        } else {
            node_id.clone()
        },
        summary: "shared vault server upserted".into(),
        metadata: shared_vault_node_metadata(
            if node_id.is_empty() {
                &response.vault.vault_id
            } else {
                &node_id
            },
            "upsert",
            None,
        ),
    });
    Ok(response)
}

#[tauri::command]
pub fn delete_shared_vault_node_command(
    request: DeleteSharedVaultNodeRequest,
) -> Result<SharedVaultResponse, String> {
    let actor_id = request.actor_id.clone();
    let node_id = request.node_id.clone();
    let response =
        shared_vault::delete_shared_vault_node(request).map_err(|err| err.to_string())?;
    let _ = audit::record_collab_audit_event(NewCollabAuditEntry {
        event_type: "shared_vault_node_deleted".into(),
        actor_id,
        target_kind: "shared_vault_node".into(),
        target_id: node_id.clone(),
        summary: "shared vault node deleted".into(),
        metadata: shared_vault_node_metadata(&node_id, "delete", None),
    });
    Ok(response)
}

#[tauri::command]
pub fn share_session_mirror_command(
    state: State<'_, AppState>,
    request: ShareSessionMirrorRequest,
) -> Result<SessionMirrorSnapshot, String> {
    let granted_by_actor_id = request.granted_by_actor_id.clone();
    let target_actor_id = request.target_actor_id.clone();
    let role = format!("{:?}", request.role).to_lowercase();
    let response = state
        .session_mirrors
        .write()
        .share_with_actor(request)
        .map_err(|err| err.to_string())?;
    let _ = audit::record_collab_audit_event(NewCollabAuditEntry {
        event_type: "session_mirror_shared".into(),
        actor_id: granted_by_actor_id,
        target_kind: "session_mirror".into(),
        target_id: response.session_id.to_string(),
        summary: "session mirror shared".into(),
        metadata: session_mirror_metadata(
            &response.session_id.to_string(),
            Some(&role),
            Some(&target_actor_id),
        ),
    });
    Ok(response)
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
    let response = state
        .session_mirrors
        .read()
        .snapshot_for_actor(request.session_id, &request.actor_id)
        .map_err(|err| err.to_string())?;
    let _ = audit::record_collab_audit_event(NewCollabAuditEntry {
        event_type: "session_mirror_viewed".into(),
        actor_id: request.actor_id,
        target_kind: "session_mirror".into(),
        target_id: response.session_id.to_string(),
        summary: "session mirror viewed".into(),
        metadata: session_mirror_metadata(&response.session_id.to_string(), None, None),
    });
    Ok(response)
}

#[tauri::command]
pub fn list_collab_audit_entries_command(
    request: ListCollabAuditEntriesRequest,
) -> Result<CollabAuditEntriesResponse, String> {
    audit::list_collab_audit_entries(request).map_err(|err| err.to_string())
}
