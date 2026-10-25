# ReelNest

ReelNest is a personal home for saved Instagram content, designed for
intentional browsing instead of an endless feed. This repository currently
contains only the project foundation; the library and other product features
are planned for later milestones.

## Project layout

- `backend/` — Java 21 and Spring Boot REST API.
- `frontend/` — React, TypeScript, and Vite application shell.
- `docker-compose.yml` — local PostgreSQL database.

## Prerequisites

- Java 21
- Apache Maven 3.9 or newer
- Node.js 20.19+ or 22.12+, with npm
- Docker Engine or Docker Desktop with the Compose plugin

## Run locally

1. Start PostgreSQL from the repository root:

   ```sh
   docker compose up -d db
   ```

2. In a terminal at the repository root, start the backend:

   ```sh
   mvn -f backend/pom.xml spring-boot:run
   ```

   Spring Boot applies the Flyway migration at startup. The health endpoint is
   available at <http://localhost:8080/api/health>.

3. In another terminal, start the frontend:

   ```sh
   cd frontend
   npm ci
   npm run dev
   ```

   Open the local URL printed by Vite (usually <http://localhost:5173>). Use
   the theme selector to choose light, dark, or system appearance.

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
integration tests use a separate `reelnest_import_test` schema and do not
truncate the development schema. Set `REELNEST_TEST_DATABASE_URL` to use a
different test database URL.

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

Set backend variables in the environment where the Maven command runs. Set
Compose variables in that command's environment or in an untracked root `.env`
file. Keep real credentials out of Git.

## Scope and next milestones

This initialization does not implement Instagram export parsing, library
management, collections, favorites, search, authentication, viewing, watch
sessions, or a full application database schema. Those belong to later
milestones. In particular, no Instagram export data is required or included.
