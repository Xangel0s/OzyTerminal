use std::{fs, path::PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::core::ssh_client::RelayHint;
use crate::crypto::envelope::{
    decrypt_secret_bytes, derive_master_key, encrypt_secret_bytes, random_array,
};

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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocalVaultRequest {
    pub master_password: String,
    pub entries: Vec<VaultEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadLocalVaultRequest {
    pub master_password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalVaultResponse {
    pub entries: Vec<VaultEntry>,
    pub updated_at: u64,
    pub vault_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVaultFile {
    version: u32,
    updated_at: u64,
    salt_b64: String,
    dek_nonce_b64: String,
    secret_nonce_b64: String,
    wrapped_dek_b64: String,
    ciphertext_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVaultPayload {
    entries: Vec<VaultEntry>,
}

#[tauri::command]
pub fn encrypt_secret(request: EncryptSecretRequest) -> Result<EncryptSecretResponse, String> {
    let salt = random_array::<16>();
    let dek = random_array::<32>();
    let dek_nonce = random_array::<12>();
    let secret_nonce = random_array::<12>();
    let master_key = derive_master_key(request.master_password.as_bytes(), &salt).map_err(|err| err.to_string())?;
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
    let updated_at = unix_timestamp()?;
    let payload = LocalVaultPayload {
        entries: request.entries,
    };
    let payload_json = serde_json::to_vec(&payload).map_err(|err| err.to_string())?;

    let salt = random_array::<16>();
    let dek = random_array::<32>();
    let dek_nonce = random_array::<12>();
    let secret_nonce = random_array::<12>();
    let aad = b"ozyterminal.local-vault.v1";
    let master_key = derive_master_key(request.master_password.as_bytes(), &salt).map_err(|err| err.to_string())?;
    let (wrapped_dek, ciphertext) = encrypt_secret_bytes(
        &master_key,
        &dek,
        &dek_nonce,
        &secret_nonce,
        aad,
        &payload_json,
    )
    .map_err(|err| err.to_string())?;

    let vault_file = LocalVaultFile {
        version: 1,
        updated_at,
        salt_b64: STANDARD.encode(salt),
        dek_nonce_b64: STANDARD.encode(dek_nonce),
        secret_nonce_b64: STANDARD.encode(secret_nonce),
        wrapped_dek_b64: STANDARD.encode(wrapped_dek),
        ciphertext_b64: STANDARD.encode(ciphertext),
    };

    let vault_path = local_vault_path()?;
    if let Some(parent) = vault_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }

    let serialized = serde_json::to_vec_pretty(&vault_file).map_err(|err| err.to_string())?;
    fs::write(&vault_path, serialized).map_err(|err| err.to_string())?;

    Ok(LocalVaultResponse {
        entries: payload.entries,
        updated_at,
        vault_path: vault_path.display().to_string(),
    })
}

#[tauri::command]
pub fn load_local_vault(request: LoadLocalVaultRequest) -> Result<LocalVaultResponse, String> {
    let vault_path = local_vault_path()?;
    let file_bytes = fs::read(&vault_path).map_err(|err| err.to_string())?;
    let vault_file: LocalVaultFile = serde_json::from_slice(&file_bytes).map_err(|err| err.to_string())?;

    if vault_file.version != 1 {
        return Err(format!("unsupported vault version {}", vault_file.version));
    }

    let salt = decode_array::<16>(&vault_file.salt_b64)?;
    let dek_nonce = decode_array::<12>(&vault_file.dek_nonce_b64)?;
    let secret_nonce = decode_array::<12>(&vault_file.secret_nonce_b64)?;
    let wrapped_dek = STANDARD.decode(vault_file.wrapped_dek_b64).map_err(|err| err.to_string())?;
    let ciphertext = STANDARD.decode(vault_file.ciphertext_b64).map_err(|err| err.to_string())?;
    let aad = b"ozyterminal.local-vault.v1";
    let master_key = derive_master_key(request.master_password.as_bytes(), &salt).map_err(|err| err.to_string())?;
    let plaintext = decrypt_secret_bytes(
        &master_key,
        &wrapped_dek,
        &dek_nonce,
        &ciphertext,
        &secret_nonce,
        aad,
    )
    .map_err(|_| "invalid vault password or corrupted vault".to_string())?;
    let payload: LocalVaultPayload = serde_json::from_slice(&plaintext).map_err(|err| err.to_string())?;

    Ok(LocalVaultResponse {
        entries: payload.entries,
        updated_at: vault_file.updated_at,
        vault_path: vault_path.display().to_string(),
    })
}

fn decode_array<const N: usize>(value: &str) -> Result<[u8; N], String> {
    let bytes = STANDARD.decode(value).map_err(|err| err.to_string())?;
    bytes
        .try_into()
        .map_err(|_| format!("expected {N} decoded bytes"))
}

fn local_vault_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "unable to resolve home directory".to_string())?;
    Ok(PathBuf::from(base).join(".ozyterminal").join("vault.local.json"))
}

fn unix_timestamp() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|err| err.to_string())
}
