use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use anyhow::anyhow;
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;

pub const DEFAULT_ARGON2_MEMORY_KIB: u32 = 64 * 1024;
pub const DEFAULT_ARGON2_ITERATIONS: u32 = 3;
pub const DEFAULT_ARGON2_PARALLELISM: u32 = 1;
pub const DEFAULT_MASTER_KEY_LEN: usize = 32;

#[derive(Clone, Copy, Debug)]
pub struct KdfConfig {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub output_len: usize,
}

impl Default for KdfConfig {
    fn default() -> Self {
        Self {
            memory_kib: DEFAULT_ARGON2_MEMORY_KIB,
            iterations: DEFAULT_ARGON2_ITERATIONS,
            parallelism: DEFAULT_ARGON2_PARALLELISM,
            output_len: DEFAULT_MASTER_KEY_LEN,
        }
    }
}

pub fn derive_master_key(password: &[u8], salt: &[u8]) -> anyhow::Result<[u8; 32]> {
    derive_master_key_with_config(password, salt, KdfConfig::default())
}

pub fn derive_master_key_with_config(
    password: &[u8],
    salt: &[u8],
    config: KdfConfig,
) -> anyhow::Result<[u8; 32]> {
    let params = Params::new(
        config.memory_kib,
        config.iterations,
        config.parallelism,
        Some(config.output_len),
    )?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2.hash_password_into(password, salt, &mut key)?;
    Ok(key)
}

pub fn encrypt_secret_bytes(
    master_key: &[u8; 32],
    dek: &[u8; 32],
    dek_nonce: &[u8; 12],
    secret_nonce: &[u8; 12],
    aad: &[u8],
    plaintext: &[u8],
) -> anyhow::Result<(Vec<u8>, Vec<u8>)> {
    let dek_cipher = Aes256Gcm::new_from_slice(master_key)?;
    let wrapped_dek = dek_cipher
        .encrypt(Nonce::from_slice(dek_nonce), Payload { msg: dek, aad })
        .map_err(|_| anyhow!("failed to wrap data encryption key"))?;

    let secret_cipher = Aes256Gcm::new_from_slice(dek)?;
    let ciphertext = secret_cipher
        .encrypt(
            Nonce::from_slice(secret_nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| anyhow!("failed to encrypt secret payload"))?;

    Ok((wrapped_dek, ciphertext))
}

pub fn decrypt_secret_bytes(
    master_key: &[u8; 32],
    wrapped_dek: &[u8],
    dek_nonce: &[u8; 12],
    ciphertext: &[u8],
    secret_nonce: &[u8; 12],
    aad: &[u8],
) -> anyhow::Result<Vec<u8>> {
    let dek_cipher = Aes256Gcm::new_from_slice(master_key)?;
    let dek = dek_cipher
        .decrypt(
            Nonce::from_slice(dek_nonce),
            Payload {
                msg: wrapped_dek,
                aad,
            },
        )
        .map_err(|_| anyhow!("failed to unwrap data encryption key"))?;

    let secret_cipher = Aes256Gcm::new_from_slice(&dek)?;
    let plaintext = secret_cipher
        .decrypt(
            Nonce::from_slice(secret_nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| anyhow!("failed to decrypt secret payload"))?;

    Ok(plaintext)
}

pub fn random_array<const N: usize>() -> [u8; N] {
    let mut output = [0u8; N];
    rand::thread_rng().fill_bytes(&mut output);
    output
}
