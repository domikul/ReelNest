# ReelNest

ReelNest is a private home for saved Instagram content, designed for
intentional browsing instead of an endless feed. The project currently
includes a secured single-user sign-in, a saved-post export importer, and a
paginated library with post details. Other product features are planned for
later milestones.

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

2. Configure the single ReelNest user's credentials in the PowerShell session
   that will run the backend. The password is prompted without echo and is
   exposed to this session and the child processes it starts:

   ```powershell
   $env:REELNEST_USERNAME = Read-Host "ReelNest username"
   $secret = Read-Host "ReelNest password" -AsSecureString
   $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
   try {
     $env:REELNEST_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
   } finally {
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
   }
   ```

   Use a unique password of at least 12 characters. Do not put credentials in
   source files, command history, or committed configuration.

3. In that same terminal at the repository root, start the backend:

   ```sh
   mvn -f backend/pom.xml spring-boot:run
   ```

   Spring Boot applies the Flyway migration at startup. The health endpoint is
   available at <http://localhost:8080/api/health>; sign-in is required for
   imports, library, and other private API requests.

4. In another terminal, start the frontend:

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

   Open the local URL printed by Vite (usually <http://localhost:5173>). Use
   your configured credentials to sign in, then use the theme selector to
   choose light, dark, or system appearance. Stop the backend, then clear its
   credential variables from that PowerShell session:

   ```powershell
   Remove-Item Env:REELNEST_USERNAME, Env:REELNEST_PASSWORD
   ```

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

The protected library API uses `GET /api/posts?page=0&size=20` for
server-side pagination (page numbering starts at zero; page sizes are 1–100)
and `GET /api/posts/{id}` for details. Current imported records provide a saved
date and original Instagram URL; captions, creator details, post type, and
thumbnails are not available in the stored importer metadata.

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
| `REELNEST_USERNAME` | Backend | Required; no default | The single allowed user's username |
| `REELNEST_PASSWORD` | Backend | Required; no default | User password; minimum 12 characters |
| `REELNEST_CORS_ALLOWED_ORIGINS` | Backend | Empty (same-origin only) | Comma-separated exact origins allowed to make credentialed API requests |
| `REELNEST_SESSION_TIMEOUT` | Backend | `30m` | Server-side session idle timeout |
| `REELNEST_COOKIE_SECURE` | Backend | `true` | Restricts the session cookie to secure transport |
| `REELNEST_COOKIE_SAME_SITE` | Backend | `strict` | Session-cookie SameSite policy |

Set backend variables in the environment where the Maven command runs. The
password is required and must be at least 12 characters. Production deployments
must terminate TLS at the application or a trusted reverse proxy. Set
Compose variables in that command's environment or in an untracked root `.env`
file. In deployment, provide credentials through a secret manager and configure
only trusted frontend origins; wildcard CORS origins are rejected. The session cookie is HTTP-only, secure by default, and restricted to
cookie-based session tracking. The local Vite proxy keeps API requests
same-origin. For a cross-site frontend deployment, use
`REELNEST_COOKIE_SAME_SITE=none` only with secure transport and retain
`REELNEST_COOKIE_SECURE=true`.

## Scope and next milestones

The backend importer accepts the observed saved-post export format, and the
library currently displays imported saved dates and original post links.
Collections, favorites, notes, categories, search, viewing, watch sessions, and
the full application database schema belong to later milestones. No personal
Instagram export data is required or included in Git.
