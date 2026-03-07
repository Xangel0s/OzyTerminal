use anyhow::{anyhow, Result};
use tokio::{io::AsyncWriteExt, net::TcpStream};

use crate::core::ssh_client::RelayHint;

pub async fn connect_via_relay(relay: &RelayHint) -> Result<TcpStream> {
    if relay.relay_url.is_empty() {
        return Err(anyhow!("relay_url is required"));
    }
    if relay.token.is_empty() {
        return Err(anyhow!("relay token is required"));
    }
    if relay.target_node_id.is_empty() {
        return Err(anyhow!("relay target_node_id is required"));
    }

    let mut stream = TcpStream::connect(&relay.relay_url).await?;
    let hello = serde_json::json!({
        "type": "client_hello",
        "leaseToken": relay.token,
        "targetNodeId": relay.target_node_id,
    });
    stream.write_all(format!("{hello}\n").as_bytes()).await?;
    Ok(stream)
}
