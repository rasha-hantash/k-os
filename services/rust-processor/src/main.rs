use std::env;
use std::io::Write as IoWrite;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

// ── Types ──

#[derive(Clone)]
struct AppState {
    start_time: Instant,
    retained: Arc<Mutex<Vec<Vec<u8>>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HealthResponse {
    status: String,
    service: String,
    uptime_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ProcessResponse {
    status: String,
    input_size: usize,
    hash: String,
    compressed_size: usize,
    duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CrunchResponse {
    status: String,
    requested_mb: usize,
    total_retained_mb: usize,
    num_allocations: usize,
}

#[derive(Debug, Deserialize)]
struct CrunchParams {
    mb: Option<usize>,
    release: Option<bool>,
}

// ── Helpers ──

fn compute_hash(data: &[u8], iterations: usize) -> String {
    let mut hash_input = data.to_vec();
    for _ in 0..iterations {
        let mut hasher = Sha256::new();
        hasher.update(&hash_input);
        hash_input = hasher.finalize().to_vec();
    }
    hex_encode(&hash_input)
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn compress_data(data: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(data)?;
    encoder.finish()
}

// ── Handlers ──

async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
    let uptime = state.start_time.elapsed().as_secs();
    tracing::debug!(uptime_seconds = uptime, "health check");

    Json(HealthResponse {
        status: "ok".to_string(),
        service: "rust-processor".to_string(),
        uptime_seconds: uptime,
    })
}

async fn process_handler(
    State(_state): State<AppState>,
    body: axum::body::Bytes,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let start = Instant::now();
    let input_size = body.len();

    // Iterative SHA-256: hash the input 1000 times
    let final_hash = compute_hash(&body, 1000);

    // Gzip compress the original input
    let compressed = compress_data(&body).map_err(|e| {
        tracing::error!(error = %e, "compression failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("compression failed: {e}"),
        )
    })?;

    let duration_ms = start.elapsed().as_millis() as u64;

    tracing::info!(
        input_size = input_size,
        compressed_size = compressed.len(),
        duration_ms = duration_ms,
        "processed request"
    );

    Ok(Json(ProcessResponse {
        status: "ok".to_string(),
        input_size,
        hash: final_hash,
        compressed_size: compressed.len(),
        duration_ms,
    }))
}

async fn crunch_handler(
    State(state): State<AppState>,
    Query(params): Query<CrunchParams>,
) -> impl IntoResponse {
    let mb = params.mb.unwrap_or(10);
    let release = params.release.unwrap_or(false);

    let mut retained = state.retained.lock().unwrap();

    if release {
        let freed = retained.len();
        retained.clear();
        tracing::info!(freed_allocations = freed, "released all retained memory");

        return Json(CrunchResponse {
            status: "released".to_string(),
            requested_mb: 0,
            total_retained_mb: 0,
            num_allocations: 0,
        });
    }

    // Allocate a Vec<u8> of the requested size, filled with data
    let size_bytes = mb * 1024 * 1024;
    let allocation: Vec<u8> = (0..size_bytes).map(|i| (i % 256) as u8).collect();
    retained.push(allocation);

    let total_retained_mb: usize = retained.iter().map(|v| v.len()).sum::<usize>() / (1024 * 1024);
    let num_allocations = retained.len();

    tracing::info!(
        requested_mb = mb,
        total_retained_mb = total_retained_mb,
        num_allocations = num_allocations,
        "memory allocated"
    );

    Json(CrunchResponse {
        status: "ok".to_string(),
        requested_mb: mb,
        total_retained_mb,
        num_allocations,
    })
}

// ── Main ──

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install ctrl+c handler");
    };

    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    tokio::select! {
        _ = ctrl_c => { tracing::info!("received ctrl+c, shutting down"); }
        _ = terminate => { tracing::info!("received SIGTERM, shutting down"); }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_target(true)
        .with_level(true)
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse().unwrap()))
        .init();

    let state = AppState {
        start_time: Instant::now(),
        retained: Arc::new(Mutex::new(Vec::new())),
    };

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/process", post(process_handler))
        .route("/crunch", get(crunch_handler))
        .with_state(state);

    let port = env::var("PORT").unwrap_or_else(|_| "8081".to_string());
    let addr = format!("0.0.0.0:{port}");

    let listener = TcpListener::bind(&addr)
        .await
        .expect("failed to bind listener");

    tracing::info!(address = %addr, "listening on");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}
