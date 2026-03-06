use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;

pub fn encode_chunk(chunk: Bytes) -> String {
    STANDARD.encode(chunk)
}
