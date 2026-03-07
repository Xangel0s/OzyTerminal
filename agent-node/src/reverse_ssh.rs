use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use tokio::{
    io::AsyncWriteExt,
    net::TcpStream,
    time::{sleep, Duration, Instant},
};

const DEFAULT_REGISTRATION_TTL_SECONDS: u64 = 60;
const DEFAULT_CLAIM_POLL_SECONDS: u64 = 2;

#[derive(Debug, Clone)]
pub struct AgentConnectorConfig {
    pub control_plane_url: String,
    pub access_token: Option<String>,
    pub node_id: String,
    pub purpose: String,
    pub upstream_host: String,
    pub registration_ttl_seconds: u64,
    pub claim_poll_seconds: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterNodeRequest {
    node_id: String,
    ttl_seconds: Option<u64>,
    purpose: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimRelayLeaseRequest {
    node_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterNodeResponse {
    relay_address: String,
    expires_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayLeaseResponse {
    lease_id: String,
    token: String,
    relay_address: String,
    target_node_id: String,
    requested_port: u16,
    purpose: String,
    issued_at: u64,
    expires_at: u64,
}

impl AgentConnectorConfig {
    pub fn from_env() -> Result<Self> {
        let control_plane_url = std::env::var("OZY_CONTROL_PLANE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8080".into());
        let node_id = std::env::var("OZY_AGENT_NODE_ID")
            .or_else(|_| std::env::var("COMPUTERNAME"))
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "agent-node-dev".into());
        let registration_ttl_seconds = std::env::var("OZY_AGENT_REGISTRATION_TTL_SECONDS")
            .ok()
            .map(|value| value.parse::<u64>())
            .transpose()
            .context("invalid OZY_AGENT_REGISTRATION_TTL_SECONDS")?
            .unwrap_or(DEFAULT_REGISTRATION_TTL_SECONDS)
            .clamp(30, 300);
        let claim_poll_seconds = std::env::var("OZY_AGENT_CLAIM_POLL_SECONDS")
            .ok()
            .map(|value| value.parse::<u64>())
            .transpose()
            .context("invalid OZY_AGENT_CLAIM_POLL_SECONDS")?
            .unwrap_or(DEFAULT_CLAIM_POLL_SECONDS)
            .clamp(1, 30);

        Ok(Self {
            control_plane_url,
            access_token: std::env::var("OZY_CONTROL_PLANE_ACCESS_TOKEN").ok(),
            node_id,
            purpose: std::env::var("OZY_AGENT_RELAY_PURPOSE")
                .unwrap_or_else(|_| "reverse-ssh".into()),
            upstream_host: std::env::var("OZY_AGENT_UPSTREAM_HOST")
                .unwrap_or_else(|_| "127.0.0.1".into()),
            registration_ttl_seconds,
            claim_poll_seconds,
        })
    }
}

pub async fn run_reverse_connector(config: AgentConnectorConfig) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .context("failed to build reqwest client")?;
    let mut last_registration = None::<Instant>;

    loop {
        let should_register = last_registration
            .map(|instant| {
                instant.elapsed()
                    >= Duration::from_secs((config.registration_ttl_seconds / 2).max(10))
            })
            .unwrap_or(true);

        if should_register {
            match register_node(&client, &config).await {
                Ok(response) => {
                    tracing::info!(
                        node_id = %config.node_id,
                        relay = %response.relay_address,
                        expires_at = response.expires_at,
                        "agent node registered"
                    );
                    last_registration = Some(Instant::now());
                }
                Err(error) => {
                    tracing::warn!(%error, node_id = %config.node_id, "failed to register agent node");
                    sleep(Duration::from_secs(5)).await;
                    continue;
                }
            }
        }

        match claim_relay_lease(&client, &config).await {
            Ok(Some(lease)) => {
                let config = config.clone();
                tokio::spawn(async move {
                    if let Err(error) = bridge_claimed_lease(config, lease).await {
                        tracing::warn!(%error, "reverse relay session failed");
                    }
                });
                sleep(Duration::from_millis(200)).await;
            }
            Ok(None) => {
                sleep(Duration::from_secs(config.claim_poll_seconds)).await;
            }
            Err(error) => {
                tracing::warn!(%error, node_id = %config.node_id, "failed to claim relay lease");
                sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

async fn bridge_claimed_lease(
    config: AgentConnectorConfig,
    lease: RelayLeaseResponse,
) -> Result<()> {
    let mut relay_stream = TcpStream::connect(&lease.relay_address)
        .await
        .with_context(|| format!("failed to connect to relay {}", lease.relay_address))?;
    let hello = serde_json::json!({
        "type": "agent_hello",
        "nodeId": config.node_id,
        "leaseId": lease.lease_id,
        "leaseToken": lease.token,
        "targetNodeId": lease.target_node_id,
        "requestedPort": lease.requested_port,
        "purpose": lease.purpose,
        "issuedAt": lease.issued_at,
        "expiresAt": lease.expires_at,
    });
    relay_stream
        .write_all(format!("{hello}\n").as_bytes())
        .await
        .context("failed to write relay hello")?;

    let upstream_addr = format!("{}:{}", config.upstream_host, lease.requested_port);
    let mut upstream_stream = TcpStream::connect(&upstream_addr)
        .await
        .with_context(|| format!("failed to connect to local upstream {upstream_addr}"))?;
    let (from_relay, from_upstream) =
        tokio::io::copy_bidirectional(&mut relay_stream, &mut upstream_stream)
            .await
            .context("failed to proxy reverse relay traffic")?;
    tracing::info!(
        node_id = %config.node_id,
        lease_id = %lease.lease_id,
        relay = %lease.relay_address,
        upstream = %upstream_addr,
        from_relay,
        from_upstream,
        "reverse relay session closed"
    );
    Ok(())
}

async fn register_node(
    client: &reqwest::Client,
    config: &AgentConnectorConfig,
) -> Result<RegisterNodeResponse> {
    let response = client
        .post(control_plane_url(config, "/v1/relay/nodes/register")?)
        .headers(auth_headers(config.access_token.as_deref())?)
        .json(&RegisterNodeRequest {
            node_id: config.node_id.clone(),
            ttl_seconds: Some(config.registration_ttl_seconds),
            purpose: Some(config.purpose.clone()),
        })
        .send()
        .await
        .context("failed to call control-plane node registration endpoint")?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "control-plane node registration failed with HTTP {status}: {body}"
        ));
    }

    response
        .json::<RegisterNodeResponse>()
        .await
        .context("failed to parse node registration response")
}

async fn claim_relay_lease(
    client: &reqwest::Client,
    config: &AgentConnectorConfig,
) -> Result<Option<RelayLeaseResponse>> {
    let response = client
        .post(control_plane_url(config, "/v1/relay/leases/claim")?)
        .headers(auth_headers(config.access_token.as_deref())?)
        .json(&ClaimRelayLeaseRequest {
            node_id: config.node_id.clone(),
        })
        .send()
        .await
        .context("failed to call control-plane relay claim endpoint")?;

    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "control-plane relay claim failed with HTTP {status}: {body}"
        ));
    }

    response
        .json::<RelayLeaseResponse>()
        .await
        .context("failed to parse relay claim response")
        .map(Some)
}

fn auth_headers(access_token: Option<&str>) -> Result<HeaderMap> {
    let mut headers = HeaderMap::new();
    if let Some(token) = access_token {
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {token}"))
                .context("invalid OZY_CONTROL_PLANE_ACCESS_TOKEN")?,
        );
    }
    Ok(headers)
}

fn control_plane_url(config: &AgentConnectorConfig, path: &str) -> Result<String> {
    let base_url = config.control_plane_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err(anyhow!("OZY_CONTROL_PLANE_URL is required"));
    }

    Ok(format!("{base_url}{path}"))
}
