use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::timeout,
};
use tracing::{info, warn};
use uuid::Uuid;

const DEFAULT_NODE_TTL_SECONDS: u64 = 60;
const DEFAULT_LEASE_TTL_SECONDS: u64 = 120;
const MAX_HANDSHAKE_BYTES: usize = 4096;

#[derive(Debug, Clone)]
pub struct RelayConfig {
    pub listen_addr: String,
    pub public_address: Option<String>,
    pub default_node_ttl_seconds: u64,
}

impl RelayConfig {
    pub fn from_env() -> Self {
        Self {
            listen_addr: std::env::var("OZY_RELAY_LISTEN")
                .unwrap_or_else(|_| "127.0.0.1:9443".into()),
            public_address: std::env::var("OZY_RELAY_PUBLIC_ADDRESS").ok(),
            default_node_ttl_seconds: std::env::var("OZY_RELAY_NODE_TTL_SECONDS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(DEFAULT_NODE_TTL_SECONDS),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterNodeRequest {
    pub node_id: String,
    pub ttl_seconds: Option<u64>,
    pub purpose: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterNodeResponse {
    pub node_id: String,
    pub relay_address: String,
    pub registered_at: u64,
    pub expires_at: u64,
    pub purpose: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayLeaseRequest {
    pub target_node_id: String,
    pub requested_port: Option<u16>,
    pub ttl_seconds: Option<u64>,
    pub purpose: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRelayLeaseRequest {
    pub node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayLeaseResponse {
    pub lease_id: Uuid,
    pub token: String,
    pub relay_address: String,
    pub target_node_id: String,
    pub requested_port: u16,
    pub purpose: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayHealthSnapshot {
    pub relay_address: String,
    pub active_leases: usize,
    pub registered_nodes: usize,
    pub pending_clients: usize,
    pub pending_agents: usize,
}

#[derive(Clone)]
pub struct RelayService {
    inner: Arc<RelayServiceInner>,
}

struct RelayServiceInner {
    public_address: String,
    default_node_ttl_seconds: u64,
    state: Mutex<RelayState>,
}

#[derive(Default)]
struct RelayState {
    leases: HashMap<Uuid, RelayLease>,
    lease_ids_by_token: HashMap<String, Uuid>,
    nodes: HashMap<String, RegisteredNode>,
    pending_clients: HashMap<Uuid, PendingPeer>,
    pending_agents: HashMap<Uuid, PendingPeer>,
}

struct PendingPeer {
    sender: oneshot::Sender<TcpStream>,
}

#[derive(Debug, Clone)]
struct RelayLease {
    id: Uuid,
    token: String,
    target_node_id: String,
    requested_port: u16,
    purpose: String,
    issued_at: u64,
    expires_at: u64,
    claimed_by: Option<String>,
    claimed_at: Option<u64>,
    client_connected: bool,
    agent_connected: bool,
}

#[derive(Debug, Clone)]
struct RegisteredNode {
    purpose: Option<String>,
    registered_at: u64,
    expires_at: u64,
    last_seen_at: u64,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum RelayPeerRole {
    Client,
    Agent,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RelayHello {
    ClientHello {
        #[serde(rename = "leaseToken")]
        lease_token: String,
        #[serde(rename = "targetNodeId")]
        target_node_id: String,
    },
    AgentHello {
        #[serde(rename = "leaseToken")]
        lease_token: String,
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(rename = "targetNodeId")]
        target_node_id: String,
    },
}

impl RelayService {
    pub async fn bind(config: RelayConfig) -> Result<Self> {
        let listener = TcpListener::bind(&config.listen_addr)
            .await
            .with_context(|| format!("failed to bind relay listener {}", config.listen_addr))?;
        let local_addr = listener
            .local_addr()
            .context("failed to read relay listener address")?;
        let public_address = config
            .public_address
            .clone()
            .unwrap_or_else(|| local_addr.to_string());
        let relay = Self {
            inner: Arc::new(RelayServiceInner {
                public_address: public_address.clone(),
                default_node_ttl_seconds: config.default_node_ttl_seconds,
                state: Mutex::new(RelayState::default()),
            }),
        };
        relay.spawn_accept_loop(listener);
        info!(relay_address = %public_address, "relay listener ready");
        Ok(relay)
    }

    pub fn register_node(&self, request: RegisterNodeRequest) -> Result<RegisterNodeResponse> {
        let node_id = request.node_id.trim();
        if node_id.is_empty() {
            return Err(anyhow!("nodeId is required"));
        }

        let ttl_seconds = request
            .ttl_seconds
            .unwrap_or(self.inner.default_node_ttl_seconds)
            .clamp(30, 300);
        let registered_at = unix_timestamp();
        let expires_at = registered_at + ttl_seconds;
        let mut state = self.inner.state.lock();
        state.cleanup_expired(registered_at);
        let node = state
            .nodes
            .entry(node_id.to_string())
            .or_insert_with(|| RegisteredNode {
                purpose: request.purpose.clone(),
                registered_at,
                expires_at,
                last_seen_at: registered_at,
            });
        node.purpose = request.purpose.clone();
        node.last_seen_at = registered_at;
        node.expires_at = expires_at;

        Ok(RegisterNodeResponse {
            node_id: node_id.to_string(),
            relay_address: self.inner.public_address.clone(),
            registered_at: node.registered_at,
            expires_at,
            purpose: node.purpose.clone(),
        })
    }

    pub fn create_lease(&self, request: RelayLeaseRequest) -> Result<RelayLeaseResponse> {
        let target_node_id = request.target_node_id.trim();
        if target_node_id.is_empty() {
            return Err(anyhow!("targetNodeId is required"));
        }
        if request.purpose.trim().is_empty() {
            return Err(anyhow!("purpose is required"));
        }

        let ttl_seconds = request
            .ttl_seconds
            .unwrap_or(DEFAULT_LEASE_TTL_SECONDS)
            .clamp(30, 600);
        let issued_at = unix_timestamp();
        let expires_at = issued_at + ttl_seconds;
        let requested_port = request.requested_port.unwrap_or(22);
        let mut state = self.inner.state.lock();
        state.cleanup_expired(issued_at);
        let node = state
            .nodes
            .get(target_node_id)
            .ok_or_else(|| anyhow!("target node {target_node_id} is not registered"))?;
        if node.expires_at <= issued_at {
            return Err(anyhow!("target node {target_node_id} registration expired"));
        }

        let lease = RelayLease {
            id: Uuid::new_v4(),
            token: format!("relay-{}", Uuid::new_v4()),
            target_node_id: target_node_id.to_string(),
            requested_port,
            purpose: request.purpose,
            issued_at,
            expires_at,
            claimed_by: None,
            claimed_at: None,
            client_connected: false,
            agent_connected: false,
        };
        state
            .lease_ids_by_token
            .insert(lease.token.clone(), lease.id);
        state.leases.insert(lease.id, lease.clone());
        Ok(self.to_lease_response(&lease))
    }

    pub fn claim_lease(
        &self,
        request: ClaimRelayLeaseRequest,
    ) -> Result<Option<RelayLeaseResponse>> {
        let node_id = request.node_id.trim();
        if node_id.is_empty() {
            return Err(anyhow!("nodeId is required"));
        }

        let claimed_at = unix_timestamp();
        let mut state = self.inner.state.lock();
        state.cleanup_expired(claimed_at);
        let node = state
            .nodes
            .get_mut(node_id)
            .ok_or_else(|| anyhow!("node {node_id} is not registered"))?;
        node.last_seen_at = claimed_at;

        let lease = state
            .leases
            .values_mut()
            .filter(|lease| {
                lease.target_node_id == node_id
                    && lease.expires_at > claimed_at
                    && !lease.agent_connected
                    && lease
                        .claimed_by
                        .as_deref()
                        .map(|claimed_by| claimed_by == node_id)
                        .unwrap_or(true)
            })
            .min_by_key(|lease| lease.issued_at);

        if let Some(lease) = lease {
            lease.claimed_by = Some(node_id.to_string());
            lease.claimed_at = Some(claimed_at);
            return Ok(Some(self.to_lease_response(lease)));
        }

        Ok(None)
    }

    pub fn snapshot(&self) -> RelayHealthSnapshot {
        let now = unix_timestamp();
        let mut state = self.inner.state.lock();
        state.cleanup_expired(now);
        RelayHealthSnapshot {
            relay_address: self.inner.public_address.clone(),
            active_leases: state.leases.len(),
            registered_nodes: state.nodes.len(),
            pending_clients: state.pending_clients.len(),
            pending_agents: state.pending_agents.len(),
        }
    }

    fn spawn_accept_loop(&self, listener: TcpListener) {
        let relay = self.clone();
        tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, peer_addr)) => {
                        let relay = relay.clone();
                        tokio::spawn(async move {
                            if let Err(error) = relay.handle_stream(stream).await {
                                warn!(%error, remote_addr = %peer_addr, "relay session failed");
                            }
                        });
                    }
                    Err(error) => {
                        warn!(%error, "relay accept failed");
                        break;
                    }
                }
            }
        });
    }

    async fn handle_stream(&self, mut stream: TcpStream) -> Result<()> {
        let hello = read_hello(&mut stream).await?;
        match hello {
            RelayHello::ClientHello {
                lease_token,
                target_node_id,
            } => {
                self.attach_connection(
                    RelayPeerRole::Client,
                    &lease_token,
                    &target_node_id,
                    None,
                    stream,
                )
                .await
            }
            RelayHello::AgentHello {
                lease_token,
                node_id,
                target_node_id,
            } => {
                self.attach_connection(
                    RelayPeerRole::Agent,
                    &lease_token,
                    &target_node_id,
                    Some(node_id),
                    stream,
                )
                .await
            }
        }
    }

    async fn attach_connection(
        &self,
        role: RelayPeerRole,
        lease_token: &str,
        target_node_id: &str,
        node_id: Option<String>,
        stream: TcpStream,
    ) -> Result<()> {
        let now = unix_timestamp();
        let (lease_id, expires_at, node_id_to_touch) = {
            let mut state = self.inner.state.lock();
            state.cleanup_expired(now);
            let lease_id = *state
                .lease_ids_by_token
                .get(lease_token)
                .ok_or_else(|| anyhow!("relay lease not found"))?;
            let lease = state
                .leases
                .get_mut(&lease_id)
                .ok_or_else(|| anyhow!("relay lease state missing"))?;
            if lease.expires_at <= now {
                state.remove_lease(lease_id);
                return Err(anyhow!("relay lease expired"));
            }
            if lease.target_node_id != target_node_id {
                return Err(anyhow!("relay target node mismatch"));
            }
            match role {
                RelayPeerRole::Client => {
                    if lease.client_connected {
                        return Err(anyhow!("relay client already connected"));
                    }
                    lease.client_connected = true;
                    (lease_id, lease.expires_at, None)
                }
                RelayPeerRole::Agent => {
                    let node_id = node_id
                        .as_deref()
                        .ok_or_else(|| anyhow!("nodeId is required"))?;
                    match lease.claimed_by.as_deref() {
                        Some(claimed_by) if claimed_by == node_id => {}
                        Some(_) => return Err(anyhow!("relay lease was claimed by another node")),
                        None => {
                            return Err(anyhow!("relay lease must be claimed before agent connect"))
                        }
                    }
                    if lease.agent_connected {
                        return Err(anyhow!("relay agent already connected"));
                    }
                    lease.agent_connected = true;
                    (lease_id, lease.expires_at, Some(node_id.to_string()))
                }
            }
        };
        if let Some(node_id) = node_id_to_touch {
            let mut state = self.inner.state.lock();
            if let Some(node) = state.nodes.get_mut(&node_id) {
                node.last_seen_at = now;
            }
        };

        let (tx, rx) = oneshot::channel();
        let waiter_or_store = {
            let mut state = self.inner.state.lock();
            let counterpart = match role {
                RelayPeerRole::Client => state.pending_agents.remove(&lease_id),
                RelayPeerRole::Agent => state.pending_clients.remove(&lease_id),
            };
            if let Some(waiter) = counterpart {
                state.remove_lease(lease_id);
                Some(waiter)
            } else {
                match role {
                    RelayPeerRole::Client => {
                        state
                            .pending_clients
                            .insert(lease_id, PendingPeer { sender: tx });
                    }
                    RelayPeerRole::Agent => {
                        state
                            .pending_agents
                            .insert(lease_id, PendingPeer { sender: tx });
                    }
                }
                None
            }
        };

        if let Some(waiter) = waiter_or_store {
            waiter
                .sender
                .send(stream)
                .map_err(|_| anyhow!("relay counterpart disconnected before pairing"))?;
            return Ok(());
        }

        let wait_seconds = expires_at.saturating_sub(unix_timestamp()).max(1);
        let peer = match timeout(Duration::from_secs(wait_seconds), rx).await {
            Ok(Ok(peer)) => peer,
            Ok(Err(_)) => {
                self.fail_lease(lease_id);
                return Err(anyhow!("relay counterpart disconnected before pairing"));
            }
            Err(_) => {
                self.fail_lease(lease_id);
                return Err(anyhow!("relay pairing timed out"));
            }
        };

        bridge(stream, peer).await
    }

    fn fail_lease(&self, lease_id: Uuid) {
        let mut state = self.inner.state.lock();
        state.remove_lease(lease_id);
    }

    fn to_lease_response(&self, lease: &RelayLease) -> RelayLeaseResponse {
        RelayLeaseResponse {
            lease_id: lease.id,
            token: lease.token.clone(),
            relay_address: self.inner.public_address.clone(),
            target_node_id: lease.target_node_id.clone(),
            requested_port: lease.requested_port,
            purpose: lease.purpose.clone(),
            issued_at: lease.issued_at,
            expires_at: lease.expires_at,
        }
    }
}

impl RelayState {
    fn cleanup_expired(&mut self, now: u64) {
        self.nodes.retain(|_, node| node.expires_at > now);
        let expired_lease_ids = self
            .leases
            .values()
            .filter(|lease| lease.expires_at <= now)
            .map(|lease| lease.id)
            .collect::<Vec<_>>();
        for lease_id in expired_lease_ids {
            self.remove_lease(lease_id);
        }
    }

    fn remove_lease(&mut self, lease_id: Uuid) {
        if let Some(lease) = self.leases.remove(&lease_id) {
            self.lease_ids_by_token.remove(&lease.token);
        }
        self.pending_clients.remove(&lease_id);
        self.pending_agents.remove(&lease_id);
    }
}

async fn read_hello(stream: &mut TcpStream) -> Result<RelayHello> {
    let mut buffer = Vec::with_capacity(256);
    loop {
        if buffer.len() >= MAX_HANDSHAKE_BYTES {
            return Err(anyhow!("relay hello too large"));
        }

        let mut byte = [0u8; 1];
        let read = stream
            .read(&mut byte)
            .await
            .context("failed to read relay hello")?;
        if read == 0 {
            return Err(anyhow!("relay peer closed before hello"));
        }
        if byte[0] == b'\n' {
            break;
        }
        buffer.push(byte[0]);
    }

    serde_json::from_slice(&buffer).context("failed to parse relay hello")
}

async fn bridge(mut left: TcpStream, mut right: TcpStream) -> Result<()> {
    let _ = tokio::io::copy_bidirectional(&mut left, &mut right)
        .await
        .context("relay stream copy failed")?;
    let _ = left.shutdown().await;
    let _ = right.shutdown().await;
    Ok(())
}

fn unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        ClaimRelayLeaseRequest, RegisterNodeRequest, RelayConfig, RelayLeaseRequest, RelayService,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
        time::{timeout, Duration},
    };

    #[tokio::test]
    async fn registers_nodes_and_claims_leases() {
        let relay = RelayService::bind(RelayConfig {
            listen_addr: "127.0.0.1:0".into(),
            public_address: None,
            default_node_ttl_seconds: 60,
        })
        .await
        .unwrap();

        let registration = relay
            .register_node(RegisterNodeRequest {
                node_id: "node-a".into(),
                ttl_seconds: Some(60),
                purpose: Some("reverse-ssh".into()),
            })
            .unwrap();
        assert!(!registration.relay_address.is_empty());

        let lease = relay
            .create_lease(RelayLeaseRequest {
                target_node_id: "node-a".into(),
                requested_port: Some(22),
                ttl_seconds: Some(60),
                purpose: "ssh".into(),
            })
            .unwrap();

        let claimed = relay
            .claim_lease(ClaimRelayLeaseRequest {
                node_id: "node-a".into(),
            })
            .unwrap()
            .unwrap();

        assert_eq!(lease.lease_id, claimed.lease_id);
        assert_eq!(lease.target_node_id, claimed.target_node_id);
    }

    #[tokio::test]
    async fn relays_data_between_client_and_agent() {
        let relay = RelayService::bind(RelayConfig {
            listen_addr: "127.0.0.1:0".into(),
            public_address: None,
            default_node_ttl_seconds: 60,
        })
        .await
        .unwrap();

        relay
            .register_node(RegisterNodeRequest {
                node_id: "node-b".into(),
                ttl_seconds: Some(60),
                purpose: Some("reverse-ssh".into()),
            })
            .unwrap();
        let lease = relay
            .create_lease(RelayLeaseRequest {
                target_node_id: "node-b".into(),
                requested_port: Some(22),
                ttl_seconds: Some(60),
                purpose: "ssh".into(),
            })
            .unwrap();
        relay
            .claim_lease(ClaimRelayLeaseRequest {
                node_id: "node-b".into(),
            })
            .unwrap()
            .unwrap();

        let mut agent = TcpStream::connect(&lease.relay_address).await.unwrap();
        agent
            .write_all(
                format!(
                    "{{\"type\":\"agent_hello\",\"leaseToken\":\"{}\",\"nodeId\":\"node-b\",\"targetNodeId\":\"node-b\"}}\n",
                    lease.token
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let mut client = TcpStream::connect(&lease.relay_address).await.unwrap();
        client
            .write_all(
                format!(
                    "{{\"type\":\"client_hello\",\"leaseToken\":\"{}\",\"targetNodeId\":\"node-b\"}}\n",
                    lease.token
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        client.write_all(b"ping").await.unwrap();
        let mut received = [0u8; 4];
        timeout(Duration::from_secs(2), agent.read_exact(&mut received))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&received, b"ping");

        agent.write_all(b"pong").await.unwrap();
        let mut echoed = [0u8; 4];
        timeout(Duration::from_secs(2), client.read_exact(&mut echoed))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(&echoed, b"pong");
    }
}
