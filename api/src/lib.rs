use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    FromRow, SqlitePool,
};
use std::{path::PathBuf, time::Duration};
use subtle::ConstantTimeEq;
use uuid::Uuid;

const RETENTION: i64 = 30 * 24 * 60 * 60 * 1000;
fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn cutoff() -> i64 {
    now() - RETENTION
}
fn hash(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}
fn equal(a: &str, b: &str) -> bool {
    !a.is_empty() && bool::from(hash(a).as_bytes().ct_eq(hash(b).as_bytes()))
}

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub media: PathBuf,
    pub base_url: String,
    admin_password: String,
    api_token: String,
}

#[derive(Debug)]
pub struct ApiError(StatusCode, String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error":self.1}))).into_response()
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!(error=%e, "Database operation failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Database operation failed".into(),
        )
    }
}
impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        tracing::error!(error=%e,"File operation failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "File operation failed".into(),
        )
    }
}
type Result<T> = std::result::Result<T, ApiError>;
fn bad(message: &str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}
fn missing() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "Not found".into())
}

impl AppState {
    pub async fn open(
        directory: PathBuf,
        base_url: String,
        admin_password: String,
        api_token: String,
    ) -> std::result::Result<Self, Box<dyn std::error::Error>> {
        let base = url::Url::parse(&base_url)?;
        if !matches!(base.scheme(), "http" | "https") || base.host_str().is_none() {
            return Err("Invalid APP_BASE_URL".into());
        }
        tokio::fs::create_dir_all(directory.join("media")).await?;
        let options = SqliteConnectOptions::new()
            .filename(directory.join("feed.sqlite"))
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true)
            .busy_timeout(Duration::from_secs(10));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        let mut tx = pool.begin().await?;
        sqlx::raw_sql("CREATE TABLE IF NOT EXISTS profiles(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,last_checked_at INTEGER,last_success_at INTEGER,last_source TEXT,last_error TEXT);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,source_post_id TEXT NOT NULL,permalink TEXT NOT NULL,caption TEXT NOT NULL DEFAULT '',published_at INTEGER NOT NULL,source TEXT NOT NULL,UNIQUE(profile_id,source_post_id));
CREATE TABLE IF NOT EXISTS images(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,filename TEXT NOT NULL,mime_type TEXT NOT NULL,byte_length INTEGER NOT NULL,position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS device_tokens(id TEXT PRIMARY KEY,label TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS posts_profile_published ON posts(profile_id,published_at DESC);
CREATE INDEX IF NOT EXISTS images_post ON images(post_id);").execute(&mut *tx).await?;
        let columns: Vec<(i64, String, String, i64, Option<String>, i64)> =
            sqlx::query_as("PRAGMA table_info(posts)")
                .fetch_all(&mut *tx)
                .await?;
        if columns.iter().any(|c| c.1 == "instagram_id") {
            sqlx::query("ALTER TABLE posts RENAME COLUMN instagram_id TO source_post_id")
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(Self {
            pool,
            media: directory.join("media"),
            base_url: base_url.trim_end_matches('/').into(),
            admin_password,
            api_token,
        })
    }
    pub async fn cleanup(&self) -> Result<u64> {
        let expired: Vec<(i64,)> = sqlx::query_as("SELECT id FROM posts WHERE published_at < ?")
            .bind(cutoff())
            .fetch_all(&self.pool)
            .await?;
        let mut removed = 0;
        for (id,) in expired {
            let files: Vec<(String,)> =
                sqlx::query_as("SELECT filename FROM images WHERE post_id=?")
                    .bind(id)
                    .fetch_all(&self.pool)
                    .await?;
            for (file,) in files {
                match tokio::fs::remove_file(self.media.join(file)).await {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.into()),
                }
            }
            removed += sqlx::query("DELETE FROM posts WHERE id=?")
                .bind(id)
                .execute(&self.pool)
                .await?
                .rows_affected();
        }
        Ok(removed)
    }
}

pub fn router(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/profiles", get(list_profiles).post(add_profile))
        .route("/api/profiles/{username}", delete(remove_profile))
        .route("/api/profiles/{username}/posts", post(ingest))
        .route("/api/profiles/{username}/status", post(sync_status))
        .route("/api/cleanup", post(cleanup))
        .route("/api/sync", post(cleanup))
        .route("/api/devices/{id}", delete(revoke_device))
        .route_layer(middleware::from_fn_with_state(state.clone(), authorize));
    Router::new().merge(protected)
        .route("/",get(|| async { Html("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>InstaRSS</title><body style=\"background:#0c1012;color:#e6ebe7;font-family:monospace;padding:4rem\"><h1>[ InstaRSS ]</h1><p>Public RSS feeds, synchronized by your desktop.</p><a style=\"color:#a8c8da\" href=\"https://github.com/pk-dev-cs/InstaRSS/releases/latest\">Download InstaRSS for Windows</a></body></html>") }))
        .route("/api/health",get(health)).route("/api/devices",post(pair_device))
        .route("/rss/{feed}",get(rss)).route("/media/{id}",get(media))
        .layer(DefaultBodyLimit::max(30*1024*1024))
        .layer(tower_http::trace::TraceLayer::new_for_http()).with_state(state)
}

async fn authorize(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Result<Response> {
    let token = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or("");
    if token.is_empty() {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "A device token is required".into(),
        ));
    }
    let configured = equal(&state.api_token, token);
    let device =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM device_tokens WHERE token_hash=?")
            .bind(hash(token))
            .fetch_one(&state.pool)
            .await?;
    if !configured && device == 0 {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid device token".into(),
        ));
    }
    Ok(next.run(request).await)
}

