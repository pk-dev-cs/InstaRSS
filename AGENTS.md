# Contributing workflow

## Project context

- The official project name is InstaRSS (npm package: `instarss`). This application turns public photo-sharing profiles into RSS feeds with locally stored images.
- Stack: Next.js App Router, React, TypeScript, SQLite (`better-sqlite3`), and Drizzle ORM.
- Fetching order: official API, public HTML through Cheerio, then Playwright when browser rendering is required.
- Keep the user interface, accessibility labels, metadata, and application-generated messages in English. Preserve the original language of fetched posts.
- Use InstaRSS for project branding and neutral photo-sharing terminology for descriptions. Do not use the provider's full name in UI text or documentation; retain it only where technically required, such as domain names and compatibility migrations.

## Repository structure

- `app/`: pages, client components, styles, and Route Handlers.
- `lib/db.ts`: database connection, Drizzle schema, and SQLite initialization.
- `lib/provider.ts`: provider adapters and public-page parsing.
- `lib/sync.ts`: profile synchronization, image downloads, and retention cleanup.
- `lib/sync-all.ts`: synchronization across profiles and the shared database lock.
- `lib/rss.ts`: RSS XML generation.
- `scripts/`: synchronization, cleanup, and smoke checks.
- `middleware.ts`: optional administrator authentication.
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
- Follow an established merge-title convention if the repository has one. Use `MERGE N: Description` only if numbered merge commits already exist; determine the next number from history.
- After merging, verify the branch and merge commit, and report any remaining working-tree changes.
- Do not push to a remote or deploy to Railway unless explicitly requested. Publishing locally does not authorize either action.

## Verification

- Install dependencies with `npm ci` when setting up from the committed lockfile. Use `npm install` when intentionally changing dependencies and include the updated `package-lock.json`.
- Run `npm run check` and `npm run build` for application code, dependency, or configuration changes.
- Run `npm run test:smoke` when changing RSS generation, database persistence, image storage, or retention.
- Run `npx tsx scripts/sync-endpoint-smoke.ts` when changing synchronization orchestration, its lock, or endpoint authentication and responses.
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
- Protect `POST /api/sync` with the separate `SYNC_TOKEN` Bearer token. Leave the endpoint disabled when the token is unset.
- Preserve protection against overlapping full synchronizations and recovery after an interrupted job.
- Keep RSS and retained-image endpoints public when `ADMIN_PASSWORD` protects the management interface.
- Railway cron should call the application's synchronization endpoint. SQLite and images stay on the application service's persistent volume; a separate cron service must not assume access to that volume.
- Report unavailable public data as a fetch failure. Do not claim that scraping works for every profile or add login credentials, user-session cookies, or block-evasion mechanisms without an explicit change in scope.

## Code style and configuration

- Use TypeScript with clear names and narrow types. Keep database, filesystem, API credentials, and scraping code on the server.
- Keep client components small and limited to interactions such as copying RSS URLs.
- Use the existing terminal-inspired design: dark surfaces, monospace typography, blue accents, and rectangular controls. Maintain keyboard focus visibility and responsive layouts.
- Avoid unnecessary comments and commented-out code. Explain non-obvious decisions when a comment is useful.
- Keep schema definitions and SQLite initialization consistent. Database changes must preserve existing data and account for existing installations.
- Document new environment variables in `.env.example` using empty values or safe placeholders. Never commit or print `.env.local`, tokens, passwords, or runtime data.
- When adding environment variables used by scripts, preserve loading through `@next/env`.
- Keep Node.js runtime requirements for SQLite, filesystem access, and Playwright. Browser support requires installing Chromium with `npx playwright install chromium` (plus system dependencies on Linux when needed).

## Git safety

- Never use `git reset --hard` or discard unrelated user changes.
- Use `git reset --soft` or `git reset --mixed` only when authorized to change commit history, preserving the user's work.
- Do not rewrite published history or force-push without explicit authorization.
- Prefer non-interactive Git commands. Ask for user input only when an operation actually requires an interactive decision that cannot be resolved from context.
