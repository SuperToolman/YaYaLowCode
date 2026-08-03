# Per-customer deployment

Each customer runs one Docker container. Its name is chosen during publishing and it contains the Next.js Web BFF, Rust API, PostgreSQL, and internal Valkey. Only the Web and API host ports are published. Put TLS termination in a customer-specific reverse proxy in front of the Web port.

## HTTP/HTTPS and WebSocket

The container can be reached over plain HTTP for private-network testing. In that mode keep `AUTH_COOKIE_SECURE=false`; otherwise browsers will reject the login cookie. For production, terminate TLS at a reverse proxy in front of `WEB_PORT`, set `AUTH_COOKIE_SECURE=true`, and use an HTTPS license-center URL.

The chat WebSocket follows the page protocol automatically: `ws://` for HTTP and `wss://` for HTTPS. The default port mapping is local `3000 -> 8787` and single-container `8801 -> 8802`. For a custom proxy or host, set `NEXT_PUBLIC_BACKEND_WS_URL` in `.env` to the complete public WebSocket URL, for example `wss://platform.example.com/api/communication/ws`, then rebuild the image.

`CORS_ALLOWED_ORIGINS` is optional. Leave it empty for local development; in a deployment that exposes the API directly, set it to a comma-separated list of trusted browser origins.

## Prepare a customer instance

1. Copy `.env.example` to `.env` and replace every secret with a unique value. Generate the Valkey password as URL-safe hexadecimal text, for example `openssl rand -hex 32`.
2. Create `secrets/license-public.pem` from the public key issued by the central license service. Do not place private keys in this directory.
3. From `deploy`, build and start the instance with `docker compose up --build -d`.
4. Reach `http://host:WEB_PORT/settings/license` and activate that customer's license. Production license centers must use HTTPS.

## Publish From Windows

After changing code, run this from the repository root:

```powershell
.\deploy\publish.ps1
```

The script prompts for the server IP, SSH user, password, and container name, packages the source, uploads it, then rebuilds and restarts the single container. When the named container exists, the script reads its Compose metadata and updates it in place, preserving its database, state volume, `.env`, and public key. When it does not exist, the script creates an isolated installation in `RemoteDir/container-name` with its own Compose project and volumes.

On an empty database, startup creates the `yaya` super administrator, its local login credential, the system-administrator role, platform tables, and system navigation. The script waits for and verifies the `yaya` login before completing.

For a new server, initialize its `.env` and public key from this workstation once:

```powershell
.\deploy\publish.ps1 -ContainerName yaya-customer-a -Initialize
```

For each additional instance on the same server, use a different container name and set unique `WEB_PORT` and `API_PORT` values in its initial `.env`. Use `-SshPort` or `-RemoteDir` when the server uses a non-default SSH port or deployment directory.

Cargo downloads and release build artifacts are retained in Docker BuildKit caches between publishes. The first Rust build can take several minutes; later builds reuse unchanged dependencies. During compilation, the publish output reports progress at least every 30 seconds.

## Persistent customer data

`postgres-data` contains customer business data. `api-state` contains uploads, locally persisted platform configuration, imported skills, and the activated license. Valkey contains rebuildable cache data and is intentionally not backed up. Back up both persistent volumes before an image upgrade. A PostgreSQL logical backup can be created with:

```bash
docker compose exec -T yaya pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > customer.sql
```

Keep the matching `api-state` backup with the database backup. Restore both together when recovering a customer.

## Upgrade and rollback

Build a versioned image, take backups, then run `docker compose up -d`. The API applies database migrations during the container's single-instance startup. Keep the previous image tag until the customer smoke test passes: login, create a record, upload/download a file, and complete one workflow task.
