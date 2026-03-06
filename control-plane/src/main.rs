mod audit;
mod auth;
mod ca;
mod relay;
mod synchronization;

use std::{collections::HashMap, sync::Arc, time::{SystemTime, UNIX_EPOCH}};

use axum::{extract::State, routing::{get, post}, Json, Router};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    issued_certificates: usize,
    active_relay_leases: usize,
}

#[derive(Clone, Default)]
struct ControlPlaneState {
    certificates: Arc<RwLock<HashMap<Uuid, IssuedCertificate>>>,
    relay_leases: Arc<RwLock<HashMap<Uuid, RelayLease>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueCertRequest {
    username: String,
    target_host: String,
    public_key_openssh: String,
    ttl_seconds: Option<u64>,
    principals: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IssueCertResponse {
    certificate_id: Uuid,
    ttl_seconds: u64,
    issued_at: u64,
    expires_at: u64,
    ca_key_id: String,
    certificate_pem: String,
    principals: Vec<String>,
}

#[derive(Debug, Clone)]
struct IssuedCertificate {
    id: Uuid,
    username: String,
    target_host: String,
    principals: Vec<String>,
    issued_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayLeaseRequest {
    target_node_id: String,
    requested_port: Option<u16>,
    ttl_seconds: Option<u64>,
    purpose: String,
}

#[derive(Serialize)]
struct RelayLeaseResponse {
    lease_id: Uuid,
    token: String,
    relay_address: String,
    target_node_id: String,
    requested_port: u16,
    purpose: String,
    issued_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone)]
struct RelayLease {
    id: Uuid,
    token: String,
    relay_address: String,
    target_node_id: String,
    requested_port: u16,
    purpose: String,
    issued_at: u64,
    expires_at: u64,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let state = ControlPlaneState::default();

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/ssh/certificates/issue", post(issue_certificate))
        .route("/v1/relay/leases", post(create_relay_lease))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080")
        .await
        .expect("failed to bind control-plane");
    axum::serve(listener, app).await.expect("control-plane failed");
}

async fn health(State(state): State<ControlPlaneState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "control-plane",
        issued_certificates: state.certificates.read().len(),
        active_relay_leases: state.relay_leases.read().len(),
    })
}

async fn issue_certificate(
    State(state): State<ControlPlaneState>,
    Json(request): Json<IssueCertRequest>,
) -> Json<IssueCertResponse> {
    let ttl_seconds = request.ttl_seconds.unwrap_or(900).clamp(60, 3600);
    let issued_at = now();
    let expires_at = issued_at + ttl_seconds;
    let certificate_id = Uuid::new_v4();
    let principals = if request.principals.is_empty() {
        vec![request.username.clone()]
    } else {
        request.principals.clone()
    };

    let certificate = IssuedCertificate {
        id: certificate_id,
        username: request.username.clone(),
        target_host: request.target_host.clone(),
        principals: principals.clone(),
        issued_at,
        expires_at,
    };
    state.certificates.write().insert(certificate_id, certificate);

    Json(IssueCertResponse {
        certificate_id,
        ttl_seconds,
        issued_at,
        expires_at,
        ca_key_id: "ca-demo-ed25519-01".into(),
        certificate_pem: format!(
            "ssh-ed25519-cert-v01@openssh.com {} {}@{}",
            request.public_key_openssh,
            request.username,
            request.target_host
        ),
        principals,
    })
}

async fn create_relay_lease(
    State(state): State<ControlPlaneState>,
    Json(request): Json<RelayLeaseRequest>,
) -> Json<RelayLeaseResponse> {
    let ttl_seconds = request.ttl_seconds.unwrap_or(600).clamp(60, 7200);
    let issued_at = now();
    let expires_at = issued_at + ttl_seconds;
    let lease_id = Uuid::new_v4();
    let requested_port = request.requested_port.unwrap_or(9443);
    let lease = RelayLease {
        id: lease_id,
        token: format!("relay-{}", Uuid::new_v4()),
        relay_address: "relay.ozyterminal.local:9443".into(),
        target_node_id: request.target_node_id.clone(),
        requested_port,
        purpose: request.purpose.clone(),
        issued_at,
        expires_at,
    };

    state.relay_leases.write().insert(lease_id, lease.clone());

    Json(RelayLeaseResponse {
        lease_id,
        token: lease.token,
        relay_address: lease.relay_address,
        target_node_id: lease.target_node_id,
        requested_port: lease.requested_port,
        purpose: lease.purpose,
        issued_at,
        expires_at,
    })
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}
