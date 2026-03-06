use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;
use tauri::{ipc::Channel, State};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

use crate::app_state::{AppState, SessionHandle};
use crate::core::session_manager::remove_session;
use crate::core::ssh_client::{connect_ssh, SshSessionRequest, TerminalEvent, TerminalInput};

#[tauri::command]
pub async fn open_session(
    state: State<'_, AppState>,
    request: SshSessionRequest,
    events: Channel<TerminalEvent>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4();
    let (input_tx, input_rx) = mpsc::channel(1024);
    let (event_tx, _) = broadcast::channel(1024);

    state.sessions.write().insert(
        session_id,
        SessionHandle {
            input_tx: input_tx.clone(),
            event_tx: event_tx.clone(),
        },
    );

    let mut event_rx = event_tx.subscribe();
    tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            let _ = events.send(event);
        }
    });

    let state_clone = state.inner().clone();
    tokio::spawn(async move {
        let result = connect_ssh(session_id, request, input_rx, event_tx.clone()).await;
        if let Err(err) = result {
            let _ = event_tx.send(TerminalEvent::Error {
                message: err.to_string(),
            });
            let _ = event_tx.send(TerminalEvent::Closed {
                reason: "session failed".into(),
            });
        }
        remove_session(&state_clone, session_id);
    });

    Ok(session_id.to_string())
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
pub async fn close_session(
    state: State<'_, AppState>,
    session_id: String,
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
        .send(TerminalInput::Close)
        .await
        .map_err(|err| err.to_string())
}
