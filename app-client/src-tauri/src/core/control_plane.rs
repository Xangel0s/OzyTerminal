use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use russh::keys;
use serde::{Deserialize, Serialize};

const DEFAULT_CERTIFICATE_TTL_SECONDS: u64 = 900;
const DEFAULT_RENEW_BEFORE_SECONDS: u64 = 60;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlPlaneConfig {
    pub base_url: String,
    pub access_token: Option<String>,
    pub environment: Option<String>,
    #[serde(default)]
    pub principals: Vec<String>,
    pub ttl_seconds: Option<u64>,
    pub renew_before_seconds: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedSshCertificate {
    pub certificate_id: Option<String>,
    pub serial: Option<u64>,
    pub issued_at: u64,
    pub expires_at: u64,
    pub ca_key_id: Option<String>,
    pub ca_public_key_openssh: Option<String>,
    pub ca_fingerprint_sha256: Option<String>,
    pub key_id: String,
    pub certificate_pem: String,
    pub certificate_openssh: String,
    pub principals: Vec<String>,
    pub source: CertificateSource,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRelayLease {
    pub lease_id: String,
    pub token: String,
    pub relay_address: String,
    pub target_node_id: String,
    pub requested_port: u16,
    pub purpose: String,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CertificateSource {
    Existing,
    ControlPlane,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSshCertificateCommandRequest {
    pub host: String,
    pub username: String,
    pub private_key_pem: String,
    pub private_key_passphrase: Option<String>,
    pub existing_certificate_pem: Option<String>,
    pub control_plane: ControlPlaneConfig,
    pub reuse_if_fresh: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRelayLeaseCommandRequest {
    pub target_node_id: String,
    pub requested_port: Option<u16>,
    pub purpose: Option<String>,
    pub control_plane: ControlPlaneConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IssueCertPayload {
    username: String,
    target_host: String,
    public_key_openssh: String,
    ttl_seconds: Option<u64>,
    principals: Vec<String>,
    environment: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IssueRelayLeasePayload {
    target_node_id: String,
    requested_port: Option<u16>,
    ttl_seconds: Option<u64>,
    purpose: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueCertHttpResponse {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueRelayLeaseHttpResponse {
    lease_id: String,
    token: String,
    relay_address: String,
    target_node_id: String,
    requested_port: u16,
    purpose: String,
    issued_at: u64,
    expires_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEnvelope {
    error: String,
}

pub async fn issue_ssh_certificate(
    request: IssueSshCertificateCommandRequest,
) -> Result<ResolvedSshCertificate> {
    let private_key = load_private_key(
        &request.private_key_pem,
        request.private_key_passphrase.as_deref(),
    )?;
    let public_key_openssh = private_key
        .public_key()
        .to_openssh()
        .context("failed to serialize public key to OpenSSH")?;

    if request.reuse_if_fresh.unwrap_or(true) {
        if let Some(existing_certificate) = request.existing_certificate_pem.as_deref() {
            if matches!(
                certificate_is_fresh(
                    existing_certificate,
                    &request.username,
                    request
                        .control_plane
                        .renew_before_seconds
                        .unwrap_or(DEFAULT_RENEW_BEFORE_SECONDS),
                ),
                Ok(true)
            ) {
                if let Ok(described) = describe_existing_certificate(existing_certificate) {
                    return Ok(described);
                }
            }
        }
    }

    issue_certificate_from_control_plane(
        &request.control_plane,
        &request.username,
        &request.host,
        &public_key_openssh,
    )
    .await
}

pub async fn issue_relay_lease(
    request: IssueRelayLeaseCommandRequest,
) -> Result<ResolvedRelayLease> {
    issue_relay_lease_from_control_plane(
        &request.control_plane,
        &request.target_node_id,
        request.requested_port,
        request.purpose.as_deref().unwrap_or("ssh"),
    )
    .await
}

pub fn certificate_is_fresh(
    certificate_pem: &str,
    username: &str,
    renew_before_seconds: u64,
) -> Result<bool> {
    let certificate = keys::Certificate::from_openssh(certificate_pem)
        .context("failed to parse existing OpenSSH certificate")?;
    let now = unix_timestamp();
    let valid_principals = certificate.valid_principals();
    let principal_matches = valid_principals.is_empty()
        || valid_principals
            .iter()
            .any(|principal| principal == username);

    Ok(principal_matches && certificate.valid_before() > now + renew_before_seconds)
}

pub fn describe_existing_certificate(certificate_pem: &str) -> Result<ResolvedSshCertificate> {
    let certificate = keys::Certificate::from_openssh(certificate_pem)
        .context("failed to parse existing OpenSSH certificate")?;

    Ok(ResolvedSshCertificate {
        certificate_id: None,
        serial: None,
        issued_at: certificate.valid_after(),
        expires_at: certificate.valid_before(),
        ca_key_id: None,
        ca_public_key_openssh: None,
        ca_fingerprint_sha256: None,
        key_id: certificate.key_id().to_string(),
        certificate_pem: certificate_pem.to_string(),
        certificate_openssh: certificate_pem.to_string(),
        principals: certificate.valid_principals().to_vec(),
        source: CertificateSource::Existing,
    })
}

async fn issue_certificate_from_control_plane(
    control_plane: &ControlPlaneConfig,
    username: &str,
    host: &str,
    public_key_openssh: &str,
) -> Result<ResolvedSshCertificate> {
    let base_url = normalized_base_url(&control_plane.base_url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .context("failed to build reqwest client")?;
    let mut headers = HeaderMap::new();
    if let Some(token) = control_plane.access_token.as_deref() {
        let value = format!("Bearer {token}");
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&value).context("invalid control-plane bearer token")?,
        );
    }

    let response = client
        .post(format!("{base_url}/v1/ssh/certificates/issue"))
        .headers(headers)
        .json(&IssueCertPayload {
            username: username.to_string(),
            target_host: host.to_string(),
            public_key_openssh: public_key_openssh.to_string(),
            ttl_seconds: Some(
                control_plane
                    .ttl_seconds
                    .unwrap_or(DEFAULT_CERTIFICATE_TTL_SECONDS),
            ),
            principals: control_plane.principals.clone(),
            environment: control_plane.environment.clone(),
        })
        .send()
        .await
        .context("failed to call control-plane certificate issue endpoint")?;

    if !response.status().is_success() {
        let status = response.status();
        let message = response
            .json::<ErrorEnvelope>()
            .await
            .map(|payload| payload.error)
            .unwrap_or_else(|_| format!("control-plane returned HTTP {status}"));
        return Err(anyhow!(message));
    }

    let issued = response
        .json::<IssueCertHttpResponse>()
        .await
        .context("failed to parse control-plane certificate response")?;

    Ok(ResolvedSshCertificate {
        certificate_id: Some(issued.certificate_id),
        serial: Some(issued.serial),
        issued_at: issued.issued_at,
        expires_at: issued.expires_at,
        ca_key_id: Some(issued.ca_key_id),
        ca_public_key_openssh: Some(issued.ca_public_key_openssh),
        ca_fingerprint_sha256: Some(issued.ca_fingerprint_sha256),
        key_id: issued.key_id,
        certificate_pem: issued.certificate_pem.clone(),
        certificate_openssh: issued.certificate_openssh,
        principals: issued.principals,
        source: CertificateSource::ControlPlane,
    })
}

async fn issue_relay_lease_from_control_plane(
    control_plane: &ControlPlaneConfig,
    target_node_id: &str,
    requested_port: Option<u16>,
    purpose: &str,
) -> Result<ResolvedRelayLease> {
    let base_url = normalized_base_url(&control_plane.base_url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .context("failed to build reqwest client")?;
    let mut headers = HeaderMap::new();
    if let Some(token) = control_plane.access_token.as_deref() {
        let value = format!("Bearer {token}");
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&value).context("invalid control-plane bearer token")?,
        );
    }

    let response = client
        .post(format!("{base_url}/v1/relay/leases"))
        .headers(headers)
        .json(&IssueRelayLeasePayload {
            target_node_id: target_node_id.to_string(),
            requested_port,
            ttl_seconds: None,
            purpose: purpose.to_string(),
        })
        .send()
        .await
        .context("failed to call control-plane relay lease endpoint")?;

    if !response.status().is_success() {
        let status = response.status();
        let message = response
            .json::<ErrorEnvelope>()
            .await
            .map(|payload| payload.error)
            .unwrap_or_else(|_| format!("control-plane returned HTTP {status}"));
        return Err(anyhow!(message));
    }

    let lease = response
        .json::<IssueRelayLeaseHttpResponse>()
        .await
        .context("failed to parse control-plane relay lease response")?;

    Ok(ResolvedRelayLease {
        lease_id: lease.lease_id,
        token: lease.token,
        relay_address: lease.relay_address,
        target_node_id: lease.target_node_id,
        requested_port: lease.requested_port,
        purpose: lease.purpose,
        issued_at: lease.issued_at,
        expires_at: lease.expires_at,
    })
}

fn load_private_key(private_key_pem: &str, passphrase: Option<&str>) -> Result<keys::PrivateKey> {
    keys::decode_secret_key(private_key_pem, passphrase).context("failed to decode private key")
}

fn normalized_base_url(base_url: &str) -> Result<String> {
    let value = base_url.trim().trim_end_matches('/');
    if value.is_empty() {
        return Err(anyhow!("control-plane base URL is required"));
    }

    Ok(value.to_string())
}

fn unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{certificate_is_fresh, describe_existing_certificate, normalized_base_url};
    use rand::rngs::OsRng;
    use russh::keys::{self, HashAlg};

    fn issue_certificate(
        ca_key: &keys::PrivateKey,
        subject_key: &keys::PrivateKey,
        username: &str,
        ttl_seconds: u64,
    ) -> anyhow::Result<String> {
        use keys::ssh_key::certificate::{Builder, CertType};

        let issued_at = super::unix_timestamp();
        let mut builder = Builder::new_with_random_nonce(
            &mut OsRng,
            subject_key.public_key(),
            issued_at,
            issued_at + ttl_seconds,
        )?;
        builder.cert_type(CertType::User)?;
        builder.key_id(format!("{username}-cert"))?;
        builder.valid_principal(username)?;
        builder.extension("permit-pty", "")?;
        builder.comment(format!("{username}@test"))?;

        let cert = builder.sign(ca_key)?;
        cert.validate_at(
            issued_at + 1,
            std::slice::from_ref(&ca_key.fingerprint(HashAlg::Sha256)),
        )?;
        Ok(cert.to_openssh()?)
    }

    #[test]
    fn detects_fresh_certificate() {
        let ca_key = keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).unwrap();
        let subject_key = keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).unwrap();
        let cert = issue_certificate(&ca_key, &subject_key, "ozy", 300).unwrap();

        assert!(certificate_is_fresh(&cert, "ozy", 60).unwrap());
        assert!(!certificate_is_fresh(&cert, "another-user", 60).unwrap());
        let described = describe_existing_certificate(&cert).unwrap();
        assert_eq!(described.key_id, "ozy-cert");
    }

    #[test]
    fn normalizes_control_plane_urls() {
        assert_eq!(
            normalized_base_url("http://127.0.0.1:8080///").unwrap(),
            "http://127.0.0.1:8080"
        );
        assert!(normalized_base_url("   ").is_err());
    }
}
