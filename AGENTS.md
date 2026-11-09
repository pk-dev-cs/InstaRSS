# Contributing workflow

## Project context

- The official project name is InstaRSS (npm package: `instarss`). This application turns public photo-sharing profiles into RSS feeds with locally stored images.
- New architecture: Electron + React/TypeScript in `desktop/`, Rust + Axum/SQLx in `api/`, and SQLite with image files on the API's persistent volume.
- Electron fetches public pages locally and uploads posts and images to the Rust API. The API serves RSS and images and handles retention; it must not scrape from the hosting server.
- Keep the user interface, accessibility labels, metadata, and application-generated messages in English. Preserve the original language of fetched posts.
- Use InstaRSS for project branding and neutral photo-sharing terminology for descriptions. Do not use the provider's full name in UI text or documentation; retain it only where technically required, such as domain names and compatibility migrations.

## Repository structure

- `desktop/src/`: Electron main process, isolated preload bridge, local fetching, preferences, updates, and React renderer.
- `desktop/tests/`: unit tests and the actual Electron-to-Rust integration test.
- `desktop/package.json`: independent desktop dependencies and build commands.
- `api/src/`: Rust HTTP API, authentication, SQLite persistence, RSS, media, and cleanup.
- `api/tests/`: API and legacy database compatibility checks.
- `api/Dockerfile`: Rust deployment image, built with the repository root as context.
- `.github/workflows/`: checks and version-tag-driven Windows installer releases.
- `scripts/run-local-api.ps1`: local Rust API startup helper for Windows.
- `docs/images/`: application screenshots used by the README.
- `data/`: runtime SQLite files and images; never commit this directory.

## Branches

- If a Git repository is available, inspect its status and current branch before changing files.
- Do not implement or publish changes directly on `main`. Create a session branch from the current local `main` before starting work, while preserving unrelated local changes.
- Name session branches `Session-DD-MM-YY`, using the user's local date. Reuse the current session branch when appropriate; add a suffix if a new branch would otherwise collide.
- Keep session branches after merging.
- If the workspace has no Git repository, continue authorized file changes and report that Git operations are unavailable. Do not initialize a repository or add a remote unless requested.

## Commits and publishing

- Split work into small, logical commits, each covering one coherent concern.
- Use short English commit subjects in lowercase, such as `add public rss links` or `fix image retention cleanup`.
- Do not mix unrelated formatting or cleanup with a functional change.
- Commit or merge only when requested by the user. Before publishing, run the checks appropriate to the change and review the diff.
- When asked to publish locally, commit on the session branch and merge into local `main` with `--no-ff`. Do not squash or fast-forward session branches.
- Always title merge commits `MERGE N: Description`, with a short English description (for example, `MERGE 1: Add desktop synchronization`).
- Determine `N` from the highest existing `MERGE N:` number in the repository's merge history and increment it by one. If no numbered merge exists, start at `MERGE 1:`. Older unnumbered merges do not count toward this sequence.
- After merging, verify the branch and merge commit, and report any remaining working-tree changes.
- Do not push to a remote or deploy to Railway unless explicitly requested. Publishing locally does not authorize either action.

## Verification

- Install dependencies with `npm ci` when setting up from the committed lockfile. Use `npm install` when intentionally changing dependencies and include the updated `package-lock.json`.
- For desktop changes, run `npm --prefix desktop run check`, `npm --prefix desktop test`, and `npm --prefix desktop run build`.
- For API changes, run `cargo fmt --manifest-path api/Cargo.toml -- --check` and `cargo test --manifest-path api/Cargo.toml --locked`.
- For changes across the desktop/API boundary, build the API with `cargo build --manifest-path api/Cargo.toml --locked`, then run `npm --prefix desktop run test:e2e`.
- For packaging or updates, produce a Windows x64 package and Velopack installer. Keep the npm Velopack and CLI versions aligned. Do not claim end-to-end auto-updates work until an installed application has updated between released versions.
- For layout or interaction changes, inspect desktop and mobile views, including long usernames and copy-URL feedback when relevant.
- For documentation-only changes, verify paths, commands, and the diff; an application build is not required.
- Run `git diff --check` before committing or merging when Git is available. Fix errors and warnings introduced by the change.
- Keep checks isolated from real user data. Do not run destructive cleanup against the user's database as a test.
- Do not require live provider access for routine checks. Clearly distinguish fixture tests from live fetching tests and report any integration path that was not verified.

## Data and synchronization rules

- Retain posts and their images for 30 days from the post's publication timestamp, not its import time.
- Do not import older posts. Exclude expired posts from RSS and stop serving their images even if physical cleanup has not yet run.
- Cleanup must remove image files and their database records along with the expired post. Keep the profile for future synchronization.
- Keep image URLs stable for the retained lifetime and include image data in RSS, with valid XML escaping and MIME types.
- Deduplicate posts across API and scraping sources. Preserve existing successful imports when a later fetch fails.
- Keep adapter output consistent so storage and RSS generation do not depend on the fetching source.
- Rust management and ingestion endpoints require a valid Bearer token. New desktop installations pair using administrator authentication; store only token hashes on the server and encrypted tokens on the desktop. Never store the administrator password in desktop preferences or embed credentials in an installer.
- The Rust API's `POST /api/sync` is a cleanup-only compatibility alias for an existing maintenance cron; it does not fetch posts. It requires an installation token or configured API_TOKEN/SYNC_TOKEN.
- Prevent overlapping syncs within a desktop instance; persist the interval and last attempt, and catch up after restart or resume. Fetching cannot run while the application or computer is off.
- RSS and retained-image endpoints remain public and available while the desktop is closed.
- Retention runs in the Rust API independently of connected desktops. SQLite and images stay on the same persistent volume; another Railway service must not assume access to it.
- Report unavailable public data as a fetch failure. Do not claim that scraping works for every profile or add login credentials, user-session cookies, or block-evasion mechanisms without an explicit change in scope.

## Code style and configuration

- Use TypeScript with clear names and narrow types, and idiomatic formatted Rust.
- Keep local fetching, filesystem access, OS encryption, scheduling, and Velopack in Electron's main process. Only expose narrow, validated IPC methods to the renderer, and check IPC senders.
- Source pages must be sandboxed with Node integration disabled and isolated from management credentials. Keep Electron web security enabled.
- Keep database access and persistent images in Rust. The desktop uploads image bytes, and the API validates metadata, image signatures, MIME types, and size limits.
- Use the existing terminal-inspired design: dark surfaces, monospace typography, blue accents, and rectangular controls. Maintain keyboard focus visibility and responsive layouts.
- Avoid unnecessary comments and commented-out code. Explain non-obvious decisions when a comment is useful.
- Keep schema definitions and SQLite initialization consistent. Database changes must preserve existing data and account for existing installations.
- Document new environment variables in `.env.example` using empty values or safe placeholders. Never commit or print `.env.local`, tokens, passwords, or runtime data.
- Rust reads process environment variables; document them in `api/.env.example`.
- Electron uses its bundled Chromium, not a second Playwright browser. Playwright is only a desktop test driver in the new architecture.
- Keep GitHub release publishing restricted to stable `vX.Y.Z` tags. Never embed the release workflow's GitHub token in the application, and treat tag names as untrusted script input.

## Git safety

- Never use `git reset --hard` or discard unrelated user changes.
- Use `git reset --soft` or `git reset --mixed` only when authorized to change commit history, preserving the user's work.
- Do not rewrite published history or force-push without explicit authorization.
- Prefer non-interactive Git commands. Ask for user input only when an operation actually requires an interactive decision that cannot be resolved from context.
