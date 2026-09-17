[CmdletBinding()]
param(
  [string]$ServerIp,
  [string]$SshUser,
  [securestring]$SshPassword,
  [string]$ContainerName,
  [ValidateRange(1, 65535)] [int]$SshPort = 22,
  [ValidatePattern('^/[A-Za-z0-9._/-]+$')] [string]$RemoteDir = '/opt/yaya-low-code',
  [switch]$Initialize
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Native {
  param([string]$File, [string[]]$Arguments)
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE." }
}

function Read-Required {
  param([string]$Value, [string]$Prompt)
  if ([string]::IsNullOrWhiteSpace($Value)) { return (Read-Host $Prompt).Trim() }
  return $Value.Trim()
}

$ServerIp = Read-Required $ServerIp 'Server IP'
$SshUser = Read-Required $SshUser 'SSH user'
$ContainerName = Read-Required $ContainerName 'Container name'
if (-not $SshPassword) { $SshPassword = Read-Host 'SSH password' -AsSecureString }
$parsedIp = $null
if (-not [Net.IPAddress]::TryParse($ServerIp, [ref]$parsedIp)) { throw 'ServerIp must be an IP address.' }
if ($SshUser -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'SshUser contains unsupported characters.' }
if ($ContainerName -notmatch '^[a-z0-9][a-z0-9_.-]*$') { throw 'ContainerName must use lowercase letters, numbers, dots, underscores, or hyphens.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ($Initialize) {
  foreach ($file in @((Join-Path $repoRoot 'deploy/.env'), (Join-Path $repoRoot 'deploy/secrets/license-public.pem'))) {
    if (-not (Test-Path -LiteralPath $file)) { throw "-Initialize requires: $file" }
  }
}
foreach ($command in @('ssh.exe', 'scp.exe', 'tar.exe')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command was not found: $command" }
}

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$archive = Join-Path ([IO.Path]::GetTempPath()) "yaya-$stamp-$PID.tar.gz"
$askPass = Join-Path ([IO.Path]::GetTempPath()) "yaya-askpass-$PID.cmd"
$remoteArchive = "/tmp/yaya-$stamp-$PID.tar.gz"
$remoteEnv = "/tmp/yaya-$stamp-$PID.env"
$remotePublicKey = "/tmp/yaya-$stamp-$PID-license-public.pem"
$target = "$SshUser@$ServerIp"
$sshOptions = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', "$SshPort")
$scpOptions = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-P', "$SshPort")
$excludes = @('--exclude=.git', '--exclude=.codex-openapi-target', '--exclude=node_modules', '--exclude=.next', '--exclude=api/target*', '--exclude=api/.yaya-*', '--exclude=web/.next', '--exclude=web/node_modules', '--exclude=web/.cache', '--exclude=web/src-tauri', '--exclude=web/tauri-dist', '--exclude=agent/deepseek-harness/.dsh', '--exclude=agent/deepseek-harness/node_modules', '--exclude=deploy/.env', '--exclude=deploy/secrets', '--exclude=*.log', '--exclude=.yaya-*')
$passwordBstr = [IntPtr]::Zero

try {
  $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SshPassword)
  $env:YAYA_DEPLOY_SSH_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
  $passwordBstr = [IntPtr]::Zero
  [IO.File]::WriteAllText($askPass, "@echo off`r`necho %YAYA_DEPLOY_SSH_PASSWORD%`r`n", [Text.Encoding]::ASCII)
  $env:SSH_ASKPASS = $askPass
  $env:SSH_ASKPASS_REQUIRE = 'force'
  $env:DISPLAY = 'yaya-publish'

  Write-Host 'Creating source package...'
  Invoke-Native 'tar.exe' (@('-czf', $archive) + $excludes + @('-C', $repoRoot, '.'))
  if ($Initialize) {
    Write-Host 'Uploading initial environment configuration and public key...'
    Invoke-Native 'scp.exe' ($scpOptions + @((Join-Path $repoRoot 'deploy/.env'), "${target}:$remoteEnv"))
    Invoke-Native 'scp.exe' ($scpOptions + @((Join-Path $repoRoot 'deploy/secrets/license-public.pem'), "${target}:$remotePublicKey"))
  }

  Write-Host 'Uploading source package...'
  Invoke-Native 'scp.exe' ($scpOptions + @($archive, "${target}:$remoteArchive"))
  $remoteScript = @(
    'set -eu',
    "install_root='$RemoteDir'",
    "container_name='$ContainerName'",
    "archive='$remoteArchive'",
    "initial_env='$remoteEnv'",
    "initial_public_key='$remotePublicKey'",
    "initialize='$($Initialize.IsPresent.ToString().ToLowerInvariant())'",
    'if docker container inspect "$container_name" >/dev/null 2>&1; then',
    '  [ "$initialize" = false ] || { rm -f "$initial_env" "$initial_public_key"; echo "Container already exists; refusing to overwrite its configuration." >&2; exit 2; }',
    '  compose_project=$(docker inspect -f ''{{ index .Config.Labels "com.docker.compose.project" }}'' "$container_name")',
    '  compose_directory=$(docker inspect -f ''{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'' "$container_name")',
    '  [ -n "$compose_project" ] && [ -n "$compose_directory" ] || { echo "Existing container is not managed by Docker Compose." >&2; exit 2; }',
    '  install_dir=$(dirname "$compose_directory")',
    '  echo "Updating existing container: $container_name"',
    'else',
    '  compose_project=$container_name',
    '  install_dir="$install_root/$container_name"',
    '  mkdir -p "$install_dir/deploy/secrets"',
    '  if [ "$initialize" = true ]; then mv "$initial_env" "$install_dir/deploy/.env"; mv "$initial_public_key" "$install_dir/deploy/secrets/license-public.pem"; fi',
    '  echo "Installing new container: $container_name"',
    'fi',
    'test -f "$install_dir/deploy/.env" || { echo "Missing deploy/.env. Run with -Initialize for a new installation." >&2; exit 2; }',
    'test -f "$install_dir/deploy/secrets/license-public.pem" || { echo "Missing license public key. Run with -Initialize for a new installation." >&2; exit 2; }',
    'if docker exec "$container_name" sh -lc ''command -v python3 >/dev/null 2>&1''; then echo "Python environment already present: $(docker exec "$container_name" python3 --version 2>&1)"; else echo "Python environment missing; it will be installed in the new image."; fi',
    '# The platform uses fixed public ports. Do not retain legacy per-instance mappings.',
    'if grep -q ''^WEB_PORT='' "$install_dir/deploy/.env"; then sed -i ''s/^WEB_PORT=.*/WEB_PORT=8787/'' "$install_dir/deploy/.env"; else printf ''\nWEB_PORT=8787\n'' >> "$install_dir/deploy/.env"; fi',
    'if grep -q ''^API_PORT='' "$install_dir/deploy/.env"; then sed -i ''s/^API_PORT=.*/API_PORT=8788/'' "$install_dir/deploy/.env"; else printf ''API_PORT=8788\n'' >> "$install_dir/deploy/.env"; fi',
    'if ! grep -q ''^AGENT_RUNTIME_SHARED_SECRET='' "$install_dir/deploy/.env"; then printf ''\nAGENT_RUNTIME_SHARED_SECRET=%s\n'' "$(openssl rand -hex 32)" >> "$install_dir/deploy/.env"; fi',
    'if ! grep -q ''^YAYA_BYOM_ENCRYPTION_KEY='' "$install_dir/deploy/.env"; then printf ''YAYA_BYOM_ENCRYPTION_KEY=%s\n'' "$(openssl rand -base64 32 | tr -d ''\n'')" >> "$install_dir/deploy/.env"; fi',
    'find "$install_dir" -mindepth 1 -maxdepth 1 ! -name deploy -exec rm -rf {} +',
    'find "$install_dir/deploy" -mindepth 1 -maxdepth 1 ! -name .env ! -name secrets -exec rm -rf {} +',
    'tar -xzf "$archive" -C "$install_dir"',
    'rm -f "$archive"',
    'BUILDKIT_PROGRESS=plain CONTAINER_NAME="$container_name" docker compose -p "$compose_project" --project-directory "$install_dir/deploy" -f "$install_dir/deploy/compose.yaml" --env-file "$install_dir/deploy/.env" up -d --build --remove-orphans',
    'attempt=0',
    'until docker exec "$container_name" curl -fsS http://127.0.0.1:8788/healthz >/dev/null && docker exec "$container_name" curl -fsS http://127.0.0.1:8789/healthz >/dev/null && docker exec "$container_name" curl -fsS -X POST http://127.0.0.1:8787/api/auth/login -H content-type:application/json --data-binary ''{"username":"yaya","password":"yaya"}'' | grep -q "\"code\":0"; do attempt=$((attempt + 1)); [ "$attempt" -lt 60 ] || { echo "Initial API/Web/Agent verification timed out." >&2; docker logs --tail 100 "$container_name" >&2 || true; exit 3; }; sleep 2; done',
    'docker exec "$container_name" sh -lc ''command -v python3 >/dev/null 2>&1 && python3 --version''',
    'echo "Initial data verified: API, Web, Agent, Python, and yaya super administrator are available."',
    'CONTAINER_NAME="$container_name" docker compose -p "$compose_project" --project-directory "$install_dir/deploy" -f "$install_dir/deploy/compose.yaml" --env-file "$install_dir/deploy/.env" ps'
  ) -join "`n"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
  Write-Host 'Building and starting the single-container deployment...'
  Invoke-Native 'ssh.exe' ($sshOptions + @($target, "echo $encoded | base64 -d | sh"))
  Write-Host "Publish completed: http://${ServerIp}:8787"
}
finally {
  if ($passwordBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr) }
  Remove-Item Env:YAYA_DEPLOY_SSH_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue
  Remove-Item Env:DISPLAY -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $askPass -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
}
