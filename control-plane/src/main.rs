mod audit;
mod auth;
mod ca;
mod relay;
mod synchronization;

use std::{collections::HashMap, path::PathBuf, sync::Arc};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    audit::{AuditEntry, AuditLogService},
    auth::{AccessTokenValidator, AuthenticatedActor},
    ca::{CaInfo, EphemeralCaService, IssueCertificateOptions},
    relay::{
        ClaimRelayLeaseRequest, RegisterNodeRequest, RegisterNodeResponse, RelayConfig,
        RelayLeaseRequest, RelayLeaseResponse, RelayService,
    },
};

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    issued_certificates: usize,
    active_relay_leases: usize,
    registered_relay_nodes: usize,
    relay_address: String,
    ca_key_id: String,
    ca_fingerprint_sha256: String,
}

#[derive(Clone)]
struct ControlPlaneState {
    ca: EphemeralCaService,
    audit: AuditLogService,
    access_token_validator: AccessTokenValidator,
    certificates: Arc<RwLock<HashMap<Uuid, IssuedCertificate>>>,
    relay: RelayService,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueCertRequest {
    username: String,
    target_host: String,
    public_key_openssh: String,
    ttl_seconds: Option<u64>,
    principals: Vec<String>,
    environment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IssueCertResponse {
    certificate_id: Uuid,
    serial: u64,
    ttl_seconds: u64,
    issued_at: u64,
    expires_at: u64,
    ca_key_id: String,
    ca_public_key_openssh: String,
    ca_fingerprint_sha256: String,
    key_id: String,
    certificate_pem: String,
    certificate_openssh: String,
    principals: Vec<String>,
    actor: String,
    auth_mode: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct IssuedCertificate {
    id: Uuid,
    serial: u64,
    key_id: String,
    actor: String,
    auth_mode: String,
    username: String,
    target_host: String,
    principals: Vec<String>,
    issued_at: u64,
    expires_at: u64,
    certificate_openssh: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").init();

    let state_dir = control_plane_state_dir();
    let ca = EphemeralCaService::bootstrap(&state_dir).expect("failed to initialize CA");
    let audit = AuditLogService::new(&state_dir).expect("failed to initialize audit service");
    let access_token_validator = AccessTokenValidator::from_env();
    let relay = RelayService::bind(RelayConfig::from_env())
        .await
        .expect("failed to initialize relay");
    let state = ControlPlaneState {
        ca,
        audit,
        access_token_validator,
        certificates: Arc::new(RwLock::new(HashMap::new())),
        relay,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/ssh/ca", get(ca_info))
        .route("/v1/ssh/certificates/issue", post(issue_certificate))
        .route("/v1/relay/nodes/register", post(register_relay_node))
        .route("/v1/relay/leases", post(create_relay_lease))
        .route("/v1/relay/leases/claim", post(claim_relay_lease))
        .with_state(state);

    let listen_addr =
        std::env::var("OZY_CONTROL_PLANE_LISTEN").unwrap_or_else(|_| "127.0.0.1:8080".into());
    let listener = tokio::net::TcpListener::bind(&listen_addr)
        .await
        .expect("failed to bind control-plane");
    axum::serve(listener, app)
        .await
        .expect("control-plane failed");
}

async fn health(State(state): State<ControlPlaneState>) -> Json<HealthResponse> {
    let ca_info = state.ca.info().expect("ca info");
    let relay = state.relay.snapshot();
    Json(HealthResponse {
        status: "ok",
        service: "control-plane",
        issued_certificates: state.certificates.read().len(),
        active_relay_leases: relay.active_leases,
        registered_relay_nodes: relay.registered_nodes,
        relay_address: relay.relay_address,
        ca_key_id: ca_info.ca_key_id,
        ca_fingerprint_sha256: ca_info.ca_fingerprint_sha256,
    })
}

async fn ca_info(State(state): State<ControlPlaneState>) -> Result<Json<CaInfo>, ApiError> {
    state.ca.info().map(Json).map_err(ApiError::internal)
}

async fn issue_certificate(
    State(state): State<ControlPlaneState>,
    headers: HeaderMap,
    Json(request): Json<IssueCertRequest>,
) -> Result<Json<IssueCertResponse>, ApiError> {
    let ttl_seconds = request.ttl_seconds.unwrap_or(900).clamp(60, 3600);
    let actor = authenticate(&state, &headers)?;
    let certificate_id = Uuid::new_v4();
    let issued = state
        .ca
        .issue_user_certificate(IssueCertificateOptions {
            username: request.username.clone(),
            target_host: request.target_host.clone(),
            public_key_openssh: request.public_key_openssh.clone(),
            principals: request.principals.clone(),
            ttl_seconds,
            environment: request
                .environment
                .clone()
                .unwrap_or_else(|| "development".into()),
        })
        .map_err(ApiError::bad_request)?;

    let certificate = IssuedCertificate {
        id: certificate_id,
        serial: issued.serial,
        key_id: issued.key_id.clone(),
        actor: actor.subject.clone(),
        auth_mode: actor.auth_mode.clone(),
        username: request.username.clone(),
        target_host: request.target_host.clone(),
        principals: issued.principals.clone(),
        issued_at: issued.issued_at,
        expires_at: issued.expires_at,
        certificate_openssh: issued.certificate_openssh.clone(),
    };
    state
        .certificates
        .write()
        .insert(certificate_id, certificate);
    state
        .audit
        .record(&AuditEntry {
            event_id: Uuid::new_v4(),
            event_type: "ssh_certificate_issued".into(),
            actor: actor.subject.clone(),
            auth_mode: actor.auth_mode.clone(),
            certificate_id,
            key_id: issued.key_id.clone(),
            target_host: request.target_host,
            principals: issued.principals.clone(),
            issued_at: issued.issued_at,
            expires_at: issued.expires_at,
        })
        .map_err(ApiError::internal)?;

    Ok(Json(IssueCertResponse {
        certificate_id,
        serial: issued.serial,
        ttl_seconds,
        issued_at: issued.issued_at,
        expires_at: issued.expires_at,
        ca_key_id: issued.ca_key_id.clone(),
        ca_public_key_openssh: issued.ca_public_key_openssh.clone(),
        ca_fingerprint_sha256: issued.ca_fingerprint_sha256.clone(),
        key_id: issued.key_id,
        certificate_pem: issued.certificate_openssh.clone(),
        certificate_openssh: issued.certificate_openssh,
        principals: issued.principals,
        actor: actor.subject,
        auth_mode: actor.auth_mode,
    }))
}

async fn create_relay_lease(
    State(state): State<ControlPlaneState>,
    headers: HeaderMap,
    Json(request): Json<RelayLeaseRequest>,
) -> Result<Json<RelayLeaseResponse>, ApiError> {
    let _actor = authenticate(&state, &headers)?;
    state
        .relay
        .create_lease(request)
        .map(Json)
        .map_err(ApiError::bad_request)
}

async fn claim_relay_lease(
    State(state): State<ControlPlaneState>,
    headers: HeaderMap,
    Json(request): Json<ClaimRelayLeaseRequest>,
) -> Result<Response, ApiError> {
    let _actor = authenticate(&state, &headers)?;
    match state
        .relay
        .claim_lease(request)
        .map_err(ApiError::bad_request)?
    {
        Some(lease) => Ok(Json(lease).into_response()),
        None => Ok(StatusCode::NO_CONTENT.into_response()),
    }
}

async fn register_relay_node(
    State(state): State<ControlPlaneState>,
    headers: HeaderMap,
    Json(request): Json<RegisterNodeRequest>,
) -> Result<Json<RegisterNodeResponse>, ApiError> {
    let _actor = authenticate(&state, &headers)?;
    state
        .relay
        .register_node(request)
        .map(Json)
        .map_err(ApiError::bad_request)
}

fn authenticate(
    state: &ControlPlaneState,
    headers: &HeaderMap,
) -> Result<AuthenticatedActor, ApiError> {
    state
        .access_token_validator
        .authenticate(headers)
        .map_err(ApiError::unauthorized)
}

fn control_plane_state_dir() -> PathBuf {
    if let Some(explicit) = std::env::var_os("OZY_CONTROL_PLANE_STATE_DIR") {
        return PathBuf::from(explicit);
    }

    home_dir()
        .map(|base| base.join(".ozyterminal").join("control-plane"))
        .unwrap_or_else(|| {
            PathBuf::from(".")
                .join(".ozyterminal")
                .join("control-plane")
        })
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

#[derive(Serialize)]
struct ApiErrorResponse {
    error: String,
}

impl ApiError {
    fn bad_request(error: impl ToString) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: error.to_string(),
        }
    }

    fn unauthorized(error: impl ToString) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: error.to_string(),
        }
    }

    fn internal(error: impl ToString) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: error.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ApiErrorResponse {
                error: self.message,
            }),
        )
            .into_response()
    }
}
