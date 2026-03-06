use anyhow::Result;
use tokio::{io::AsyncWriteExt, net::TcpStream, time::{sleep, Duration}};

pub async fn run_reverse_connector(relay_addr: &str) -> Result<()> {
    loop {
        match TcpStream::connect(relay_addr).await {
            Ok(mut stream) => {
                let _ = stream.write_all(b"agent-node:hello\n").await;
                sleep(Duration::from_secs(15)).await;
            }
            Err(error) => {
                tracing::warn!(%error, relay = relay_addr, "relay unavailable, retrying");
                sleep(Duration::from_secs(5)).await;
            }
        }
    }
}