async fn health(State(state): State<AppState>) -> Result<Json<serde_json::Value>> {
    sqlx::query("SELECT 1").execute(&state.pool).await?;
    Ok(Json(
        serde_json::json!({"status":"ok","application":"InstaRSS","version":env!("CARGO_PKG_VERSION")}),
    ))
}
#[derive(Deserialize)]
struct DeviceInput {
    label: String,
}
async fn pair_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<DeviceInput>,
) -> Result<Json<serde_json::Value>> {
    if state.admin_password.is_empty() {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "Set ADMIN_PASSWORD to enable device pairing".into(),
        ));
    }
    let encoded = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
        .unwrap_or("");
    let decoded = STANDARD
        .decode(encoded)
        .ok()
        .and_then(|v| String::from_utf8(v).ok())
        .unwrap_or_default();
    let (user, password) = decoded.split_once(':').unwrap_or(("", ""));
    if user != "admin" || !equal(&state.admin_password, password) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid administrator credentials".into(),
        ));
    }
    let label = input.label.trim();
    if label.is_empty() || label.len() > 80 {
        return Err(bad("Device name must contain 1 to 80 characters"));
    }
    let id = Uuid::new_v4().to_string();
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    sqlx::query("INSERT INTO device_tokens(id,label,token_hash,created_at) VALUES(?,?,?,?)")
        .bind(&id)
        .bind(label)
        .bind(hash(&token))
        .bind(now())
        .execute(&state.pool)
        .await?;
    Ok(Json(serde_json::json!({"id":id,"token":token})))
}
async fn revoke_device(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    sqlx::query("DELETE FROM device_tokens WHERE id=?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

fn username(value: &str) -> Result<String> {
    let s = value.trim().trim_start_matches('@').to_ascii_lowercase();
    if s.is_empty()
        || s.len() > 30
        || !s
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_')
    {
        Err(bad("Invalid profile username"))
    } else {
        Ok(s)
    }
}
#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: i64,
    username: String,
    last_checked_at: Option<i64>,
    last_success_at: Option<i64>,
    last_source: Option<String>,
    last_error: Option<String>,
    post_count: i64,
}
async fn list_profiles(State(state): State<AppState>) -> Result<Json<Vec<Profile>>> {
    Ok(Json(sqlx::query_as("SELECT p.*, (SELECT COUNT(*) FROM posts WHERE profile_id=p.id AND published_at>=?) AS post_count FROM profiles p ORDER BY p.id DESC").bind(cutoff()).fetch_all(&state.pool).await?))
}
#[derive(Deserialize)]
struct ProfileInput {
    username: String,
}
async fn add_profile(
    State(state): State<AppState>,
    Json(input): Json<ProfileInput>,
) -> Result<StatusCode> {
    let name = username(&input.username)?;
    sqlx::query("INSERT INTO profiles(username) VALUES(?) ON CONFLICT(username) DO NOTHING")
        .bind(name)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::CREATED)
}
async fn profile_id(state: &AppState, name: &str) -> Result<i64> {
    sqlx::query_scalar("SELECT id FROM profiles WHERE username=?")
        .bind(name)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(missing)
}
async fn remove_profile(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<StatusCode> {
    let id = profile_id(&state, &username(&name)?).await?;
    let files: Vec<(String,)> = sqlx::query_as(
        "SELECT filename FROM images JOIN posts ON posts.id=images.post_id WHERE profile_id=?",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;
    for (file,) in files {
        match tokio::fs::remove_file(state.media.join(file)).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    sqlx::query("DELETE FROM profiles WHERE id=?")
        .bind(id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusInput {
    error: Option<String>,
}
async fn sync_status(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(input): Json<StatusInput>,
) -> Result<StatusCode> {
    let id = profile_id(&state, &username(&name)?).await?;
    let time = now();
    let error = input.error.map(|e| e.chars().take(500).collect::<String>());
    sqlx::query("UPDATE profiles SET last_checked_at=?,last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,last_source='desktop',last_error=? WHERE id=?").bind(time).bind(&error).bind(time).bind(&error).bind(id).execute(&state.pool).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageInput {
    mime_type: String,
    data_base64: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostInput {
    id: String,
    caption: String,
    permalink: String,
    published_at: i64,
    images: Vec<ImageInput>,
}

async fn ingest(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(input): Json<PostInput>,
) -> Result<Json<serde_json::Value>> {
    let pid = profile_id(&state, &username(&name)?).await?;
    if input.published_at < cutoff() {
        return Ok(Json(serde_json::json!({"stored":false,"reason":"expired"})));
    }
    if input.published_at > now() + 300_000
        || input.id.is_empty()
        || input.id.len() > 100
        || input.caption.len() > 50_000
    {
        return Err(bad("Invalid post metadata"));
    }
    let mut link = url::Url::parse(&input.permalink).map_err(|_| bad("Invalid post URL"))?;
    if link.scheme() != "https"
        || !matches!(link.host_str(), Some("www.instagram.com" | "instagram.com"))
    {
        return Err(bad("Invalid post URL"));
    }
    link.set_query(None);
    link.set_fragment(None);
    if input.images.is_empty() || input.images.len() > 10 {
        return Err(bad("A post must include 1 to 10 images"));
    }
    let mut decoded = Vec::new();
    let mut total = 0;
    for image in input.images {
        let bytes = STANDARD
            .decode(&image.data_base64)
            .map_err(|_| bad("Invalid image encoding"))?;
        total += bytes.len();
        if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 || total > 20 * 1024 * 1024 {
            return Err(bad("Image size limit exceeded"));
        }
        let extension = match image.mime_type.as_str() {
            "image/jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => "jpg",
            "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
            "image/webp" if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") => {
                "webp"
            }
            _ => return Err(bad("Unsupported image data")),
        };
        decoded.push((
            format!("{}.{}", Uuid::new_v4(), extension),
            image.mime_type,
            bytes,
        ));
    }
    let mut tx = state.pool.begin().await?;
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM posts WHERE profile_id=? AND (source_post_id=? OR permalink=?)",
    )
    .bind(pid)
    .bind(&input.id)
    .bind(link.as_str())
    .fetch_optional(&mut *tx)
    .await?;
    if existing.is_some() {
        return Ok(Json(
            serde_json::json!({"stored":false,"reason":"duplicate"}),
        ));
    }
    let inserted=sqlx::query("INSERT INTO posts(profile_id,source_post_id,permalink,caption,published_at,source) VALUES(?,?,?,?,?,'desktop')").bind(pid).bind(&input.id).bind(link.as_str()).bind(&input.caption).bind(input.published_at).execute(&mut *tx).await?;
    let post_id = inserted.last_insert_rowid();
    let result:Result<()>=async{
        for (position,(filename,mime,bytes)) in decoded.iter().enumerate(){
            tokio::fs::write(state.media.join(filename),bytes).await?;
            sqlx::query("INSERT INTO images(post_id,filename,mime_type,byte_length,position) VALUES(?,?,?,?,?)").bind(post_id).bind(filename).bind(mime).bind(bytes.len() as i64).bind(position as i64).execute(&mut *tx).await?;
        }
        tx.commit().await?;Ok(())
    }.await;
    if let Err(error) = result {
        for (filename, _, _) in decoded {
            let _ = tokio::fs::remove_file(state.media.join(filename)).await;
        }
        return Err(error);
    }
    Ok(Json(serde_json::json!({"stored":true})))
}
async fn cleanup(State(state): State<AppState>) -> Result<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({"ok":true,"removed":state.cleanup().await?}),
    ))
}

#[derive(FromRow)]
struct StoredPost {
    id: i64,
    source_post_id: String,
    caption: String,
    permalink: String,
    published_at: i64,
}
#[derive(FromRow)]
struct StoredImage {
    id: i64,
    mime_type: String,
    byte_length: i64,
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
async fn rss(State(state): State<AppState>, Path(feed): Path<String>) -> Result<Response> {
    let name = username(feed.strip_suffix(".xml").ok_or_else(missing)?)?;
    let pid = profile_id(&state, &name).await?;
    let posts:Vec<StoredPost>=sqlx::query_as("SELECT id,source_post_id,caption,permalink,published_at FROM posts WHERE profile_id=? AND published_at>=? ORDER BY published_at DESC").bind(pid).bind(cutoff()).fetch_all(&state.pool).await?;
    let mut body=format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss version=\"2.0\" xmlns:media=\"http://search.yahoo.com/mrss/\"><channel><title>InstaRSS @{}</title><link>https://www.instagram.com/{}/</link><description>Public posts from the last 30 days</description><language>en</language>",xml(&name),xml(&name));
    for post in posts {
        let images:Vec<StoredImage>=sqlx::query_as("SELECT id,filename,mime_type,byte_length FROM images WHERE post_id=? ORDER BY position").bind(post.id).fetch_all(&state.pool).await?;
        if images.is_empty() {
            continue;
        }
        let title = if post.caption.is_empty() {
            format!("Post @{}", name)
        } else {
            post.caption.chars().take(100).collect()
        };
        let date = chrono::DateTime::from_timestamp_millis(post.published_at)
            .ok_or_else(|| bad("Invalid publication date"))?
            .to_rfc2822();
        let mut content = format!("<p>{}</p>", xml(&post.caption).replace('\n', "<br>"));
        for image in &images {
            content.push_str(&format!(
                "<p><img src=\"{}/media/{}\" alt=\"Photo from a shared post\"></p>",
                xml(&state.base_url),
                image.id
            ));
        }
        body.push_str(&format!("<item><title>{}</title><link>{}</link><guid isPermaLink=\"false\">instarss:{}:{}</guid><pubDate>{}</pubDate><description>{}</description>",xml(&title),xml(&post.permalink),xml(&name),xml(&post.source_post_id),xml(&date),xml(&content)));
        for (i, image) in images.iter().enumerate() {
            let url = format!("{}/media/{}", state.base_url, image.id);
            if i == 0 {
                body.push_str(&format!(
                    "<enclosure url=\"{}\" length=\"{}\" type=\"{}\"/>",
                    xml(&url),
                    image.byte_length,
                    xml(&image.mime_type)
                ));
            }
            body.push_str(&format!(
                "<media:content url=\"{}\" type=\"{}\" medium=\"image\" fileSize=\"{}\"/>",
                xml(&url),
                xml(&image.mime_type),
                image.byte_length
            ));
        }
        body.push_str("</item>");
    }
    body.push_str("</channel></rss>");
    Ok((
        [
            (header::CONTENT_TYPE, "application/rss+xml; charset=utf-8"),
            (header::CACHE_CONTROL, "no-cache"),
        ],
        body,
    )
        .into_response())
}
async fn media(State(state): State<AppState>, Path(id): Path<i64>) -> Result<Response> {
    let row:Option<(String,String,i64)>=sqlx::query_as("SELECT images.filename,images.mime_type,posts.published_at FROM images JOIN posts ON posts.id=images.post_id WHERE images.id=? AND posts.published_at>=?").bind(id).bind(cutoff()).fetch_optional(&state.pool).await?;
    let (filename, mime, published) = row.ok_or_else(missing)?;
    let bytes = tokio::fs::read(state.media.join(filename))
        .await
        .map_err(|_| missing())?;
    let ttl = ((published + RETENTION - now()) / 1000).clamp(0, 3600);
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, format!("public, max-age={ttl}"))
        .body(Body::from(bytes))
        .map_err(|_| bad("Invalid image response"))
}
