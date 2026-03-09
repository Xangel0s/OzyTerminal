use std::{sync::Arc, time::Instant};

use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use russh::{client, keys, ChannelMsg};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc};
use tracing::info;
use uuid::Uuid;

use crate::core::zero_copy::encode_chunk;
use crate::core::{
    control_plane::{
        issue_relay_lease, issue_ssh_certificate, ControlPlaneConfig,
        IssueRelayLeaseCommandRequest, IssueSshCertificateCommandRequest,
    },
    pty::DEFAULT_TERM,
};
use crate::tunnel::relay_client::connect_via_relay;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayHint {
    pub relay_url: String,
    pub token: String,
    pub target_node_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSessionRequest {
    pub profile_name: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_pem: String,
    pub private_key_passphrase: Option<String>,
    pub password: Option<String>,
    pub certificate_pem: Option<String>,
    pub known_host_fingerprint: Option<String>,
    pub cols: u32,
    pub rows: u32,
    pub relay_hint: Option<RelayHint>,
    pub control_plane: Option<ControlPlaneConfig>,
    pub mirror_owner_id: Option<String>,
}

#[derive(Debug)]
pub enum TerminalInput {
    Stdin(Bytes),
    Resize { cols: u16, rows: u16 },
    Close,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalErrorKind {
    Configuration,
    Connection,
    HostKey,
    Authentication,
    ControlPlane,
    Relay,
    Certificate,
    Shell,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalErrorPayload {
    pub kind: TerminalErrorKind,
    pub title: String,
    pub detail: String,
    pub suggestion: Option<String>,
    pub retryable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TerminalEvent {
    Connected { session_id: Uuid },
    Diagnostic {
        phase: String,
        message: String,
        elapsed_ms: u64,
    },
    Stdout { chunk_b64: String },
    Closed { reason: String },
    Error { error: TerminalErrorPayload },
}

fn emit_diagnostic(
    event_tx: &broadcast::Sender<TerminalEvent>,
    started_at: Instant,
    phase: &str,
    message: impl Into<String>,
) {
    let elapsed_ms = started_at.elapsed().as_millis() as u64;
    let message = message.into();

    let _ = event_tx.send(TerminalEvent::Diagnostic {
        phase: phase.into(),
        message: message.clone(),
        elapsed_ms,
    });

    info!(phase, elapsed_ms, diagnostic_message = %message, "ssh session diagnostic");
}

#[derive(Debug, Default)]
pub struct OzyClient {
    pub expected_host_fingerprint: Option<String>,
}

impl client::Handler for OzyClient {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &keys::ssh_key::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        let expected = self.expected_host_fingerprint.clone();
        let server_public_key = server_public_key.clone();
        async move {
            if let Some(expected) = expected.as_deref() {
                let sha256 = server_public_key
                    .fingerprint(keys::HashAlg::Sha256)
                    .to_string();
                let openssh = server_public_key.to_openssh().map_err(|err| {
                    russh::Error::IO(std::io::Error::new(std::io::ErrorKind::InvalidData, err))
                })?;
                return Ok(expected == sha256 || expected == openssh);
            }

            Ok(true)
        }
    }
}

pub(crate) async fn establish_authenticated_session(
    request: &SshSessionRequest,
    event_tx: &broadcast::Sender<TerminalEvent>,
) -> Result<client::Handle<OzyClient>> {
    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(std::time::Duration::from_secs(15)),
        keepalive_max: 3,
        ..Default::default()
    });

    let handler = OzyClient {
        expected_host_fingerprint: request.known_host_fingerprint.clone(),
    };

    let resolved_relay = resolve_relay_hint(request, event_tx)
        .await
        .context("relay resolution failed")?;
    let mut session = if let Some(relay) = resolved_relay.as_ref() {
        let stream = connect_via_relay(relay)
            .await
            .context("relay data connection failed")?;
        client::connect_stream(config, stream, handler)
            .await
            .context("ssh handshake failed over relay")?
    } else {
        client::connect(config, (request.host.as_str(), request.port), handler)
            .await
            .context("ssh handshake failed")?
    };

    let has_password = request.password.as_ref().is_some_and(|p| !p.trim().is_empty());
    let has_private_key = !request.private_key_pem.trim().is_empty();

    if has_private_key {
        let private_key_auth = async {
            let private_key = Arc::new(load_private_key(
                &request.private_key_pem,
                request.private_key_passphrase.as_deref(),
            )?);

            let certificate_pem = resolve_certificate_pem(request, event_tx)
                .await
                .context("certificate resolution failed")?;

            authenticate_session(
                &mut session,
                &request.username,
                private_key.clone(),
                certificate_pem.as_deref(),
            )
            .await
            .context("ssh authentication failed")
        }
        .await;

        match private_key_auth {
            Ok(()) => {}
            Err(key_error) if has_password => {
                emit_diagnostic(
                    event_tx,
                    Instant::now(),
                    "auth_fallback_password",
                    format!(
                        "La autenticacion por clave fallo; se intenta password para {}",
                        request.username
                    ),
                );
                authenticate_session_password(
                    &mut session,
                    &request.username,
                    request.password.as_deref().unwrap_or_default(),
                )
                .await
                .with_context(|| format!(
                    "ssh password authentication failed after key auth fallback: {key_error}"
                ))?;
            }
            Err(key_error) => return Err(key_error),
        }
    } else if has_password {
        authenticate_session_password(
            &mut session,
            &request.username,
            request.password.as_deref().unwrap_or_default(),
        )
        .await
        .context("ssh password authentication failed")?;
    } else {
        return Err(anyhow!("no valid authentication method was provided"));
    }

    Ok(session)
}

pub async fn connect_ssh(
    session_id: Uuid,
    request: SshSessionRequest,
    mut input_rx: mpsc::Receiver<TerminalInput>,
    event_tx: broadcast::Sender<TerminalEvent>,
) -> Result<()> {
    let started_at = Instant::now();
    emit_diagnostic(
        &event_tx,
        started_at,
        "transport_connecting",
        format!("Iniciando transporte SSH hacia {}:{}", request.host, request.port),
    );

    let session = establish_authenticated_session(&request, &event_tx).await?;
    emit_diagnostic(
        &event_tx,
        started_at,
        "authenticated",
        format!("Autenticacion aceptada para {}", request.username),
    );

    let mut channel = session
        .channel_open_session()
        .await
        .context("ssh shell channel open failed")?;
    emit_diagnostic(
        &event_tx,
        started_at,
        "channel_opened",
        "Canal de shell SSH abierto",
    );

    channel
        .request_pty(false, DEFAULT_TERM, request.cols, request.rows, 0, 0, &[])
        .await
        .context("ssh pty request failed")?;
    emit_diagnostic(
        &event_tx,
        started_at,
        "pty_ready",
        format!("PTY remoto negociado en {}x{}", request.cols, request.rows),
    );

    channel
        .request_shell(true)
        .await
        .context("ssh shell request failed")?;
    emit_diagnostic(
        &event_tx,
        started_at,
        "shell_requested",
        "Shell interactivo solicitado al servidor",
    );

    let _ = event_tx.send(TerminalEvent::Connected { session_id });
    let _ = event_tx.send(TerminalEvent::Stdout {
        chunk_b64: encode_chunk(Bytes::from(format!(
            "Connected to {}:{} as {}\r\n",
            request.host, request.port, request.username
        ))),
    });
    emit_diagnostic(
        &event_tx,
        started_at,
        "session_connected",
        format!("Sesion lista para recibir input en {} ms", started_at.elapsed().as_millis()),
    );
    info!(%session_id, host = %request.host, port = request.port, "ssh session opened");

    let mut first_output_seen = false;
    let mut last_exit_status: Option<u32> = None;
    let mut last_exit_signal: Option<String> = None;

    loop {
        tokio::select! {
            biased;

            input = input_rx.recv() => {
                match input {
                    Some(TerminalInput::Stdin(chunk)) => {
                        channel
                            .data(chunk.as_ref())
                            .await
                            .context("failed to forward stdin to ssh channel")?;
                    }
                    Some(TerminalInput::Resize { cols, rows }) => {
                        channel
                            .window_change(cols as u32, rows as u32, 0, 0)
                            .await
                            .context("failed to resize ssh pty")?;
                    }
                    Some(TerminalInput::Close) => {
                        emit_diagnostic(
                            &event_tx,
                            started_at,
                            "client_close",
                            "Cierre solicitado por el cliente",
                        );
                        let _ = channel.eof().await;
                        let _ = channel.close().await;
                        let _ = event_tx.send(TerminalEvent::Closed {
                            reason: "closed by client".into(),
                        });
                        break;
                    }
                    None => break,
                }
            }

            message = channel.wait() => {
                match message {
                    Some(ChannelMsg::Data { data }) => {
                        if !first_output_seen {
                            first_output_seen = true;
                            emit_diagnostic(
                                &event_tx,
                                started_at,
                                "first_stdout",
                                format!("Primer bloque de salida recibido ({} bytes)", data.len()),
                            );
                        }
                        let _ = event_tx.send(TerminalEvent::Stdout {
                            chunk_b64: encode_chunk(Bytes::copy_from_slice(data.as_ref())),
                        });
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        if !first_output_seen {
                            first_output_seen = true;
                            emit_diagnostic(
                                &event_tx,
                                started_at,
                                "first_stdout",
                                format!("Primer bloque de salida extendida recibido ({} bytes)", data.len()),
                            );
                        }
                        let _ = event_tx.send(TerminalEvent::Stdout {
                            chunk_b64: encode_chunk(Bytes::copy_from_slice(data.as_ref())),
                        });
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        last_exit_status = Some(exit_status);
                        emit_diagnostic(
                            &event_tx,
                            started_at,
                            "remote_exit_status",
                            format!("El servidor reporto exit-status={exit_status}"),
                        );
                    }
                    Some(ChannelMsg::ExitSignal {
                        signal_name,
                        core_dumped,
                        error_message,
                        lang_tag,
                    }) => {
                        let description = format!(
                            "El servidor reporto exit-signal={signal_name:?}, core_dumped={core_dumped}, message={error_message}, lang={lang_tag}"
                        );
                        last_exit_signal = Some(description.clone());
                        emit_diagnostic(
                            &event_tx,
                            started_at,
                            "remote_exit_signal",
                            description,
                        );
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                        let reason = match (last_exit_status, last_exit_signal.as_deref()) {
                            (Some(exit_status), Some(exit_signal)) => {
                                format!("remote closed channel (exit status {exit_status}; {exit_signal})")
                            }
                            (Some(exit_status), None) => {
                                format!("remote closed channel (exit status {exit_status})")
                            }
                            (None, Some(exit_signal)) => {
                                format!("remote closed channel ({exit_signal})")
                            }
                            (None, None) => "remote closed channel".into(),
                        };
                        emit_diagnostic(
                            &event_tx,
                            started_at,
                            "remote_close",
                            reason.clone(),
                        );
                        let _ = event_tx.send(TerminalEvent::Closed {
                            reason,
                        });
                        break;
                    }
                    Some(ChannelMsg::Success)
                    | Some(ChannelMsg::Failure)
                    | Some(ChannelMsg::WindowAdjusted { .. }) => {}
                    Some(other) => {
                        let _ = event_tx.send(TerminalEvent::Stdout {
                            chunk_b64: encode_chunk(Bytes::from(format!("[ssh-event] {:?}\r\n", other))),
                        });
                    }
                    None => {
                        let reason = match (last_exit_status, last_exit_signal.as_deref()) {
                            (Some(exit_status), Some(exit_signal)) => {
                                format!("channel finished (exit status {exit_status}; {exit_signal})")
                            }
                            (Some(exit_status), None) => {
                                format!("channel finished (exit status {exit_status})")
                            }
                            (None, Some(exit_signal)) => {
                                format!("channel finished ({exit_signal})")
                            }
                            (None, None) => "channel finished".into(),
                        };
                        emit_diagnostic(
                            &event_tx,
                            started_at,
                            "channel_finished",
                            reason.clone(),
                        );
                        let _ = event_tx.send(TerminalEvent::Closed {
                            reason,
                        });
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}

pub fn classify_terminal_error(error: &anyhow::Error) -> TerminalErrorPayload {
    let detail = format_error_detail(error);
    let haystack = detail.to_lowercase();

    let (kind, title, suggestion, retryable) = if haystack.contains("failed to decode private key")
        || haystack.contains("private key load failed")
    {
        (
            TerminalErrorKind::Configuration,
            "La clave privada no se pudo cargar",
            Some("Revisa el PEM y la passphrase antes de volver a conectar."),
            false,
        )
    } else if haystack.contains("failed to load openssh certificate")
        || haystack.contains("failed to parse existing openssh certificate")
        || haystack.contains("certificate resolution failed")
    {
        (
            TerminalErrorKind::Certificate,
            "El certificado SSH no es valido",
            Some(
                "Emite un certificado nuevo o limpia el certificado guardado antes de reintentar.",
            ),
            false,
        )
    } else if haystack.contains("certificate authentication failed")
        || haystack.contains("public key authentication failed")
        || haystack.contains("ssh authentication failed")
        || haystack.contains("permission denied")
    {
        (
            TerminalErrorKind::Authentication,
            "El servidor rechazo la autenticacion",
            Some("Confirma usuario, clave privada, certificado y principals antes de reintentar."),
            false,
        )
    } else if haystack.contains("unknown key")
        || haystack.contains("unknownkey")
        || haystack.contains("server key")
        || haystack.contains("host key")
        || haystack.contains("fingerprint")
    {
        (
            TerminalErrorKind::HostKey,
            "La host key no coincide con la esperada",
            Some("Vuelve a descubrir la host key y confiala explicitamente si el servidor es correcto."),
            false,
        )
    } else if haystack.contains("failed to call control-plane")
        || haystack.contains("invalid control-plane bearer token")
        || haystack.contains("control-plane base url is required")
        || haystack.contains("control-plane returned http 401")
        || haystack.contains("control-plane returned http 403")
    {
        (
            TerminalErrorKind::ControlPlane,
            "El control-plane rechazo o no pudo atender la solicitud",
            Some("Verifica la base URL, el bearer token y que el servicio este disponible."),
            true,
        )
    } else if haystack.contains("relay resolution failed")
        || haystack.contains("relay data connection failed")
        || haystack.contains("failed to connect to relay")
        || haystack.contains("failed to send relay hello")
        || haystack.contains("relay target node")
        || haystack.contains("relay token")
        || haystack.contains("relay_url")
    {
        (
            TerminalErrorKind::Relay,
            "No se pudo preparar el relay para la sesion",
            Some("Revisa target node, lease/token y la conectividad hacia el relay antes de reintentar."),
            true,
        )
    } else if haystack.contains("ssh shell")
        || haystack.contains("ssh pty request failed")
        || haystack.contains("channel open")
        || haystack.contains("failed to forward stdin")
        || haystack.contains("failed to resize ssh pty")
    {
        (
            TerminalErrorKind::Shell,
            "La sesion SSH no pudo abrir un shell interactivo",
            Some("Confirma que el servidor permite PTY y shell para esta cuenta."),
            true,
        )
    } else if haystack.contains("ssh handshake failed")
        || haystack.contains("connection refused")
        || haystack.contains("timed out")
        || haystack.contains("dns")
        || haystack.contains("no such host")
        || haystack.contains("failed to lookup address")
        || haystack.contains("network is unreachable")
        || haystack.contains("connection reset")
    {
        (
            TerminalErrorKind::Connection,
            "No se pudo establecer la conexion SSH",
            Some("Verifica host, puerto, DNS y conectividad de red antes de reintentar."),
            true,
        )
    } else {
        (
            TerminalErrorKind::Unknown,
            "La sesion fallo por una condicion no clasificada",
            Some("Revisa el detalle completo en la UI o en los logs locales antes de reintentar."),
            true,
        )
    };

    TerminalErrorPayload {
        kind,
        title: title.to_string(),
        detail,
        suggestion: suggestion.map(str::to_string),
        retryable,
    }
}

fn format_error_detail(error: &anyhow::Error) -> String {
    let mut messages = Vec::new();
    for cause in error.chain() {
        let message = cause.to_string();
        if messages.last() != Some(&message) {
            messages.push(message);
        }
    }

    messages.join(": ")
}

fn load_private_key(private_key_pem: &str, passphrase: Option<&str>) -> Result<keys::PrivateKey> {
    keys::decode_secret_key(private_key_pem, passphrase).context("failed to decode private key")
}

fn load_inline_certificate(certificate_pem: &str) -> Result<keys::Certificate> {
    keys::Certificate::from_openssh(certificate_pem).context("failed to load openssh certificate")
}

async fn authenticate_session(
    session: &mut client::Handle<OzyClient>,
    username: &str,
    private_key: Arc<keys::PrivateKey>,
    certificate_pem: Option<&str>,
) -> Result<()> {
    if let Some(certificate_pem) = certificate_pem {
        let cert = load_inline_certificate(certificate_pem)?;
        let auth = session
            .authenticate_openssh_cert(username.to_string(), private_key, cert)
            .await?;
        if !auth.success() {
            return Err(anyhow!("certificate authentication failed"));
        }
        return Ok(());
    }

    let auth = session
        .authenticate_publickey(
            username.to_string(),
            keys::PrivateKeyWithHashAlg::new(
                private_key,
                session.best_supported_rsa_hash().await?.flatten(),
            ),
        )
        .await?;
    if !auth.success() {
        return Err(anyhow!("public key authentication failed"));
    }

    Ok(())
}

async fn authenticate_session_password(
    session: &mut client::Handle<OzyClient>,
    username: &str,
    password: &str,
) -> Result<()> {
    let auth = session
        .authenticate_password(username.to_string(), password)
        .await?;
    if !auth.success() {
        return Err(anyhow!("password authentication failed"));
    }

    Ok(())
}

async fn resolve_certificate_pem(
    request: &SshSessionRequest,
    event_tx: &broadcast::Sender<TerminalEvent>,
) -> Result<Option<String>> {
    let Some(control_plane) = request.control_plane.clone() else {
        return Ok(request.certificate_pem.clone());
    };

    let resolved = issue_ssh_certificate(IssueSshCertificateCommandRequest {
        host: request.host.clone(),
        username: request.username.clone(),
        private_key_pem: request.private_key_pem.clone(),
        private_key_passphrase: request.private_key_passphrase.clone(),
        existing_certificate_pem: request.certificate_pem.clone(),
        control_plane,
        reuse_if_fresh: Some(true),
    })
    .await
    .context("failed to issue or reuse ssh certificate from control-plane")?;

    let source = match resolved.source {
        crate::core::control_plane::CertificateSource::Existing => "reused",
        crate::core::control_plane::CertificateSource::ControlPlane => "issued",
    };
    let _ = event_tx.send(TerminalEvent::Stdout {
        chunk_b64: encode_chunk(Bytes::from(format!(
            "[control-plane] {source} ssh certificate `{}` valid until {}\r\n",
            resolved.key_id, resolved.expires_at
        ))),
    });

    Ok(Some(resolved.certificate_pem))
}

async fn resolve_relay_hint(
    request: &SshSessionRequest,
    event_tx: &broadcast::Sender<TerminalEvent>,
) -> Result<Option<RelayHint>> {
    let Some(relay_hint) = request.relay_hint.clone() else {
        return Ok(None);
    };

    if relay_hint.target_node_id.trim().is_empty() {
        return Err(anyhow!("relay target node is required"));
    }

    if !relay_hint.relay_url.trim().is_empty() && !relay_hint.token.trim().is_empty() {
        return Ok(Some(relay_hint));
    }

    let Some(control_plane) = request.control_plane.clone() else {
        return Err(anyhow!(
            "relay_url and token are required unless control_plane is configured"
        ));
    };

    let lease = issue_relay_lease(IssueRelayLeaseCommandRequest {
        target_node_id: relay_hint.target_node_id.clone(),
        requested_port: Some(request.port),
        purpose: Some("ssh".into()),
        control_plane,
    })
    .await
    .context("failed to issue relay lease from control-plane")?;

    let _ = event_tx.send(TerminalEvent::Stdout {
        chunk_b64: encode_chunk(Bytes::from(format!(
            "[control-plane] issued relay lease `{}` for node `{}` until {}\r\n",
            lease.lease_id, lease.target_node_id, lease.expires_at
        ))),
    });

    Ok(Some(RelayHint {
        relay_url: lease.relay_address,
        token: lease.token,
        target_node_id: lease.target_node_id,
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        classify_terminal_error, connect_ssh, SshSessionRequest, TerminalErrorKind, TerminalEvent,
        TerminalInput,
    };
    use crate::core::control_plane::ControlPlaneConfig;
    use axum::{
        extract::State,
        http::{HeaderMap, StatusCode},
        routing::post,
        Json, Router,
    };
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use bytes::Bytes;
    use rand::rngs::OsRng;
    use russh::{
        keys::{self, HashAlg},
        server::{self, Msg},
        ChannelId, CryptoVec, Preferred,
    };
    use serde::{Deserialize, Serialize};
    use std::{
        sync::Arc,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    use tokio::{
        net::TcpListener,
        sync::{broadcast, mpsc, Mutex},
        time::timeout,
    };
    use uuid::Uuid;

    #[derive(Clone)]
    struct TestServer {
        auth_mode: AuthMode,
        state: ServerState,
    }

    #[derive(Clone)]
    enum AuthMode {
        PublicKey {
            username: String,
            expected_key: keys::PublicKey,
        },
        Certificate {
            username: String,
            trusted_ca: keys::ssh_key::Fingerprint,
        },
    }

    #[derive(Clone, Default)]
    struct ServerState {
        last_resize: Arc<Mutex<Option<(u32, u32)>>>,
    }

    impl server::Server for TestServer {
        type Handler = Self;

        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
            self.clone()
        }
    }

    impl server::Handler for TestServer {
        type Error = russh::Error;

        async fn channel_open_session(
            &mut self,
            _channel: russh::Channel<Msg>,
            _session: &mut server::Session,
        ) -> Result<bool, Self::Error> {
            Ok(true)
        }

        async fn auth_publickey(
            &mut self,
            user: &str,
            key: &keys::PublicKey,
        ) -> Result<server::Auth, Self::Error> {
            match &self.auth_mode {
                AuthMode::PublicKey {
                    username,
                    expected_key,
                } if user == username && key == expected_key => Ok(server::Auth::Accept),
                _ => Ok(server::Auth::Reject {
                    proceed_with_methods: None,
                }),
            }
        }

        async fn auth_openssh_certificate(
            &mut self,
            user: &str,
            certificate: &keys::Certificate,
        ) -> Result<server::Auth, Self::Error> {
            match &self.auth_mode {
                AuthMode::Certificate {
                    username,
                    trusted_ca,
                } if user == username
                    && certificate
                        .validate_at(unix_timestamp(), std::slice::from_ref(trusted_ca))
                        .is_ok()
                    && certificate
                        .valid_principals()
                        .iter()
                        .any(|principal| principal == user) =>
                {
                    Ok(server::Auth::Accept)
                }
                _ => Ok(server::Auth::Reject {
                    proceed_with_methods: None,
                }),
            }
        }

        async fn pty_request(
            &mut self,
            channel: ChannelId,
            _term: &str,
            col_width: u32,
            row_height: u32,
            _pix_width: u32,
            _pix_height: u32,
            _modes: &[(russh::Pty, u32)],
            session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            *self.state.last_resize.lock().await = Some((col_width, row_height));
            session.channel_success(channel)?;
            Ok(())
        }

        async fn shell_request(
            &mut self,
            channel: ChannelId,
            session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            session.channel_success(channel)?;
            session.data(channel, CryptoVec::from_slice(b"welcome\r\n"))?;
            Ok(())
        }

        async fn window_change_request(
            &mut self,
            channel: ChannelId,
            col_width: u32,
            row_height: u32,
            _pix_width: u32,
            _pix_height: u32,
            session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            *self.state.last_resize.lock().await = Some((col_width, row_height));
            session.channel_success(channel)?;
            Ok(())
        }

        async fn data(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            session: &mut server::Session,
        ) -> Result<(), Self::Error> {
            let text = String::from_utf8_lossy(data);
            if text.contains("exit") {
                session.data(channel, CryptoVec::from_slice(b"bye\r\n"))?;
                session.eof(channel)?;
                session.close(channel)?;
                return Ok(());
            }

            let message = format!("echo:{text}");
            session.data(channel, CryptoVec::from(message.into_bytes()))?;
            Ok(())
        }
    }

    #[tokio::test]
    async fn connects_with_public_key_and_handles_io() {
        let subject_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("subject key");
        let request = SessionHarness::spawn(
            AuthMode::PublicKey {
                username: "ozy".into(),
                expected_key: subject_key.public_key().clone(),
            },
            subject_key,
            None,
            None,
        )
        .await;

        let mut events = request.events;
        assert!(wait_for_connected(&mut events).await);
        assert!(wait_for_stdout(&mut events, "welcome").await);
        request
            .input_tx
            .send(TerminalInput::Stdin(Bytes::from_static(b"hello\n")))
            .await
            .expect("send stdin");
        request
            .input_tx
            .send(TerminalInput::Resize {
                cols: 160,
                rows: 48,
            })
            .await
            .expect("send resize");
        assert!(wait_for_stdout(&mut events, "echo:hello").await);
        request
            .input_tx
            .send(TerminalInput::Close)
            .await
            .expect("close session");
        assert!(wait_for_closed(&mut events, "closed by client").await);
        assert_eq!(
            *request.server_state.last_resize.lock().await,
            Some((160, 48))
        );

        request
            .task
            .await
            .expect("client task")
            .expect("ssh result");
    }

    #[tokio::test]
    async fn connects_with_openssh_certificate() {
        let ca_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("ca key");
        let subject_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("subject key");
        let cert = issue_certificate(&ca_key, subject_key.public_key(), "ozy", 300).expect("cert");
        let request = SessionHarness::spawn(
            AuthMode::Certificate {
                username: "ozy".into(),
                trusted_ca: ca_key.fingerprint(HashAlg::Sha256),
            },
            subject_key,
            Some(cert),
            None,
        )
        .await;

        let mut events = request.events;
        assert!(wait_for_connected(&mut events).await);
        request
            .input_tx
            .send(TerminalInput::Stdin(Bytes::from_static(b"exit\n")))
            .await
            .expect("send stdin");

        assert!(wait_for_stdout(&mut events, "bye").await);
        assert!(wait_for_closed(&mut events, "remote closed channel").await);

        request
            .task
            .await
            .expect("client task")
            .expect("ssh result");
    }

    #[tokio::test]
    async fn connects_with_control_plane_certificate_issue() {
        let ca_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("ca key");
        let subject_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("subject key");
        let control_plane = spawn_mock_control_plane(ca_key.clone(), Some("cp-token".into())).await;
        let request = SessionHarness::spawn(
            AuthMode::Certificate {
                username: "ozy".into(),
                trusted_ca: ca_key.fingerprint(HashAlg::Sha256),
            },
            subject_key,
            None,
            Some(ControlPlaneConfig {
                base_url: control_plane.base_url.clone(),
                access_token: Some("cp-token".into()),
                environment: Some("development".into()),
                principals: vec!["ozy".into()],
                ttl_seconds: Some(300),
                renew_before_seconds: Some(60),
            }),
        )
        .await;

        let mut events = request.events;
        assert!(wait_for_stdout(&mut events, "[control-plane] issued ssh certificate").await);
        assert!(wait_for_connected(&mut events).await);
        request
            .input_tx
            .send(TerminalInput::Stdin(Bytes::from_static(b"exit\n")))
            .await
            .expect("send stdin");
        assert!(wait_for_stdout(&mut events, "bye").await);
        assert!(wait_for_closed(&mut events, "remote closed channel").await);
        assert_eq!(*control_plane.issue_count.lock().await, 1);

        request
            .task
            .await
            .expect("client task")
            .expect("ssh result");
    }

    #[tokio::test]
    async fn reuses_fresh_control_plane_certificate_without_refresh() {
        let ca_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("ca key");
        let subject_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("subject key");
        let cert = issue_certificate(&ca_key, subject_key.public_key(), "ozy", 300).expect("cert");
        let request = SessionHarness::spawn(
            AuthMode::Certificate {
                username: "ozy".into(),
                trusted_ca: ca_key.fingerprint(HashAlg::Sha256),
            },
            subject_key,
            Some(cert),
            Some(ControlPlaneConfig {
                base_url: "http://127.0.0.1:9".into(),
                access_token: None,
                environment: Some("development".into()),
                principals: vec!["ozy".into()],
                ttl_seconds: Some(300),
                renew_before_seconds: Some(60),
            }),
        )
        .await;

        let mut events = request.events;
        assert!(wait_for_stdout(&mut events, "[control-plane] reused ssh certificate").await);
        assert!(wait_for_connected(&mut events).await);

        request
            .input_tx
            .send(TerminalInput::Close)
            .await
            .expect("close session");
        assert!(wait_for_closed(&mut events, "closed by client").await);

        request
            .task
            .await
            .expect("client task")
            .expect("ssh result");
    }

    struct SessionHarness {
        input_tx: mpsc::Sender<TerminalInput>,
        events: broadcast::Receiver<TerminalEvent>,
        server_state: ServerState,
        task: tokio::task::JoinHandle<anyhow::Result<()>>,
    }

    impl SessionHarness {
        async fn spawn(
            auth_mode: AuthMode,
            subject_key: keys::PrivateKey,
            certificate_pem: Option<String>,
            control_plane: Option<ControlPlaneConfig>,
        ) -> Self {
            let server_state = ServerState::default();
            let host_key =
                keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("host key");
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind listener");
            let server_addr = listener.local_addr().expect("listener addr");
            let host_fingerprint = host_key.fingerprint(HashAlg::Sha256).to_string();
            let server = TestServer {
                auth_mode,
                state: server_state.clone(),
            };

            let config = Arc::new(server::Config {
                inactivity_timeout: Some(Duration::from_secs(30)),
                auth_rejection_time: Duration::from_millis(100),
                auth_rejection_time_initial: Some(Duration::from_millis(0)),
                keys: vec![host_key],
                preferred: Preferred::default(),
                ..Default::default()
            });

            tokio::spawn(async move {
                let (socket, _) = listener.accept().await.expect("accept socket");
                server::run_stream(config, socket, server)
                    .await
                    .expect("run server stream");
            });

            let private_key_pem = subject_key
                .to_openssh(keys::ssh_key::LineEnding::LF)
                .expect("encode private key")
                .to_string();
            let (input_tx, input_rx) = mpsc::channel(32);
            let (event_tx, _) = broadcast::channel(64);
            let events = event_tx.subscribe();
            let task = tokio::spawn(connect_ssh(
                Uuid::new_v4(),
                SshSessionRequest {
                    profile_name: None,
                    host: "127.0.0.1".into(),
                    port: server_addr.port(),
                    username: "ozy".into(),
                    password: None,
                    private_key_pem,
                    private_key_passphrase: None,
                    certificate_pem,
                    known_host_fingerprint: Some(host_fingerprint),
                    cols: 120,
                    rows: 40,
                    relay_hint: None,
                    control_plane,
                    mirror_owner_id: None,
                },
                input_rx,
                event_tx,
            ));

            Self {
                input_tx,
                events,
                server_state,
                task,
            }
        }
    }

    fn issue_certificate(
        ca_key: &keys::PrivateKey,
        subject_key: &keys::PublicKey,
        username: &str,
        ttl_seconds: u64,
    ) -> anyhow::Result<String> {
        use keys::ssh_key::certificate::{Builder, CertType};

        let issued_at = unix_timestamp();
        let mut builder = Builder::new_with_random_nonce(
            &mut OsRng,
            subject_key.clone(),
            issued_at,
            issued_at + ttl_seconds,
        )?;
        builder.cert_type(CertType::User)?;
        builder.key_id(format!("{username}-cert"))?;
        builder.valid_principal(username)?;
        builder.extension("permit-pty", "")?;
        builder.extension("permit-user-rc", "")?;
        builder.comment(format!("{username}@ozyterminal.test"))?;

        Ok(builder.sign(ca_key)?.to_openssh()?)
    }

    #[derive(Clone)]
    struct MockControlPlane {
        base_url: String,
        issue_count: Arc<Mutex<u32>>,
    }

    #[derive(Clone)]
    struct MockControlPlaneState {
        ca_key: keys::PrivateKey,
        expected_token: Option<String>,
        issue_count: Arc<Mutex<u32>>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct MockIssueCertRequest {
        username: String,
        target_host: String,
        public_key_openssh: String,
        ttl_seconds: Option<u64>,
        principals: Vec<String>,
        environment: Option<String>,
    }

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct MockIssueCertResponse {
        certificate_id: String,
        serial: u64,
        issued_at: u64,
        expires_at: u64,
        ca_key_id: String,
        ca_public_key_openssh: String,
        ca_fingerprint_sha256: String,
        key_id: String,
        certificate_pem: String,
        certificate_openssh: String,
        principals: Vec<String>,
    }

    async fn spawn_mock_control_plane(
        ca_key: keys::PrivateKey,
        expected_token: Option<String>,
    ) -> MockControlPlane {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind control-plane listener");
        let addr = listener.local_addr().expect("control-plane addr");
        let issue_count = Arc::new(Mutex::new(0));
        let state = MockControlPlaneState {
            ca_key,
            expected_token,
            issue_count: issue_count.clone(),
        };

        let app = Router::new()
            .route("/v1/ssh/certificates/issue", post(mock_issue_certificate))
            .with_state(state);

        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("mock control-plane serve");
        });

        MockControlPlane {
            base_url: format!("http://{}", addr),
            issue_count,
        }
    }

    async fn mock_issue_certificate(
        State(state): State<MockControlPlaneState>,
        headers: HeaderMap,
        Json(request): Json<MockIssueCertRequest>,
    ) -> Result<Json<MockIssueCertResponse>, StatusCode> {
        if let Some(expected_token) = state.expected_token.as_deref() {
            let Some(header_value) = headers
                .get(axum::http::header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())
            else {
                return Err(StatusCode::UNAUTHORIZED);
            };
            if header_value != format!("Bearer {expected_token}") {
                return Err(StatusCode::UNAUTHORIZED);
            }
        }

        let public_key = keys::PublicKey::from_openssh(&request.public_key_openssh)
            .map_err(|_| StatusCode::BAD_REQUEST)?;
        let ttl_seconds = request.ttl_seconds.unwrap_or(300);
        let certificate =
            issue_certificate(&state.ca_key, &public_key, &request.username, ttl_seconds)
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let parsed = keys::Certificate::from_openssh(&certificate)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        *state.issue_count.lock().await += 1;

        Ok(Json(MockIssueCertResponse {
            certificate_id: Uuid::new_v4().to_string(),
            serial: 1,
            issued_at: parsed.valid_after(),
            expires_at: parsed.valid_before(),
            ca_key_id: format!(
                "mock-ca-{}-{}",
                request.environment.unwrap_or_else(|| "dev".into()),
                request.target_host.replace('.', "-")
            ),
            ca_public_key_openssh: state
                .ca_key
                .public_key()
                .to_openssh()
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            ca_fingerprint_sha256: state.ca_key.fingerprint(HashAlg::Sha256).to_string(),
            key_id: parsed.key_id().to_string(),
            certificate_pem: certificate.clone(),
            certificate_openssh: certificate,
            principals: if request.principals.is_empty() {
                vec![request.username]
            } else {
                request.principals
            },
        }))
    }

    #[test]
    fn classifies_authentication_errors() {
        let payload = classify_terminal_error(&anyhow::anyhow!(
            "ssh authentication failed: public key authentication failed"
        ));
        assert_eq!(payload.kind, TerminalErrorKind::Authentication);
        assert!(!payload.retryable);
    }

    #[test]
    fn classifies_host_key_errors() {
        let payload =
            classify_terminal_error(&anyhow::anyhow!("ssh handshake failed: Unknown key"));
        assert_eq!(payload.kind, TerminalErrorKind::HostKey);
        assert!(!payload.retryable);
    }

    #[test]
    fn classifies_relay_errors() {
        let payload = classify_terminal_error(&anyhow::anyhow!(
            "relay data connection failed: failed to connect to relay 127.0.0.1:7444"
        ));
        assert_eq!(payload.kind, TerminalErrorKind::Relay);
        assert!(payload.retryable);
    }

    async fn wait_for_connected(events: &mut broadcast::Receiver<TerminalEvent>) -> bool {
        wait_for_event(events, |event| {
            matches!(event, TerminalEvent::Connected { .. })
        })
        .await
    }

    async fn wait_for_stdout(
        events: &mut broadcast::Receiver<TerminalEvent>,
        needle: &str,
    ) -> bool {
        wait_for_event(events, |event| match event {
            TerminalEvent::Stdout { chunk_b64 } => decode_stdout(chunk_b64).contains(needle),
            _ => false,
        })
        .await
    }

    async fn wait_for_closed(
        events: &mut broadcast::Receiver<TerminalEvent>,
        needle: &str,
    ) -> bool {
        wait_for_event(events, |event| match event {
            TerminalEvent::Closed { reason } => reason.contains(needle),
            _ => false,
        })
        .await
    }

    async fn wait_for_event(
        events: &mut broadcast::Receiver<TerminalEvent>,
        predicate: impl Fn(&TerminalEvent) -> bool,
    ) -> bool {
        timeout(Duration::from_secs(5), async {
            loop {
                let event = events.recv().await.expect("recv event");
                if predicate(&event) {
                    return true;
                }
            }
        })
        .await
        .unwrap_or(false)
    }

    fn decode_stdout(chunk_b64: &str) -> String {
        let bytes = STANDARD.decode(chunk_b64).expect("decode chunk");
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn unix_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_secs()
    }
}
