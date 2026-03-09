use std::sync::{atomic::AtomicU32, Arc};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;
use serde_json::json;
use tauri::{ipc::Channel, State};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

use crate::activity::{record_activity_log, NewActivityLogEntry};
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
    record_session_activity(
        &request,
        "info",
        "SSH session opening",
        &format!("Opening SSH session for {}@{}:{}", request.username, request.host, request.port),
        json!({
            "sessionId": session_id.to_string(),
            "port": request.port,
            "username": request.username,
            "profileName": request.profile_name,
        }),
    );
    register_session_handle(state.inner(), session_id, &request, input_tx.clone());

    let mut event_rx = event_tx.subscribe();
    let state_for_events = state.inner().clone();
    let request_for_events = request.clone();
    tokio::spawn(async move {
        while let Ok(event) = event_rx.recv().await {
            record_session_mirror_event(&state_for_events, session_id, &event);
            record_terminal_event(&request_for_events, session_id, &event);
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

fn record_terminal_event(request: &SshSessionRequest, session_id: Uuid, event: &TerminalEvent) {
    match event {
        TerminalEvent::Connected { .. } => record_session_activity(
            request,
            "success",
            "SSH session connected",
            &format!("Connected as {} on port {}", request.username, request.port),
            json!({
                "sessionId": session_id.to_string(),
                "port": request.port,
            }),
        ),
        TerminalEvent::Closed { reason } => record_session_activity(
            request,
            "info",
            "SSH session closed",
            reason,
            json!({
                "sessionId": session_id.to_string(),
                "reason": reason,
            }),
        ),
        TerminalEvent::Error { error } => record_session_activity(
            request,
            "error",
            "SSH session error",
            &error.detail,
            json!({
                "sessionId": session_id.to_string(),
                "kind": error.kind,
                "title": error.title,
                "retryable": error.retryable,
            }),
        ),
        TerminalEvent::Diagnostic {
            phase,
            message,
            elapsed_ms,
        } => record_session_activity(
            request,
            "info",
            "SSH session diagnostic",
            message,
            json!({
                "sessionId": session_id.to_string(),
                "phase": phase,
                "elapsedMs": elapsed_ms,
            }),
        ),
        TerminalEvent::Stdout { .. } => {}
    }
}

fn record_session_activity(
    request: &SshSessionRequest,
    level: &str,
    action: &str,
    details: &str,
    metadata: serde_json::Value,
) {
    let _ = record_activity_log(NewActivityLogEntry {
        level: level.into(),
        category: "ssh".into(),
        host: Some(request.host.clone()),
        action: action.into(),
        details: details.into(),
        metadata,
    });
}

fn record_session_mirror_event(state: &AppState, session_id: Uuid, event: &TerminalEvent) {
    let mut mirrors = state.session_mirrors.write();
    match event {
        TerminalEvent::Connected { .. } => mirrors.mark_connected(session_id),
        TerminalEvent::Diagnostic { .. } => {}
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
    send_input_inner(state.inner(), session_id, data_b64).await
}

#[tauri::command]
pub async fn resize_session(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    resize_session_inner(state.inner(), session_id, cols, rows).await
}

#[tauri::command]
pub async fn close_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    close_session_inner(state.inner(), session_id).await
}

fn register_session_handle(
    state: &AppState,
    session_id: Uuid,
    request: &SshSessionRequest,
    input_tx: mpsc::Sender<TerminalInput>,
) {
    let target_label = format!("{}@{}:{}", request.username, request.host, request.port);
    let mirror_owner_id = request
        .mirror_owner_id
        .clone()
        .unwrap_or_else(|| "local-operator".into());

    state
        .session_mirrors
        .write()
        .register_session(session_id, mirror_owner_id, target_label);

    state
        .sessions
        .write()
        .insert(
            session_id,
            SessionHandle {
                input_tx,
                host: request.host.clone(),
                port: request.port,
                username: request.username.clone(),
                stdin_count: Arc::new(AtomicU32::new(0)),
            },
        );
}

async fn send_input_inner(
    state: &AppState,
    session_id: String,
    data_b64: String,
) -> Result<(), String> {
    let data = STANDARD.decode(data_b64).map_err(|err| err.to_string())?;
    let session_uuid = Uuid::parse_str(&session_id).map_err(|err| err.to_string())?;
    let (sender, host, port, username, stdin_index) = {
        let sessions = state.sessions.read();
        let handle = sessions
            .get(&session_uuid)
            .ok_or_else(|| "session not found".to_string())?;

        (
            handle.input_tx.clone(),
            handle.host.clone(),
            handle.port,
            handle.username.clone(),
            handle.next_stdin_count(),
        )
    };

    let contains_newline = data.iter().any(|byte| *byte == b'\n' || *byte == b'\r');
    if stdin_index == 1 || contains_newline {
        let action = if stdin_index == 1 {
            "SSH session first input"
        } else {
            "SSH session command submitted"
        };
        let details = if stdin_index == 1 {
            format!(
                "Received first stdin chunk for {}@{}:{}",
                username, host, port
            )
        } else {
            format!(
                "Received stdin chunk with newline for {}@{}:{}",
                username, host, port
            )
        };
        let _ = record_activity_log(NewActivityLogEntry {
            level: "info".into(),
            category: "ssh".into(),
            host: Some(host.clone()),
            action: action.into(),
            details,
            metadata: json!({
                "sessionId": session_uuid.to_string(),
                "username": username,
                "port": port,
                "stdinIndex": stdin_index,
                "byteLength": data.len(),
                "containsNewline": contains_newline,
            }),
        });
    }

    sender
        .send(TerminalInput::Stdin(Bytes::from(data)))
        .await
        .map_err(|err| err.to_string())
}

async fn resize_session_inner(
    state: &AppState,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    dispatch_terminal_input(state, &session_id, TerminalInput::Resize { cols, rows }).await
}

async fn close_session_inner(state: &AppState, session_id: String) -> Result<(), String> {
    dispatch_terminal_input(state, &session_id, TerminalInput::Close).await
}

async fn dispatch_terminal_input(
    state: &AppState,
    session_id: &str,
    input: TerminalInput,
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
        .send(input)
        .await
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        close_session_inner, register_session_handle, resize_session_inner, send_input_inner,
    };
    use crate::{
        app_state::AppState,
        core::ssh_client::{SshSessionRequest, TerminalInput},
    };
    use tokio::sync::mpsc;
    use uuid::Uuid;

    fn sample_request() -> SshSessionRequest {
        SshSessionRequest {
            profile_name: Some("Local test".into()),
            host: "127.0.0.1".into(),
            port: 22,
            username: "ozy".into(),
            password: None,
            private_key_pem: "PRIVATE KEY".into(),
            private_key_passphrase: None,
            certificate_pem: None,
            known_host_fingerprint: None,
            cols: 120,
            rows: 40,
            relay_hint: None,
            control_plane: None,
            mirror_owner_id: Some("owner-1".into()),
        }
    }

    #[test]
    fn register_session_handle_tracks_mirror_and_session() {
        let state = AppState::default();
        let session_id = Uuid::new_v4();
        let (input_tx, _input_rx) = mpsc::channel(4);

        register_session_handle(&state, session_id, &sample_request(), input_tx);

        assert!(state.sessions.read().contains_key(&session_id));

        let snapshot = state
            .session_mirrors
            .read()
            .snapshot_for_actor(session_id, "owner-1")
            .expect("mirror snapshot");
        assert_eq!(snapshot.target_label, "ozy@127.0.0.1:22");
        assert_eq!(snapshot.status, "opening");
    }

    #[tokio::test]
    async fn command_helpers_send_stdin_resize_and_close() {
        let state = AppState::default();
        let session_id = Uuid::new_v4();
        let (input_tx, mut input_rx) = mpsc::channel(4);

        register_session_handle(&state, session_id, &sample_request(), input_tx);

        send_input_inner(&state, session_id.to_string(), "aGVsbG8K".into())
            .await
            .expect("stdin dispatch");
        resize_session_inner(&state, session_id.to_string(), 160, 48)
            .await
            .expect("resize dispatch");
        close_session_inner(&state, session_id.to_string())
            .await
            .expect("close dispatch");

        match input_rx.recv().await.expect("stdin message") {
            TerminalInput::Stdin(bytes) => assert_eq!(bytes.as_ref(), b"hello\n"),
            other => panic!("expected stdin, got {other:?}"),
        }

        match input_rx.recv().await.expect("resize message") {
            TerminalInput::Resize { cols, rows } => {
                assert_eq!(cols, 160);
                assert_eq!(rows, 48);
            }
            other => panic!("expected resize, got {other:?}"),
        }

        match input_rx.recv().await.expect("close message") {
            TerminalInput::Close => {}
            other => panic!("expected close, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn command_helpers_fail_for_missing_session() {
        let state = AppState::default();

        let error = close_session_inner(&state, Uuid::new_v4().to_string())
            .await
            .expect_err("missing session should fail");

        assert_eq!(error, "session not found");
    }
}
