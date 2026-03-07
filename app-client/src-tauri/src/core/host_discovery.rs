use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Context, Result};
use russh::{client, keys, Disconnect};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeHostKeyRequest {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeHostKeyResponse {
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint_sha256: String,
    pub host_key_openssh: String,
    pub discovered_at: u64,
}

#[derive(Clone)]
struct HostDiscoveryHandler {
    discovered: Arc<Mutex<Option<ProbeHostKeyResponse>>>,
    request: ProbeHostKeyRequest,
}

impl client::Handler for HostDiscoveryHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &keys::ssh_key::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        let discovered = self.discovered.clone();
        let request = self.request.clone();
        let server_public_key = server_public_key.clone();
        async move {
            let response = ProbeHostKeyResponse {
                host: request.host,
                port: request.port,
                algorithm: server_public_key.algorithm().as_str().to_string(),
                fingerprint_sha256: server_public_key
                    .fingerprint(keys::HashAlg::Sha256)
                    .to_string(),
                host_key_openssh: server_public_key.to_openssh().map_err(|error| {
                    russh::Error::IO(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
                })?,
                discovered_at: unix_timestamp(),
            };
            if let Ok(mut slot) = discovered.lock() {
                *slot = Some(response);
            }
            Ok(true)
        }
    }
}

pub async fn probe_ssh_host_key(request: ProbeHostKeyRequest) -> Result<ProbeHostKeyResponse> {
    if request.host.trim().is_empty() {
        return Err(anyhow!("host is required"));
    }
    if request.port == 0 {
        return Err(anyhow!("port is required"));
    }

    let discovered = Arc::new(Mutex::new(None));
    let handler = HostDiscoveryHandler {
        discovered: discovered.clone(),
        request: request.clone(),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(std::time::Duration::from_secs(10)),
        ..Default::default()
    });

    let session = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client::connect(config, (request.host.as_str(), request.port), handler),
    )
    .await
    .context("timed out while probing SSH host key")?
    .context("failed to establish SSH handshake while probing host key")?;

    let response = discovered
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .ok_or_else(|| anyhow!("server host key was not captured during SSH handshake"))?;
    let _ = session
        .disconnect(Disconnect::ByApplication, "", "en")
        .await;
    Ok(response)
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{probe_ssh_host_key, ProbeHostKeyRequest};
    use rand::rngs::OsRng;
    use russh::{
        keys::{self, HashAlg},
        server::{self, Msg},
        Preferred,
    };
    use std::sync::Arc;
    use tokio::net::TcpListener;

    #[derive(Clone)]
    struct ProbeTestServer;

    impl server::Server for ProbeTestServer {
        type Handler = Self;

        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Self {
            self.clone()
        }
    }

    impl server::Handler for ProbeTestServer {
        type Error = russh::Error;

        async fn channel_open_session(
            &mut self,
            _: russh::Channel<Msg>,
            _: &mut server::Session,
        ) -> Result<bool, Self::Error> {
            Ok(false)
        }

        async fn auth_publickey(
            &mut self,
            _: &str,
            _: &keys::PublicKey,
        ) -> Result<server::Auth, Self::Error> {
            Ok(server::Auth::Reject {
                proceed_with_methods: None,
            })
        }
    }

    #[tokio::test]
    async fn probes_ssh_host_key() {
        let host_key = keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).unwrap();
        let expected_fingerprint = host_key
            .public_key()
            .fingerprint(HashAlg::Sha256)
            .to_string();
        let expected_key = host_key.public_key().to_openssh().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let config = Arc::new(server::Config {
            inactivity_timeout: Some(std::time::Duration::from_secs(30)),
            auth_rejection_time: std::time::Duration::from_millis(10),
            auth_rejection_time_initial: Some(std::time::Duration::from_millis(0)),
            keys: vec![host_key],
            preferred: Preferred::default(),
            ..Default::default()
        });

        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            server::run_stream(config, socket, ProbeTestServer)
                .await
                .unwrap();
        });

        let response = probe_ssh_host_key(ProbeHostKeyRequest {
            host: "127.0.0.1".into(),
            port: addr.port(),
        })
        .await
        .unwrap();

        assert_eq!(response.fingerprint_sha256, expected_fingerprint);
        assert_eq!(response.host_key_openssh, expected_key);
    }
}
