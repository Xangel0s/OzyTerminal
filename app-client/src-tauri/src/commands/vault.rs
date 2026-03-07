use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::core::{control_plane::ControlPlaneConfig, ssh_client::RelayHint};
use crate::crypto::envelope::{
    decrypt_secret_bytes, derive_master_key, derive_master_key_with_config, encrypt_secret_bytes,
    random_array, KdfConfig, DEFAULT_MASTER_KEY_LEN,
};

const LOCAL_VAULT_VERSION: u32 = 2;
const LEGACY_LOCAL_VAULT_VERSION: u32 = 1;
const LOCAL_VAULT_AAD_V1: &str = "ozyterminal.local-vault.v1";
const LOCAL_VAULT_AAD_V2: &str = "ozyterminal.local-vault.v2";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptSecretRequest {
    pub master_password: String,
    pub plaintext: String,
    pub aad: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptSecretResponse {
    pub salt_b64: String,
    pub dek_nonce_b64: String,
    pub secret_nonce_b64: String,
    pub wrapped_dek_b64: String,
    pub ciphertext_b64: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_pem: String,
    pub private_key_passphrase: Option<String>,
    pub certificate_pem: Option<String>,
    pub known_host_fingerprint: Option<String>,
    pub relay_hint: Option<RelayHint>,
    pub control_plane: Option<ControlPlaneConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostEntry {
    pub host: String,
    pub port: u16,
    pub fingerprint_sha256: String,
    pub host_key_openssh: String,
    pub added_at: u64,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalVaultRequest {
    pub master_password: String,
    pub entries: Vec<VaultEntry>,
    pub known_hosts: Option<Vec<KnownHostEntry>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadLocalVaultRequest {
    pub master_password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateLocalVaultPasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalVaultResponse {
    pub entries: Vec<VaultEntry>,
    pub known_hosts: Vec<KnownHostEntry>,
    pub updated_at: u64,
    pub vault_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVaultFile {
    version: u32,
    vault_id: String,
    created_at: u64,
    updated_at: u64,
    aad: String,
    kdf: LocalVaultKdf,
    dek_nonce_b64: String,
    payload_nonce_b64: String,
    wrapped_dek_b64: String,
    ciphertext_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVaultKdf {
    algorithm: String,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    output_len: usize,
    salt_b64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyLocalVaultFile {
    version: u32,
    updated_at: u64,
    salt_b64: String,
    dek_nonce_b64: String,
    secret_nonce_b64: String,
    wrapped_dek_b64: String,
    ciphertext_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVaultPayload {
    entries: Vec<VaultEntry>,
    #[serde(default)]
    known_hosts: Vec<KnownHostEntry>,
}

#[derive(Debug, Clone)]
struct VaultMetadata {
    vault_id: String,
    created_at: u64,
}

#[tauri::command]
pub fn encrypt_secret(request: EncryptSecretRequest) -> Result<EncryptSecretResponse, String> {
    let salt = random_array::<16>();
    let dek = random_array::<32>();
    let dek_nonce = random_array::<12>();
    let secret_nonce = random_array::<12>();
    let master_key = derive_master_key(request.master_password.as_bytes(), &salt)
        .map_err(|err| err.to_string())?;
    let (wrapped_dek, ciphertext) = encrypt_secret_bytes(
        &master_key,
        &dek,
        &dek_nonce,
        &secret_nonce,
        request.aad.as_bytes(),
        request.plaintext.as_bytes(),
    )
    .map_err(|err| err.to_string())?;

    Ok(EncryptSecretResponse {
        salt_b64: STANDARD.encode(salt),
        dek_nonce_b64: STANDARD.encode(dek_nonce),
        secret_nonce_b64: STANDARD.encode(secret_nonce),
        wrapped_dek_b64: STANDARD.encode(wrapped_dek),
        ciphertext_b64: STANDARD.encode(ciphertext),
    })
}

#[tauri::command]
pub fn save_local_vault(request: SaveLocalVaultRequest) -> Result<LocalVaultResponse, String> {
    let vault_path = local_vault_path()?;
    let mut master_password = request.master_password.into_bytes();
    let (metadata, existing_payload) = load_existing_context(&vault_path, &master_password)?;
    let response = persist_local_vault(
        &vault_path,
        &master_password,
        request.entries,
        request.known_hosts.unwrap_or_else(|| {
            existing_payload
                .map(|payload| payload.known_hosts)
                .unwrap_or_default()
        }),
        metadata,
    )?;
    master_password.zeroize();
    Ok(response)
}

#[tauri::command]
pub fn rotate_local_vault_password(
    request: RotateLocalVaultPasswordRequest,
) -> Result<LocalVaultResponse, String> {
    let vault_path = local_vault_path()?;
    let mut current_password = request.current_password.into_bytes();
    let mut new_password = request.new_password.into_bytes();

    let (payload, metadata, response) =
        read_local_vault_with_password(&vault_path, &current_password)?;
    let rotated = persist_local_vault(
        &vault_path,
        &new_password,
        payload.entries,
        payload.known_hosts,
        Some(metadata),
    )?;

    current_password.zeroize();
    new_password.zeroize();

    Ok(LocalVaultResponse {
        entries: rotated.entries,
        known_hosts: rotated.known_hosts,
        updated_at: response.updated_at.max(rotated.updated_at),
        vault_path: rotated.vault_path,
    })
}

#[tauri::command]
pub fn load_local_vault(request: LoadLocalVaultRequest) -> Result<LocalVaultResponse, String> {
    let vault_path = local_vault_path()?;
    let mut master_password = request.master_password.into_bytes();
    let (_, _, response) = read_local_vault_with_password(&vault_path, &master_password)?;
    master_password.zeroize();
    Ok(response)
}

fn decode_array<const N: usize>(value: &str) -> Result<[u8; N], String> {
    let bytes = STANDARD.decode(value).map_err(|err| err.to_string())?;
    bytes
        .try_into()
        .map_err(|_| format!("expected {N} decoded bytes"))
}

fn local_vault_path() -> Result<PathBuf, String> {
    if let Some(explicit) = std::env::var_os("OZYTERMINAL_VAULT_PATH") {
        return Ok(PathBuf::from(explicit));
    }

    let base = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "unable to resolve home directory".to_string())?;
    Ok(PathBuf::from(base)
        .join(".ozyterminal")
        .join("vault.local.json"))
}

fn unix_timestamp() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|err| err.to_string())
}

fn load_existing_context(
    vault_path: &Path,
    master_password: &[u8],
) -> Result<(Option<VaultMetadata>, Option<LocalVaultPayload>), String> {
    if !vault_path.exists() {
        return Ok((None, None));
    }

    let (payload, metadata, _) = read_local_vault_with_password(vault_path, master_password)?;
    Ok((Some(metadata), Some(payload)))
}

fn read_local_vault_with_password(
    vault_path: &Path,
    master_password: &[u8],
) -> Result<(LocalVaultPayload, VaultMetadata, LocalVaultResponse), String> {
    let vault_file = read_local_vault_file(vault_path)?;
    let payload = decrypt_local_vault(&vault_file, master_password)?;
    let metadata = VaultMetadata {
        vault_id: vault_file.vault_id.clone(),
        created_at: vault_file.created_at,
    };

    Ok((
        payload.clone(),
        metadata,
        LocalVaultResponse {
            entries: payload.entries,
            known_hosts: payload.known_hosts,
            updated_at: vault_file.updated_at,
            vault_path: vault_path.display().to_string(),
        },
    ))
}

fn persist_local_vault(
    vault_path: &Path,
    master_password: &[u8],
    entries: Vec<VaultEntry>,
    known_hosts: Vec<KnownHostEntry>,
    metadata: Option<VaultMetadata>,
) -> Result<LocalVaultResponse, String> {
    if let Some(parent) = vault_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let now = unix_timestamp()?;
    let metadata = metadata.unwrap_or_else(|| VaultMetadata {
        vault_id: Uuid::new_v4().to_string(),
        created_at: now,
    });

    let payload = LocalVaultPayload {
        entries,
        known_hosts,
    };
    let mut payload_json = serde_json::to_vec(&payload).map_err(|err| err.to_string())?;
    let salt = random_array::<16>();
    let mut dek = random_array::<32>();
    let dek_nonce = random_array::<12>();
    let payload_nonce = random_array::<12>();
    let kdf_config = KdfConfig::default();
    let mut master_key =
        derive_master_key(master_password, &salt).map_err(|err| err.to_string())?;
    let aad = format!("{LOCAL_VAULT_AAD_V2}:{}", metadata.vault_id);
    let (wrapped_dek, ciphertext) = encrypt_secret_bytes(
        &master_key,
        &dek,
        &dek_nonce,
        &payload_nonce,
        aad.as_bytes(),
        &payload_json,
    )
    .map_err(|err| err.to_string())?;

    master_key.zeroize();
    dek.zeroize();
    payload_json.zeroize();

    let vault_file = LocalVaultFile {
        version: LOCAL_VAULT_VERSION,
        vault_id: metadata.vault_id,
        created_at: metadata.created_at,
        updated_at: now,
        aad,
        kdf: LocalVaultKdf {
            algorithm: "argon2id".into(),
            memory_kib: kdf_config.memory_kib,
            iterations: kdf_config.iterations,
            parallelism: kdf_config.parallelism,
            output_len: kdf_config.output_len,
            salt_b64: STANDARD.encode(salt),
        },
        dek_nonce_b64: STANDARD.encode(dek_nonce),
        payload_nonce_b64: STANDARD.encode(payload_nonce),
        wrapped_dek_b64: STANDARD.encode(wrapped_dek),
        ciphertext_b64: STANDARD.encode(ciphertext),
    };

    let serialized = serde_json::to_vec_pretty(&vault_file).map_err(|err| err.to_string())?;
    atomic_write(vault_path, &serialized)?;

    Ok(LocalVaultResponse {
        entries: payload.entries,
        known_hosts: payload.known_hosts,
        updated_at: now,
        vault_path: vault_path.display().to_string(),
    })
}

fn read_local_vault_file(vault_path: &Path) -> Result<LocalVaultFile, String> {
    let file_bytes = fs::read(vault_path).map_err(|err| err.to_string())?;
    let version = serde_json::from_slice::<serde_json::Value>(&file_bytes)
        .map_err(|err| err.to_string())?
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "vault file is missing a version".to_string())? as u32;

    match version {
        LOCAL_VAULT_VERSION => serde_json::from_slice(&file_bytes).map_err(|err| err.to_string()),
        LEGACY_LOCAL_VAULT_VERSION => {
            let legacy: LegacyLocalVaultFile =
                serde_json::from_slice(&file_bytes).map_err(|err| err.to_string())?;
            Ok(LocalVaultFile {
                version: legacy.version,
                vault_id: Uuid::new_v4().to_string(),
                created_at: legacy.updated_at,
                updated_at: legacy.updated_at,
                aad: LOCAL_VAULT_AAD_V1.into(),
                kdf: LocalVaultKdf {
                    algorithm: "argon2id".into(),
                    memory_kib: KdfConfig::default().memory_kib,
                    iterations: KdfConfig::default().iterations,
                    parallelism: KdfConfig::default().parallelism,
                    output_len: DEFAULT_MASTER_KEY_LEN,
                    salt_b64: legacy.salt_b64,
                },
                dek_nonce_b64: legacy.dek_nonce_b64,
                payload_nonce_b64: legacy.secret_nonce_b64,
                wrapped_dek_b64: legacy.wrapped_dek_b64,
                ciphertext_b64: legacy.ciphertext_b64,
            })
        }
        other => Err(format!("unsupported vault version {other}")),
    }
}

fn decrypt_local_vault(
    vault_file: &LocalVaultFile,
    master_password: &[u8],
) -> Result<LocalVaultPayload, String> {
    if vault_file.kdf.algorithm != "argon2id" {
        return Err(format!(
            "unsupported vault KDF {}",
            vault_file.kdf.algorithm
        ));
    }

    let salt = decode_array::<16>(&vault_file.kdf.salt_b64)?;
    let dek_nonce = decode_array::<12>(&vault_file.dek_nonce_b64)?;
    let payload_nonce = decode_array::<12>(&vault_file.payload_nonce_b64)?;
    let wrapped_dek = STANDARD
        .decode(&vault_file.wrapped_dek_b64)
        .map_err(|err| err.to_string())?;
    let ciphertext = STANDARD
        .decode(&vault_file.ciphertext_b64)
        .map_err(|err| err.to_string())?;
    let mut master_key = derive_master_key_with_config(
        master_password,
        &salt,
        KdfConfig {
            memory_kib: vault_file.kdf.memory_kib,
            iterations: vault_file.kdf.iterations,
            parallelism: vault_file.kdf.parallelism,
            output_len: vault_file.kdf.output_len,
        },
    )
    .map_err(|err| err.to_string())?;
    let mut plaintext = decrypt_secret_bytes(
        &master_key,
        &wrapped_dek,
        &dek_nonce,
        &ciphertext,
        &payload_nonce,
        vault_file.aad.as_bytes(),
    )
    .map_err(|_| "invalid vault password or corrupted vault".to_string())?;

    master_key.zeroize();
    let payload =
        serde_json::from_slice::<LocalVaultPayload>(&plaintext).map_err(|err| err.to_string())?;
    plaintext.zeroize();

    Ok(payload)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, bytes).map_err(|err| err.to_string())?;
    fs::rename(&temp_path, path).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        load_local_vault, rotate_local_vault_password, save_local_vault, KnownHostEntry,
        LoadLocalVaultRequest, RotateLocalVaultPasswordRequest, SaveLocalVaultRequest, VaultEntry,
    };
    use std::{
        env, fs,
        path::PathBuf,
        sync::{Mutex, OnceLock},
    };

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn test_vault_path(name: &str) -> PathBuf {
        env::temp_dir().join(format!("ozyterminal-vault-test-{name}.json"))
    }

    fn sample_entry() -> VaultEntry {
        VaultEntry {
            id: "entry-1".into(),
            name: "Local".into(),
            host: "127.0.0.1".into(),
            port: 22,
            username: "ozy".into(),
            private_key_pem: "pem".into(),
            private_key_passphrase: Some("secret".into()),
            certificate_pem: None,
            known_host_fingerprint: Some("SHA256:test".into()),
            relay_hint: None,
            control_plane: None,
        }
    }

    fn sample_known_host() -> KnownHostEntry {
        KnownHostEntry {
            host: "127.0.0.1".into(),
            port: 22,
            fingerprint_sha256: "SHA256:test".into(),
            host_key_openssh: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest".into(),
            added_at: 1,
            label: Some("Local".into()),
        }
    }

    #[test]
    fn roundtrip_and_password_rotation() {
        let _guard = env_lock().lock().expect("lock env");
        let vault_path = test_vault_path("rotate");
        let _ = fs::remove_file(&vault_path);
        env::set_var("OZYTERMINAL_VAULT_PATH", &vault_path);

        let saved = save_local_vault(SaveLocalVaultRequest {
            master_password: "old-pass".into(),
            entries: vec![sample_entry()],
            known_hosts: Some(vec![sample_known_host()]),
        })
        .expect("save should succeed");
        assert_eq!(saved.entries.len(), 1);
        assert_eq!(saved.known_hosts.len(), 1);

        let loaded = load_local_vault(LoadLocalVaultRequest {
            master_password: "old-pass".into(),
        })
        .expect("load should succeed");
        assert_eq!(loaded.entries[0].host, "127.0.0.1");
        assert_eq!(loaded.known_hosts.len(), 1);

        rotate_local_vault_password(RotateLocalVaultPasswordRequest {
            current_password: "old-pass".into(),
            new_password: "new-pass".into(),
        })
        .expect("rotation should succeed");

        let err = load_local_vault(LoadLocalVaultRequest {
            master_password: "old-pass".into(),
        })
        .expect_err("old password should fail");
        assert!(err.contains("invalid vault password"));

        let reloaded = load_local_vault(LoadLocalVaultRequest {
            master_password: "new-pass".into(),
        })
        .expect("new password should work");
        assert_eq!(reloaded.entries.len(), 1);
        assert_eq!(reloaded.known_hosts.len(), 1);

        let _ = fs::remove_file(&vault_path);
        env::remove_var("OZYTERMINAL_VAULT_PATH");
    }

    #[test]
    fn save_rejects_wrong_password_for_existing_vault() {
        let _guard = env_lock().lock().expect("lock env");
        let vault_path = test_vault_path("wrong-password");
        let _ = fs::remove_file(&vault_path);
        env::set_var("OZYTERMINAL_VAULT_PATH", &vault_path);

        save_local_vault(SaveLocalVaultRequest {
            master_password: "correct-pass".into(),
            entries: vec![sample_entry()],
            known_hosts: Some(vec![sample_known_host()]),
        })
        .expect("initial save should succeed");

        let err = save_local_vault(SaveLocalVaultRequest {
            master_password: "wrong-pass".into(),
            entries: vec![sample_entry()],
            known_hosts: None,
        })
        .expect_err("save should reject unknown password");
        assert!(err.contains("invalid vault password"));

        let _ = fs::remove_file(&vault_path);
        env::remove_var("OZYTERMINAL_VAULT_PATH");
    }
}
