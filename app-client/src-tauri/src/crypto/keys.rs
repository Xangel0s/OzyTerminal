use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;

pub fn generate_ed25519_key() -> SigningKey {
    SigningKey::generate(&mut OsRng)
}
