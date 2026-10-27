# ReelNest

ReelNest is a private home for saved Instagram content, designed for
intentional browsing instead of an endless feed. It includes account
registration and sign-in, an Instagram saved-post export importer, a paginated
library, and related personal content-management features.

## Project layout

- `backend/` — Java 21 and Spring Boot REST API, importer, and paginated library API.
- `frontend/` — React, TypeScript, and Vite application.
- `docker-compose.yml` — local PostgreSQL database.

## Prerequisites

- Java 21
- Apache Maven 3.9 or newer
- Node.js 20.19+ or 22.12+, with npm
- Docker Engine or Docker Desktop with the Compose plugin

## Run locally

1. Start PostgreSQL from the repository root:

   ```powershell
   docker compose up -d db
   ```

2. In a terminal at the repository root, start the backend:

   ```sh
   mvn -f backend/pom.xml spring-boot:run
   ```

   Spring Boot applies the Flyway migration at startup. The health endpoint is
   available at <http://localhost:8080/api/health>. Flyway creates the
   database schema, including the accounts table, on startup.

3. In another terminal, start the frontend:

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

   Open the local URL printed by Vite (usually <http://localhost:5173>).
   Select **Create an account** to register; usernames are 3–32 letters or
   numbers, with periods, underscores, and hyphens also allowed. Passwords
   must be at least 12 characters and no more than 72 UTF-8 bytes. Choose
   light, dark, or system appearance from the theme selector.

The backend also exposes `POST /api/auth/register` and
`POST /api/auth/login` with JSON `username` and `password` fields. Obtain a
CSRF token from `GET /api/auth/csrf` and send it in the `X-CSRF-TOKEN` header
for either request. `GET /api/auth/session` reports the current account
identity; `POST /api/auth/logout` ends the session and also requires a CSRF
token.

Stop the database with `docker compose down`. Database data is kept in the
`postgres_data` Docker volume; to remove that local data, run
`docker compose down --volumes`.

## Build and test

Run backend tests and package the application:

```sh
mvn -f backend/pom.xml test
mvn -f backend/pom.xml package
```

Run frontend tests and create a production build:

```sh
cd frontend
npm ci
npm test
npm run build
```

Backend tests include PostgreSQL integration coverage. Start the database with
`docker compose up -d db` before running `mvn -f backend/pom.xml test`. The
integration tests use separate `reelnest_import_test` and
`reelnest_library_test` schemas and do not truncate the development schema. Set
`REELNEST_TEST_DATABASE_URL` to use a different test database URL.

Accounts are stored in PostgreSQL. Passwords are hashed with BCrypt and are
never returned by the API. Existing posts and related records remain
unassigned by the account-ownership migration and are not visible to newly
registered accounts; move legacy data to an account only through a deliberate
manual database migration.

The protected library API uses `GET /api/posts?page=0&size=20` for
server-side pagination (page numbering starts at zero; page sizes are 1–100),
and supports `q`, `favorite=true|false`, `categoryId`, and `collectionId`
query parameters for server-side search and filtering. Search covers the
persisted original URL, imported source metadata (including caption and creator
username), personal notes, and assigned category names.
`GET /api/posts/{id}` for details, and
`PUT /api/posts/{id}/favorite` with `{"favorite":true}` or
`{"favorite":false}` to set favorite state idempotently. Current imported
records provide the saved date, original Instagram URL, caption, and creator
username when present in the Instagram `saved_posts.html` export. The importer
stores only these normalized post fields; it does not retain the uploaded HTML,
download media, or infer unavailable post types and thumbnails. The browser
sends its IANA time zone so localized saved dates are converted consistently.
Captions are displayed as plain text on library cards, post details, and in the
viewer, and are included in search. Record a post-details view with
`PUT /api/posts/{id}/view` (authenticated session and CSRF token), then list
up to 20 recently viewed posts with
`GET /api/posts/recently-watched?size=8`. The history stores the most recent
view time separately from imported source metadata and can be reused by a
future viewer; it does not track playback. Personal notes are separate from
imported source metadata. The post-details **Open post viewer** action opens
the single-post layouts.
Reel/video, carousel, and image types have distinct fallback layouts, but the
current importer/API does not supply post type or media references. Existing
imported posts therefore show the unknown-type and unavailable-media state
while retaining any imported caption and creator username. For supported
Instagram `/p/` and `/reel/` URLs, the viewer attempts a sandboxed Instagram
embed and always provides a safe
"Open original on Instagram" fallback when the URL is valid. Unsupported,
blocked, or unavailable embeds fall back to the original post link; the viewer
does not scrape Instagram, download media, or claim that an embed is playable.
Library cards also load supported captioned Instagram embeds lazily as they
approach the viewport and keep an "Open original on Instagram" link available.
Imported captions are rendered separately as plain text, so they remain visible
when Instagram omits them from the embed. Card previews use a larger,
non-scrolling frame; unusually long posts may not fit completely. Loading card
previews sends requests to Instagram, and previews may be blocked or unavailable.
Previous/next navigation stays within the ordered posts on the current library
or collection page, or the displayed Recently Watched list. On-screen controls,
desktop arrow keys, and horizontal touch swipes are supported; navigation stops
at each set boundary and never advances automatically.
Use `GET /api/posts/{id}/notes` to view a note, `PUT /api/posts/{id}/notes` with
`{"note":"..."}` to create or update it, and `DELETE /api/posts/{id}/notes`
to remove it. Notes must contain non-whitespace text and may be up to 5,000
characters. These operations require the authenticated session and CSRF token.
Manage categories with `GET /api/categories`, `POST /api/categories`,
`PUT /api/categories/{id}`, and `DELETE /api/categories/{id}`. Category names
are trimmed, unique without regard to case, and limited to 80 characters.
View a post's categories with `GET /api/posts/{id}/categories`; assign or
remove one with `PUT` or `DELETE /api/posts/{id}/categories/{categoryId}`.
Category and assignment data are stored separately from imported post
metadata, so imports do not overwrite them. Deleting a category removes its
post assignments. Category mutations also require the authenticated session
and CSRF token.
Manage collections with `GET /api/collections`, `POST /api/collections`,
`PUT /api/collections/{id}`, and `DELETE /api/collections/{id}`. Collection
names are trimmed, unique without regard to case, and limited to 80
characters. View paginated posts with
`GET /api/collections/{id}/posts?page=0&size=20`; view a post's collection
memberships with `GET /api/posts/{id}/collections`. Add or remove a post with
`PUT` or `DELETE /api/posts/{postId}/collections/{collectionId}`. Collections
and memberships are separate from imported post metadata; deleting a
collection removes its memberships. Collection mutations also require the
authenticated session and CSRF token.

Create a curated session with `POST /api/watch-sessions` and an ordered
`postIds` array (1–100 distinct saved posts); an optional name may be up to 80
characters. `GET /api/watch-sessions` lists the 50 most recently created
sessions, and `GET /api/watch-sessions/{id}` returns posts in their saved
session order plus the current position. Use
`PUT /api/watch-sessions/{id}/progress` with `{"currentPosition":1}` to persist
the current zero-based position; setting it to the post count marks the
session complete. Session metadata, ordered membership, and progress are
separate from imported post data. All session endpoints require authentication,
and creation/progress updates require the CSRF token.

## Environment variables

The defaults below are for local development only; do not use them in a
deployed environment.

| Variable | Used by | Default | Purpose |
| --- | --- | --- | --- |
| `POSTGRES_DB` | Docker Compose | `reelnest_dev` | Local database name |
| `POSTGRES_USER` | Docker Compose | `reelnest` | Local database user |
| `POSTGRES_PASSWORD` | Docker Compose | `local_dev_password` | Local database password |
| `POSTGRES_PORT` | Docker Compose | `5432` | Host port for PostgreSQL |
| `DATABASE_URL` | Backend | `jdbc:postgresql://localhost:5432/reelnest_dev` | JDBC connection URL |
| `DATABASE_USERNAME` | Backend | `reelnest` | Database user |
| `DATABASE_PASSWORD` | Backend | `local_dev_password` | Database password |
| `SERVER_PORT` | Backend | `8080` | Backend HTTP port |
| `REELNEST_CORS_ALLOWED_ORIGINS` | Backend | Empty (same-origin only) | Comma-separated exact origins allowed to make credentialed API requests |
| `REELNEST_SESSION_TIMEOUT` | Backend | `30m` | Server-side session idle timeout |
| `REELNEST_COOKIE_SECURE` | Backend | `true` | Restricts the session cookie to secure transport |
| `REELNEST_COOKIE_SAME_SITE` | Backend | `strict` | Session-cookie SameSite policy |

Set backend variables in the environment where the Maven command runs.
Production deployments must terminate TLS at the application or a trusted reverse proxy. Set
Compose variables in that command's environment or in an untracked root `.env`
file. In deployment, provide credentials through a secret manager and configure
only trusted frontend origins; wildcard CORS origins are rejected. The session cookie is HTTP-only, secure by default, and restricted to
cookie-based session tracking. The local Vite proxy keeps API requests
same-origin. For a cross-site frontend deployment, use
`REELNEST_COOKIE_SAME_SITE=none` only with secure transport and retain
`REELNEST_COOKIE_SECURE=true`.

## Scope and next milestones

The backend importer accepts the saved-post export format; the library
displays imported saved dates, original post links, captions, and creators.
Favorites, notes, categories, collections, search, recently watched history,
the post viewer, and watch sessions are scoped to the signed-in account. Future
milestones can add more account management and data portability tools.
No personal Instagram export data is required or included in Git.
