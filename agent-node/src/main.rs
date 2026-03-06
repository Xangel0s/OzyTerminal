mod health;
mod reverse_ssh;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    health::emit_startup();
    reverse_ssh::run_reverse_connector("127.0.0.1:9443").await
}
