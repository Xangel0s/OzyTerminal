use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;
use tauri::{ipc::Channel, State};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

use crate::app_state::{AppState, SessionHandle};
use crate::core::session_manager::remove_session;
use crate::core::ssh_client::{
    classify_terminal_error, connect_ssh, SshSessionRequest, TerminalEvent, TerminalInput,
};

#[tauri::command]
pub async fn open_session(
    state: State<'_, AppState>,
    request: SshSessionRequest,
    events: Channel<TerminalEvent>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4();
    let (input_tx, input_rx) = mpsc::channel(1024);
    let (event_tx, _) = broadcast::channel(1024);
    let target_label = format!("{}@{}:{}", request.username, request.host, request.port);
    let mirror_owner_id = request
        .mirror_owner_id
        .clone()
        .unwrap_or_else(|| "local-operator".into());

    state
        .session_mirrors
        .write()
        .register_session(session_id, mirror_owner_id, target_label);

    state.sessions.write().insert(
        session_id,
        SessionHandle {
            input_tx: input_tx.clone(),
        },
    );

    let mut event_rx = event_tx.subscribe();
    let state_for_events = state.inner().clone();
    tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            record_session_mirror_event(&state_for_events, session_id, &event);
            let _ = events.send(event);
        }
    });

    let state_clone = state.inner().clone();
    tokio::spawn(async move {
        let result = connect_ssh(session_id, request, input_rx, event_tx.clone()).await;
        if let Err(err) = result {
            let _ = event_tx.send(TerminalEvent::Error {
                error: classify_terminal_error(&err),
            });
            let _ = event_tx.send(TerminalEvent::Closed {
                reason: "session failed".into(),
            });
        }
        remove_session(&state_clone, session_id);
    });

    Ok(session_id.to_string())
}

fn record_session_mirror_event(state: &AppState, session_id: Uuid, event: &TerminalEvent) {
    let mut mirrors = state.session_mirrors.write();
    match event {
        TerminalEvent::Connected { .. } => mirrors.mark_connected(session_id),
        TerminalEvent::Stdout { chunk_b64 } => {
            if let Ok(bytes) = STANDARD.decode(chunk_b64) {
                let text = String::from_utf8_lossy(&bytes);
                mirrors.append_stdout(session_id, &text);
            }
        }
        TerminalEvent::Closed { reason } => mirrors.mark_closed(session_id, reason),
        TerminalEvent::Error { error } => {
            mirrors.mark_error(session_id, &format!("{}: {}", error.title, error.detail))
        }
    }
}

#[tauri::command]
pub async fn send_input(
    state: State<'_, AppState>,
    session_id: String,
    data_b64: String,
) -> Result<(), String> {
    let session_id = Uuid::parse_str(&session_id).map_err(|err| err.to_string())?;
    let data = STANDARD.decode(data_b64).map_err(|err| err.to_string())?;
    let sender = state
        .sessions
        .read()
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?
        .input_tx
        .clone();

    sender
        .send(TerminalInput::Stdin(Bytes::from(data)))
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn resize_session(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session_id = Uuid::parse_str(&session_id).map_err(|err| err.to_string())?;
    let sender = state
        .sessions
        .read()
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?
        .input_tx
        .clone();

    sender
        .send(TerminalInput::Resize { cols, rows })
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn close_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let session_id = Uuid::parse_str(&session_id).map_err(|err| err.to_string())?;
    let sender = state
        .sessions
        .read()
        .get(&session_id)
        .ok_or_else(|| "session not found".to_string())?
        .input_tx
        .clone();

    sender
        .send(TerminalInput::Close)
        .await
        .map_err(|err| err.to_string())
}
