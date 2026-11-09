use instarss_api::{router, AppState};
use std::{env, path::PathBuf, time::Duration};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter("instarss_api=info,tower_http=info")
        .init();
    let state = AppState::open(
        PathBuf::from(env::var("DATA_DIR").unwrap_or_else(|_| "./data".into())),
        env::var("APP_BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into()),
        env::var("ADMIN_PASSWORD").unwrap_or_default(),
        env::var("API_TOKEN")
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| env::var("SYNC_TOKEN").ok())
            .unwrap_or_default(),
    )
    .await?;
    let cleanup = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if let Err(error) = cleanup.cleanup().await {
                tracing::error!(?error, "Retention cleanup failed");
            }
        }
    });
    let port: u16 = env::var("PORT").unwrap_or_else(|_| "3000".into()).parse()?;
    let host: std::net::IpAddr = env::var("BIND_ADDRESS")
        .unwrap_or_else(|_| "0.0.0.0".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind((host, port)).await?;
    tracing::info!(port, "InstaRSS API listening");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
