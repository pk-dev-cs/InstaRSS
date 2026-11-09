use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use instarss_api::{router, AppState};
use serde_json::{json, Value};
use tower::ServiceExt;

fn request(method: &str, path: &str, body: Value, token: Option<&str>) -> Request<Body> {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(token) = token {
        req = req.header("authorization", format!("Bearer {token}"));
    }
    req.body(Body::from(body.to_string())).unwrap()
}

#[tokio::test]
async fn pairing_ingestion_public_rss_and_retention() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(
        dir.path().into(),
        "https://feeds.example".into(),
        "admin-secret".into(),
        "maintenance-token".into(),
    )
    .await
    .unwrap();
    let app = router(state.clone());
    assert_eq!(
        app.clone()
            .oneshot(request("GET", "/api/profiles", json!(null), None))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let paired = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/devices")
                .header(
                    "authorization",
                    format!("Basic {}", STANDARD.encode("admin:admin-secret")),
                )
                .header("content-type", "application/json")
                .body(Body::from(json!({"label":"Test desktop"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(paired.status(), StatusCode::OK);
    let paired: Value =
        serde_json::from_slice(&to_bytes(paired.into_body(), 1024 * 1024).await.unwrap()).unwrap();
    let token = paired["token"].as_str().unwrap();
    assert_eq!(
        app.clone()
            .oneshot(request(
                "POST",
                "/api/profiles",
                json!({"username":"example"}),
                Some(token)
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CREATED
    );
    let post = json!({"id":"post-1","caption":"A & B <script>","permalink":"https://www.instagram.com/p/post-1/","publishedAt":chrono::Utc::now().timestamp_millis(),"images":[{"mimeType":"image/png","dataBase64":STANDARD.encode(b"\x89PNG\r\n\x1a\nfixture")} ]});
    assert_eq!(
        app.clone()
            .oneshot(request(
                "POST",
                "/api/profiles/example/posts",
                post.clone(),
                Some(token)
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let duplicate = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/profiles/example/posts",
            post,
            Some(token),
        ))
        .await
        .unwrap();
    let result: Value =
        serde_json::from_slice(&to_bytes(duplicate.into_body(), 1024).await.unwrap()).unwrap();
    assert_eq!(result["reason"], "duplicate");
    let rss = app
        .clone()
        .oneshot(request("GET", "/rss/example.xml", json!(null), None))
        .await
        .unwrap();
    assert_eq!(rss.status(), StatusCode::OK);
    let xml = String::from_utf8(
        to_bytes(rss.into_body(), 1024 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(xml.contains("<title>InstaRSS @example</title>"));
    assert!(xml.contains("A &amp; B &lt;script&gt;"));
    assert!(xml.contains("https://feeds.example/media/1"));
    assert!(xml.contains("<enclosure "));
    assert_eq!(
        app.clone()
            .oneshot(request("GET", "/media/1", json!(null), None))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    sqlx::query("UPDATE posts SET published_at=1")
        .execute(&state.pool)
        .await
        .unwrap();
    assert_eq!(
        app.clone()
            .oneshot(request("GET", "/media/1", json!(null), None))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(state.cleanup().await.unwrap(), 1);
    assert_eq!(std::fs::read_dir(&state.media).unwrap().count(), 0);
    drop(app);
    state.pool.close().await;
    let reopened = AppState::open(
        dir.path().into(),
        "https://feeds.example".into(),
        "admin-secret".into(),
        "".into(),
    )
    .await
    .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
        .fetch_one(&reopened.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    reopened.pool.close().await;
}

#[tokio::test]
async fn legacy_database_is_preserved() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(
        dir.path().into(),
        "https://feeds.example".into(),
        "".into(),
        "token".into(),
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO profiles(username) VALUES('legacy')")
        .execute(&state.pool)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE posts RENAME COLUMN source_post_id TO instagram_id")
        .execute(&state.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO posts(profile_id,instagram_id,permalink,caption,published_at,source) VALUES(1,'legacy','https://example.com','Existing',1,'browser')").execute(&state.pool).await.unwrap();
    state.pool.close().await;
    let reopened = AppState::open(
        dir.path().into(),
        "https://feeds.example".into(),
        "".into(),
        "token".into(),
    )
    .await
    .unwrap();
    let id: String = sqlx::query_scalar("SELECT source_post_id FROM posts")
        .fetch_one(&reopened.pool)
        .await
        .unwrap();
    assert_eq!(id, "legacy");
    reopened.pool.close().await;
}
