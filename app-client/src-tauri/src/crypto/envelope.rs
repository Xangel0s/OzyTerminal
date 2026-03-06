use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;

pub fn derive_master_key(password: &[u8], salt: &[u8]) -> anyhow::Result<[u8; 32]> {
    let params = Params::new(64 * 1024, 3, 1, Some(32))?;
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
    let wrapped_dek = dek_cipher.encrypt(Nonce::from_slice(dek_nonce), Payload { msg: dek, aad })?;

    let secret_cipher = Aes256Gcm::new_from_slice(dek)?;
    let ciphertext = secret_cipher.encrypt(Nonce::from_slice(secret_nonce), Payload { msg: plaintext, aad })?;

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
    let dek = dek_cipher.decrypt(Nonce::from_slice(dek_nonce), Payload { msg: wrapped_dek, aad })?;

    let secret_cipher = Aes256Gcm::new_from_slice(&dek)?;
    let plaintext = secret_cipher.decrypt(Nonce::from_slice(secret_nonce), Payload { msg: ciphertext, aad })?;

    Ok(plaintext)
}

pub fn random_array<const N: usize>() -> [u8; N] {
    let mut output = [0u8; N];
    rand::thread_rng().fill_bytes(&mut output);
    output
}
