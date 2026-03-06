use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use bytes::Bytes;
use russh::{client, keys, ChannelMsg};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc};
use tracing::info;
use uuid::Uuid;

use crate::core::pty::DEFAULT_TERM;
use crate::core::zero_copy::encode_chunk;
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
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_pem: String,
    pub private_key_passphrase: Option<String>,
    pub certificate_pem: Option<String>,
    pub known_host_fingerprint: Option<String>,
    pub cols: u32,
    pub rows: u32,
    pub relay_hint: Option<RelayHint>,
}

#[derive(Debug)]
pub enum TerminalInput {
    Stdin(Bytes),
    Resize { cols: u16, rows: u16 },
    Close,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TerminalEvent {
    Connected { session_id: Uuid },
    Stdout { chunk_b64: String },
    Closed { reason: String },
    Error { message: String },
}

#[derive(Debug, Default)]
pub struct OzyClient {
    pub expected_host_fingerprint: Option<String>,
}

#[async_trait]
impl client::Handler for OzyClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        if let Some(expected) = self.expected_host_fingerprint.as_deref() {
            let sha256 = server_public_key.fingerprint(keys::HashAlg::Sha256).to_string();
            let openssh = server_public_key
                .to_openssh()
                .map_err(|err| russh::Error::IO(std::io::Error::new(std::io::ErrorKind::InvalidData, err)))?;
            return Ok(expected == sha256 || expected == openssh);
        }

        Ok(false)
    }
}

pub async fn connect_ssh(
    session_id: Uuid,
    request: SshSessionRequest,
    mut input_rx: mpsc::Receiver<TerminalInput>,
    event_tx: broadcast::Sender<TerminalEvent>,
) -> Result<()> {
    let config = Arc::new(client::Config {
        nodelay: true,
        inactivity_timeout: Some(std::time::Duration::from_secs(30)),
        ..Default::default()
    });

    let handler = OzyClient {
        expected_host_fingerprint: request.known_host_fingerprint.clone(),
    };

    let mut session = if let Some(relay) = &request.relay_hint {
        let stream = connect_via_relay(relay).await?;
        client::connect_stream(config, stream, handler).await?
    } else {
        client::connect(config, (request.host.as_str(), request.port), handler).await?
    };

    let private_key = Arc::new(load_private_key(
        &request.private_key_pem,
        request.private_key_passphrase.as_deref(),
    )?);

    if let Some(certificate_pem) = &request.certificate_pem {
        let cert = load_inline_certificate(certificate_pem)?;
        let auth = session
            .authenticate_openssh_cert(request.username.clone(), private_key.clone(), cert)
            .await?;
        if !auth.success() {
            return Err(anyhow!("certificate authentication failed"));
        }
    } else {
        let auth = session
            .authenticate_publickey(
                request.username.clone(),
                keys::PrivateKeyWithHashAlg::new(
                    private_key.clone(),
                    session.best_supported_rsa_hash().await?.flatten(),
                ),
            )
            .await?;
        if !auth.success() {
            return Err(anyhow!("public key authentication failed"));
        }
    }

    let mut channel = session.channel_open_session().await?;
    channel
        .request_pty(false, DEFAULT_TERM, request.cols, request.rows, 0, 0, &[])
        .await?;
    channel.request_shell(true).await?;

    let _ = event_tx.send(TerminalEvent::Connected { session_id });
    let _ = event_tx.send(TerminalEvent::Stdout {
        chunk_b64: encode_chunk(Bytes::from(format!(
            "Connected to {}:{} as {}\r\n",
            request.host, request.port, request.username
        ))),
    });
    info!(%session_id, host = %request.host, port = request.port, "ssh session opened");

    loop {
        tokio::select! {
            biased;

            input = input_rx.recv() => {
                match input {
                    Some(TerminalInput::Stdin(chunk)) => {
                        channel.data(chunk.as_ref()).await?;
                    }
                    Some(TerminalInput::Resize { cols, rows }) => {
                        channel.window_change(cols as u32, rows as u32, 0, 0).await?;
                    }
                    Some(TerminalInput::Close) => {
                        let _ = channel.eof().await;
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
                        let _ = event_tx.send(TerminalEvent::Stdout {
                            chunk_b64: encode_chunk(Bytes::copy_from_slice(data.as_ref())),
                        });
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let _ = event_tx.send(TerminalEvent::Stdout {
                            chunk_b64: encode_chunk(Bytes::copy_from_slice(data.as_ref())),
                        });
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                        let _ = event_tx.send(TerminalEvent::Closed {
                            reason: "remote closed channel".into(),
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
                        let _ = event_tx.send(TerminalEvent::Closed {
                            reason: "channel finished".into(),
                        });
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}

fn load_private_key(private_key_pem: &str, passphrase: Option<&str>) -> Result<keys::PrivateKey> {
    keys::decode_secret_key(private_key_pem, passphrase).context("failed to decode private key")
}

fn load_inline_certificate(certificate_pem: &str) -> Result<keys::Certificate> {
    keys::Certificate::from_openssh(certificate_pem).context("failed to load openssh certificate")
}
