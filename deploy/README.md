# Per-customer deployment

Each customer receives one isolated platform container. The container runs the Next.js Web BFF, Rust API, PostgreSQL, internal Valkey, and the DSH Agent runtime. Only Web and API host ports are published.

## HTTP/HTTPS and WebSocket

The container can be reached over plain HTTP for private-network testing. In that mode keep `AUTH_COOKIE_SECURE=false`; otherwise browsers will reject the login cookie. For production, terminate TLS at a reverse proxy in front of `WEB_PORT`, set `AUTH_COOKIE_SECURE=true`, and use an HTTPS operation-center API URL.

The chat WebSocket follows the page protocol automatically: `ws://` for HTTP and `wss://` for HTTPS. The default port mapping is Web `8787 ->` API `8788`. For a custom proxy or host, set `NEXT_PUBLIC_BACKEND_WS_URL` in `.env` to the complete public WebSocket URL, for example `wss://platform.example.com/api/communication/ws`, then rebuild the image.

`CORS_ALLOWED_ORIGINS` is optional. Leave it empty for local development; in a deployment that exposes the API directly, set it to a comma-separated list of trusted browser origins.

## Prepare a customer instance

1. Copy `.env.example` to `.env` and replace every secret with a unique value. Generate the Valkey password as URL-safe hexadecimal text, for example `openssl rand -hex 32`.
2. Create `secrets/license-public.pem` from the public key issued by the central license service. Do not place private keys in this directory.
3. Configure the platform secrets in `.env`. The initialization script generates missing Agent runtime and model-key encryption secrets, then builds and starts the complete single container.
4. Reach `http://host:WEB_PORT/settings/license` and activate that customer's license. Production license centers must use HTTPS.

## Publish From Windows

After changing code, run this from the repository root:

```powershell
.\deploy\publish.ps1
```

The script prompts for the server IP, SSH user, password, and container name, packages the source, uploads it, then rebuilds and restarts the single container. When the named container exists, the script reads its Compose metadata and updates it in place, preserving its database, state volume, `.env`, and public key. When it does not exist, the script creates an isolated installation in `RemoteDir/container-name` with its own Compose project and volumes.

On an empty database, startup creates the `yaya` super administrator, its local login credential, the system-administrator role, platform tables, and system navigation. The script waits for and verifies the `yaya` login before completing.

## Agent Runtime

The old Agent and LangGraph Worker have been removed. DSH Harness under `agent/deepseek-harness` is built into the single platform image and supervised on internal port `8789`. Customers configure model providers after first login at `/settings/model-providers`.

For a new server, initialize its `.env` and public key from this workstation once:

```powershell
.\deploy\publish.ps1 -ContainerName yaya-customer-a -Initialize
```

For frontend-only changes, use the fast publish script. It builds only the Next.js frontend, uploads the `.next` output into the existing container, and restarts the Web process without rebuilding Rust, the Agent runtime, or persistent services:

```powershell
.\deploy\publish-web.ps1 -ServerIp 203.0.113.10 -SshUser root -ContainerName yaya-customer-a
```

Use `publish.ps1` when API, Agent runtime, dependencies, Docker configuration, or native packages have changed.

The full publish image includes Python 3, pip, and venv. The remote publish step reports whether the existing container already has Python and verifies it after the new image starts. Frontend-only publishing does not rebuild the image, so use `publish.ps1` once to add Python to an older installation.

For each additional instance on the same server, use a different container name and set unique `WEB_PORT` and `API_PORT` values in its initial `.env`. Use `-SshPort` or `-RemoteDir` when the server uses a non-default SSH port or deployment directory.

Cargo downloads and release build artifacts are retained in Docker BuildKit caches between publishes. The first Rust build can take several minutes; later builds reuse unchanged dependencies. During compilation, the publish output reports progress at least every 30 seconds.

## Persistent customer data

`postgres-data` contains customer business data. `api-state` contains uploads, locally persisted platform configuration, imported skills, and the activated license. Valkey contains rebuildable cache data and is intentionally not backed up. Back up both persistent volumes before an image upgrade. A PostgreSQL logical backup can be created with:

```bash
docker compose exec -T yaya pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > customer.sql
```

Keep the matching `api-state` backup with the database backup. Restore both together when recovering a customer.

## Migrate a local database

To replace an existing customer database with the complete local PostgreSQL database, including dynamic form tables and platform tables, run:

```powershell
.\deploy\migrate-database.ps1 -ContainerName yaya-customer-a -ConfirmRemoteOverwrite
```

The script reads `api/runtime/state/database.json`, creates a full plain-SQL local dump for PostgreSQL-version compatibility, removes the PostgreSQL 18-only `transaction_timeout` setting, uploads it, creates a custom-format backup of the remote database at `backups/pre-local-database-migration-<timestamp>.dump`, stops the API and Web processes, replaces the remote `public` schema, restores the dump, synchronizes local skill packages and uploads, then waits for the API health check. It intentionally requires `-ConfirmRemoteOverwrite` because it replaces all remote database data and runtime files.

## Upgrade and rollback

Build a versioned image, take backups, then run `docker compose up -d`. The API applies database migrations during the container's single-instance startup. Keep the previous image tag until the customer smoke test passes: login, create a record, upload/download a file, and complete one workflow task.
