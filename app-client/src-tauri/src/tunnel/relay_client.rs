use anyhow::{anyhow, Result};
use tokio::net::TcpStream;

use crate::core::ssh_client::RelayHint;

pub async fn connect_via_relay(relay: &RelayHint) -> Result<TcpStream> {
    if relay.relay_url.is_empty() {
        return Err(anyhow!("relay_url is required"));
    }

    TcpStream::connect(&relay.relay_url).await.map_err(Into::into)
}
