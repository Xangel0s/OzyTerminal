mod health;
mod reverse_ssh;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    let config = reverse_ssh::AgentConnectorConfig::from_env()?;
    health::emit_startup();
    reverse_ssh::run_reverse_connector(config).await
}
