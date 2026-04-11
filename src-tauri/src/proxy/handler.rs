#![allow(unused_imports, unused_variables)]

use axum::body::Body;
use axum::extract::Request;
use axum::response::{IntoResponse, Response};

use super::forwarder::forward_request;
use super::server::HandlerState;

/// Catch-all proxy handler: reads body → matches route → forwards → returns response.
/// SSE streaming detection and passthrough is handled here.
pub async fn proxy_handler(
    axum::extract::State(state): axum::extract::State<HandlerState>,
    req: Request,
) -> Response {
    // Increment request counter
    state
        .request_counter
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    // Read the current route table
    let route_table = state.route_table.read().await;

    // TODO (task 1.7): implement full handler logic:
    //   1. Extract route_table, match request against routes
    //   2. Read body bytes
    //   3. Call forward_request with matched route + body
    //   4. Detect SSE response → stream passthrough
    //   5. Non-SSE → buffer and return

    // Placeholder: 502 Bad Gateway until handler is implemented
    drop(route_table);
    (
        axum::http::StatusCode::BAD_GATEWAY,
        "Proxy handler not yet implemented",
    )
        .into_response()
}
