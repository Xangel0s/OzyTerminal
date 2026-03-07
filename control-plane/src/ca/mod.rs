use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use parking_lot::RwLock;
use rand::rngs::OsRng;
use serde::Serialize;
use ssh_key::{
    certificate::{Builder, CertType},
    Algorithm, HashAlg, LineEnding, PrivateKey, PublicKey,
};

#[derive(Clone)]
pub struct EphemeralCaService {
    ca_key: Arc<PrivateKey>,
    ca_key_path: Arc<PathBuf>,
    serial_counter_path: Arc<PathBuf>,
    serial_counter: Arc<RwLock<u64>>,
    ca_key_id: Arc<String>,
}

#[derive(Debug, Clone)]
pub struct IssueCertificateOptions {
    pub username: String,
    pub target_host: String,
    pub public_key_openssh: String,
    pub principals: Vec<String>,
    pub ttl_seconds: u64,
    pub environment: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedCertificateMaterial {
    pub serial: u64,
    pub key_id: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub principals: Vec<String>,
    pub certificate_openssh: String,
    pub ca_key_id: String,
    pub ca_public_key_openssh: String,
    pub ca_fingerprint_sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaInfo {
    pub ca_key_id: String,
    pub ca_key_path: String,
    pub ca_public_key_openssh: String,
    pub ca_fingerprint_sha256: String,
}

impl EphemeralCaService {
    pub fn bootstrap(state_dir: &Path) -> Result<Self> {
        fs::create_dir_all(state_dir).with_context(|| {
            format!(
                "failed to create control-plane state directory {}",
                state_dir.display()
            )
        })?;

        let ca_key_path = std::env::var_os("OZY_CONTROL_PLANE_CA_KEY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| state_dir.join("ca_ed25519"));
        let serial_counter_path = state_dir.join("ca.serial");
        let ca_key = if ca_key_path.exists() {
            PrivateKey::read_openssh_file(&ca_key_path)
                .with_context(|| format!("failed to read CA key {}", ca_key_path.display()))?
        } else {
            let ca_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519)
                .context("failed to generate Ed25519 CA key")?;
            ca_key
                .write_openssh_file(&ca_key_path, LineEnding::LF)
                .with_context(|| format!("failed to persist CA key {}", ca_key_path.display()))?;
            ca_key
        };

        let serial_counter = read_serial_counter(&serial_counter_path).unwrap_or_default();
        let ca_key_id = std::env::var("OZY_CONTROL_PLANE_CA_KEY_ID").unwrap_or_else(|_| {
            format!(
                "ca-ed25519-{}",
                ca_key.public_key().fingerprint(HashAlg::Sha256)
            )
        });

        Ok(Self {
            ca_key: Arc::new(ca_key),
            ca_key_path: Arc::new(ca_key_path),
            serial_counter_path: Arc::new(serial_counter_path),
            serial_counter: Arc::new(RwLock::new(serial_counter)),
            ca_key_id: Arc::new(ca_key_id),
        })
    }

    pub fn info(&self) -> Result<CaInfo> {
        Ok(CaInfo {
            ca_key_id: self.ca_key_id.to_string(),
            ca_key_path: self.ca_key_path.display().to_string(),
            ca_public_key_openssh: self.ca_key.public_key().to_openssh()?,
            ca_fingerprint_sha256: self
                .ca_key
                .public_key()
                .fingerprint(HashAlg::Sha256)
                .to_string(),
        })
    }

    pub fn issue_user_certificate(
        &self,
        options: IssueCertificateOptions,
    ) -> Result<IssuedCertificateMaterial> {
        let issued_at = now();
        let expires_at = issued_at + options.ttl_seconds;
        let principals = if options.principals.is_empty() {
            vec![options.username.clone()]
        } else {
            options.principals.clone()
        };
        let serial = self.next_serial()?;
        let subject_key = PublicKey::from_openssh(&options.public_key_openssh)
            .context("failed to parse subject public key")?;
        let key_id = format!(
            "{}:{}:{}:{}",
            options.environment, options.username, options.target_host, serial
        );

        let mut builder =
            Builder::new_with_random_nonce(&mut OsRng, subject_key, issued_at, expires_at)
                .context("failed to initialize certificate builder")?;
        builder.serial(serial)?;
        builder.cert_type(CertType::User)?;
        builder.key_id(key_id.clone())?;
        builder.comment(format!("{}@{}", options.username, options.target_host))?;
        for principal in &principals {
            builder.valid_principal(principal.clone())?;
        }
        builder.extension("permit-pty", "")?;
        builder.extension("permit-user-rc", "")?;
        if options.environment != "production" {
            builder.extension("permit-port-forwarding", "")?;
            builder.extension("permit-agent-forwarding", "")?;
        }

        let certificate = builder
            .sign(self.ca_key.as_ref())
            .context("failed to sign OpenSSH certificate")?;
        let certificate_openssh = certificate
            .to_openssh()
            .context("failed to encode OpenSSH certificate")?;
        let info = self.info()?;

        Ok(IssuedCertificateMaterial {
            serial,
            key_id,
            issued_at,
            expires_at,
            principals,
            certificate_openssh,
            ca_key_id: info.ca_key_id,
            ca_public_key_openssh: info.ca_public_key_openssh,
            ca_fingerprint_sha256: info.ca_fingerprint_sha256,
        })
    }

    fn next_serial(&self) -> Result<u64> {
        let mut serial = self.serial_counter.write();
        *serial += 1;
        fs::write(self.serial_counter_path.as_path(), serial.to_string()).with_context(|| {
            format!(
                "failed to persist serial counter {}",
                self.serial_counter_path.display()
            )
        })?;
        Ok(*serial)
    }
}

fn read_serial_counter(path: &Path) -> Option<u64> {
    fs::read_to_string(path).ok()?.trim().parse().ok()
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{EphemeralCaService, IssueCertificateOptions};
    use rand::rngs::OsRng;
    use ssh_key::{HashAlg, PrivateKey};
    use std::{env, fs};

    #[test]
    fn issues_valid_openssh_certificate() {
        let state_dir = env::temp_dir().join("ozyterminal-control-plane-ca-test");
        let _ = fs::remove_dir_all(&state_dir);

        let service = EphemeralCaService::bootstrap(&state_dir).expect("bootstrap CA service");
        let subject_key =
            PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).expect("subject key");

        let issued = service
            .issue_user_certificate(IssueCertificateOptions {
                username: "ozy".into(),
                target_host: "srv-01".into(),
                public_key_openssh: subject_key
                    .public_key()
                    .to_openssh()
                    .expect("subject pubkey"),
                principals: vec!["ozy".into()],
                ttl_seconds: 300,
                environment: "development".into(),
            })
            .expect("issue cert");

        let certificate =
            ssh_key::Certificate::from_openssh(&issued.certificate_openssh).expect("parse cert");
        let subject_fingerprint = subject_key.public_key().fingerprint(HashAlg::Sha256);
        certificate
            .validate_at(
                issued.issued_at + 1,
                std::slice::from_ref(&subject_fingerprint),
            )
            .expect_err("subject key is not a trusted CA");
        let trusted_ca: ssh_key::Fingerprint = service
            .info()
            .expect("ca info")
            .ca_fingerprint_sha256
            .parse()
            .expect("fingerprint");
        certificate
            .validate_at(issued.issued_at + 1, std::slice::from_ref(&trusted_ca))
            .expect("certificate should validate against the CA");
        assert!(certificate
            .valid_principals()
            .iter()
            .any(|principal| principal == "ozy"));

        let _ = fs::remove_dir_all(&state_dir);
    }
}
