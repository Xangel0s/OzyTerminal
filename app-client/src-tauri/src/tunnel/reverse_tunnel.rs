use anyhow::Result;
use russh::client;

use crate::core::ssh_client::OzyClient;

pub async fn request_remote_forward(
    session: &mut client::Handle<OzyClient>,
    address: &str,
    port: u32,
) -> Result<u32> {
    let allocated_port = session.tcpip_forward(address.to_string(), port).await?;
    Ok(allocated_port)
}
