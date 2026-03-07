use anyhow::{anyhow, Context, Result};
use russh::keys;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectImportedCredentialRequest {
    pub content: String,
    pub filename: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportedCredentialKind {
    PrivateKey,
    Certificate,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectImportedCredentialResponse {
    pub kind: ImportedCredentialKind,
    pub filename: Option<String>,
    pub algorithm: Option<String>,
    pub fingerprint_sha256: Option<String>,
    pub public_key_openssh: Option<String>,
    pub key_id: Option<String>,
    #[serde(default)]
    pub principals: Vec<String>,
    pub valid_after: Option<u64>,
    pub valid_before: Option<u64>,
    pub requires_passphrase: bool,
    pub normalized_content: String,
    pub summary: String,
}

pub fn inspect_imported_credential(
    request: InspectImportedCredentialRequest,
) -> Result<InspectImportedCredentialResponse> {
    let normalized_content = request.content.trim().to_string();
    if normalized_content.is_empty() {
        return Err(anyhow!("imported credential is empty"));
    }

    if let Ok(certificate) = keys::Certificate::from_openssh(&normalized_content) {
        return inspect_certificate(certificate, request.filename, normalized_content);
    }

    inspect_private_key(
        &normalized_content,
        request.filename,
        request.passphrase.as_deref(),
    )
}

fn inspect_certificate(
    certificate: keys::Certificate,
    filename: Option<String>,
    normalized_content: String,
) -> Result<InspectImportedCredentialResponse> {
    let public_key = keys::PublicKey::new(certificate.public_key().clone(), "");
    let fingerprint_sha256 = public_key.fingerprint(keys::HashAlg::Sha256).to_string();
    let principals = certificate.valid_principals().to_vec();
    let key_id = certificate.key_id().to_string();

    Ok(InspectImportedCredentialResponse {
        kind: ImportedCredentialKind::Certificate,
        filename,
        algorithm: Some(certificate.algorithm().as_str().to_string()),
        fingerprint_sha256: Some(fingerprint_sha256.clone()),
        public_key_openssh: Some(
            public_key
                .to_openssh()
                .context("failed to serialize certificate public key to OpenSSH")?,
        ),
        key_id: Some(key_id.clone()),
        principals: principals.clone(),
        valid_after: Some(certificate.valid_after()),
        valid_before: Some(certificate.valid_before()),
        requires_passphrase: false,
        normalized_content,
        summary: format!(
            "certificado {} {} con {} principal(es)",
            certificate.algorithm().as_str(),
            key_id,
            principals.len()
        ),
    })
}

fn inspect_private_key(
    normalized_content: &str,
    filename: Option<String>,
    passphrase: Option<&str>,
) -> Result<InspectImportedCredentialResponse> {
    match keys::decode_secret_key(normalized_content, passphrase) {
        Ok(private_key) => {
            let public_key = private_key.public_key();
            let fingerprint_sha256 = public_key.fingerprint(keys::HashAlg::Sha256).to_string();
            Ok(InspectImportedCredentialResponse {
                kind: ImportedCredentialKind::PrivateKey,
                filename,
                algorithm: Some(public_key.algorithm().as_str().to_string()),
                fingerprint_sha256: Some(fingerprint_sha256.clone()),
                public_key_openssh: Some(
                    public_key
                        .to_openssh()
                        .context("failed to serialize public key to OpenSSH")?,
                ),
                key_id: None,
                principals: Vec::new(),
                valid_after: None,
                valid_before: None,
                requires_passphrase: false,
                normalized_content: normalized_content.to_string(),
                summary: format!(
                    "private key {} {} importada",
                    public_key.algorithm().as_str(),
                    fingerprint_sha256
                ),
            })
        }
        Err(error)
            if looks_like_private_key(normalized_content)
                && passphrase.is_none()
                && error_looks_like_missing_passphrase(&error.to_string()) =>
        {
            Ok(InspectImportedCredentialResponse {
                kind: ImportedCredentialKind::PrivateKey,
                filename,
                algorithm: None,
                fingerprint_sha256: None,
                public_key_openssh: None,
                key_id: None,
                principals: Vec::new(),
                valid_after: None,
                valid_before: None,
                requires_passphrase: true,
                normalized_content: normalized_content.to_string(),
                summary: "private key importada, pero requiere passphrase para validarla".into(),
            })
        }
        Err(error) if looks_like_private_key(normalized_content) => {
            Err(error).context("failed to decode imported private key with the provided passphrase")
        }
        Err(error) => Err(error).context(
            "the imported file is neither a supported private key nor an OpenSSH certificate",
        ),
    }
}

fn looks_like_private_key(content: &str) -> bool {
    [
        "BEGIN OPENSSH PRIVATE KEY",
        "BEGIN RSA PRIVATE KEY",
        "BEGIN PRIVATE KEY",
        "BEGIN EC PRIVATE KEY",
        "BEGIN DSA PRIVATE KEY",
        "BEGIN ENCRYPTED PRIVATE KEY",
    ]
    .iter()
    .any(|marker| content.contains(marker))
}

fn error_looks_like_missing_passphrase(message: &str) -> bool {
    let normalized = message.to_lowercase();
    normalized.contains("password")
        || normalized.contains("passphrase")
        || normalized.contains("encrypted")
        || normalized.contains("decrypt")
}

#[cfg(test)]
mod tests {
    use super::{
        inspect_imported_credential, ImportedCredentialKind, InspectImportedCredentialRequest,
    };
    use rand::rngs::OsRng;
    use russh::keys;

    fn issue_certificate(
        ca_key: &keys::PrivateKey,
        subject_key: &keys::PublicKey,
        username: &str,
        ttl_seconds: u64,
    ) -> anyhow::Result<String> {
        use keys::ssh_key::certificate::{Builder, CertType};

        let issued_at = 1_700_000_000;
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
        builder.comment(format!("{username}@ozyterminal.test"))?;

        Ok(builder.sign(ca_key)?.to_openssh()?)
    }

    #[test]
    fn inspects_private_keys() {
        let private_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("private key");
        let content = private_key
            .to_openssh(keys::ssh_key::LineEnding::LF)
            .expect("private key pem")
            .to_string();

        let response = inspect_imported_credential(InspectImportedCredentialRequest {
            content,
            filename: Some("id_ed25519".into()),
            passphrase: None,
        })
        .expect("inspect private key");

        assert_eq!(response.kind, ImportedCredentialKind::PrivateKey);
        assert!(response.fingerprint_sha256.is_some());
        assert!(!response.requires_passphrase);
    }

    #[test]
    fn inspects_certificates() {
        let ca_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("ca key");
        let subject_key =
            keys::PrivateKey::random(&mut OsRng, keys::Algorithm::Ed25519).expect("subject key");
        let certificate =
            issue_certificate(&ca_key, subject_key.public_key(), "ozy", 300).expect("cert");

        let response = inspect_imported_credential(InspectImportedCredentialRequest {
            content: certificate,
            filename: Some("id_ed25519-cert.pub".into()),
            passphrase: None,
        })
        .expect("inspect cert");

        assert_eq!(response.kind, ImportedCredentialKind::Certificate);
        assert_eq!(response.key_id.as_deref(), Some("ozy-cert"));
        assert_eq!(response.principals, vec!["ozy"]);
    }

    #[test]
    fn rejects_unknown_material() {
        let error = inspect_imported_credential(InspectImportedCredentialRequest {
            content: "not-a-key".into(),
            filename: Some("notes.txt".into()),
            passphrase: None,
        })
        .expect_err("invalid material should fail");

        assert!(error
            .to_string()
            .contains("neither a supported private key nor an OpenSSH certificate"));
    }
}
