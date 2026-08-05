[CmdletBinding()]
param(
  [string]$ServerIp,
  [string]$SshUser,
  [securestring]$SshPassword,
  [string]$ContainerName,
  [ValidateRange(1, 65535)] [int]$SshPort = 22,
  [string]$PgDumpPath,
  [switch]$ConfirmRemoteOverwrite
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

function Resolve-PgDumpPath {
  param([string]$Candidate)
  if ($Candidate) {
    if (-not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { throw "pg_dump was not found: $Candidate" }
    return (Resolve-Path -LiteralPath $Candidate).Path
  }

  $command = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $service = Get-CimInstance Win32_Service -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'postgresql*' } |
    Select-Object -First 1
  if ($service -and $service.PathName -match '"([^\"]*\\pg_ctl\.exe)"') {
    $path = Join-Path (Split-Path -Parent $matches[1]) 'pg_dump.exe'
    if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
  }

  throw 'pg_dump.exe was not found. Install PostgreSQL client tools or pass -PgDumpPath.'
}

function Remove-IncompatiblePostgresSettings {
  param([string]$DumpPath)

  $temporaryPath = "$DumpPath.compat"
  $reader = [IO.File]::OpenText($DumpPath)
  $writer = New-Object IO.StreamWriter($temporaryPath, $false, (New-Object Text.UTF8Encoding($false)))
  try {
    while (($line = $reader.ReadLine()) -ne $null) {
      # PostgreSQL 18 emits this setting, but the deployment image currently uses PostgreSQL 15.
      if ($line -ne 'SET transaction_timeout = 0;') { $writer.WriteLine($line) }
    }
  }
  finally {
    $writer.Dispose()
    $reader.Dispose()
  }
  Move-Item -LiteralPath $temporaryPath -Destination $DumpPath -Force
}

function New-RuntimeArchive {
  param([string]$SourcePath, [string]$ArchivePath, [string]$Label)
  if (-not (Test-Path -LiteralPath $SourcePath -PathType Container)) { return $null }
  if (-not (Get-ChildItem -LiteralPath $SourcePath -Force | Select-Object -First 1)) { return $null }

  Write-Host "Packaging local $Label..."
  Invoke-Native 'tar.exe' @('-czf', $ArchivePath, '-C', $SourcePath, '.')
  return $ArchivePath
}

if (-not $ConfirmRemoteOverwrite) {
  throw 'Database migration overwrites the remote database. Re-run with -ConfirmRemoteOverwrite after confirming the remote data may be replaced.'
}

$ServerIp = Read-Required $ServerIp 'Server IP'
$SshUser = Read-Required $SshUser 'SSH user'
$ContainerName = Read-Required $ContainerName 'Container name'
if (-not $SshPassword) { $SshPassword = Read-Host 'SSH password' -AsSecureString }
if ($ContainerName -notmatch '^[a-z0-9][a-z0-9_.-]*$') { throw 'ContainerName must use lowercase letters, numbers, dots, underscores, or hyphens.' }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$databaseSettingsPath = Join-Path $repoRoot 'api/runtime/state/database.json'
if (-not (Test-Path -LiteralPath $databaseSettingsPath)) { throw "Local database settings were not found: $databaseSettingsPath" }
$settingsDocument = Get-Content -LiteralPath $databaseSettingsPath -Raw | ConvertFrom-Json
$database = if ($settingsDocument.database) { $settingsDocument.database } else { $settingsDocument }
foreach ($property in @('host', 'port', 'database', 'username', 'password')) {
  if ([string]::IsNullOrWhiteSpace([string]$database.$property)) { throw "Local database setting '$property' is missing." }
}

$pgDump = Resolve-PgDumpPath $PgDumpPath
foreach ($command in @('ssh.exe', 'scp.exe', 'tar.exe')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command was not found: $command" }
}

$backupDirectory = Join-Path $PSScriptRoot 'backups'
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$localDump = Join-Path $backupDirectory "local-$($database.database)-$stamp.sql"
$skillsArchive = Join-Path $backupDirectory "local-skills-$stamp.tar.gz"
$uploadsArchive = Join-Path $backupDirectory "local-uploads-$stamp.tar.gz"
$askPass = Join-Path ([IO.Path]::GetTempPath()) "yaya-askpass-$PID.cmd"
$remoteDump = "/tmp/yaya-local-$stamp-$PID.dump"
$remoteSkillsArchive = "/tmp/yaya-local-skills-$stamp-$PID.tar.gz"
$remoteUploadsArchive = "/tmp/yaya-local-uploads-$stamp-$PID.tar.gz"
$target = "$SshUser@$ServerIp"
$sshOptions = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', "$SshPort")
$scpOptions = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-P', "$SshPort")
$passwordBstr = [IntPtr]::Zero
$hadPgPassword = Test-Path Env:PGPASSWORD
$previousPgPassword = $env:PGPASSWORD

try {
  Write-Host 'Exporting the complete local PostgreSQL database...'
  $env:PGPASSWORD = [string]$database.password
  Invoke-Native $pgDump @(
    '--format=plain', '--no-owner', '--no-acl',
    "--host=$($database.host)", "--port=$($database.port)", "--username=$($database.username)",
    "--file=$localDump", "$($database.database)"
  )
  if (-not (Test-Path -LiteralPath $localDump) -or (Get-Item -LiteralPath $localDump).Length -eq 0) {
    throw 'Local database export did not produce a dump file.'
  }
  Remove-IncompatiblePostgresSettings $localDump
  $skillsArchive = New-RuntimeArchive (Join-Path $repoRoot 'api/resources/skills') $skillsArchive 'skill packages'
  $uploadsArchive = New-RuntimeArchive (Join-Path $repoRoot 'api/runtime/uploads') $uploadsArchive 'uploads'

  $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SshPassword)
  $env:YAYA_DEPLOY_SSH_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
  $passwordBstr = [IntPtr]::Zero
  [IO.File]::WriteAllText($askPass, "@echo off`r`necho %YAYA_DEPLOY_SSH_PASSWORD%`r`n", [Text.Encoding]::ASCII)
  $env:SSH_ASKPASS = $askPass
  $env:SSH_ASKPASS_REQUIRE = 'force'
  $env:DISPLAY = 'yaya-database-migration'

  Write-Host 'Uploading local database and runtime data...'
  Invoke-Native 'scp.exe' ($scpOptions + @($localDump, "${target}:$remoteDump"))
  if ($skillsArchive) { Invoke-Native 'scp.exe' ($scpOptions + @($skillsArchive, "${target}:$remoteSkillsArchive")) }
  if ($uploadsArchive) { Invoke-Native 'scp.exe' ($scpOptions + @($uploadsArchive, "${target}:$remoteUploadsArchive")) }

  $remoteBackupFile = "pre-local-database-migration-$stamp.dump"
  $remoteScript = @(
    'set -eu',
    "container_name='$ContainerName'",
    "source_dump='$remoteDump'",
    ('skills_archive="{0}"' -f $(if ($skillsArchive) { $remoteSkillsArchive } else { '' })),
    ('uploads_archive="{0}"' -f $(if ($uploadsArchive) { $remoteUploadsArchive } else { '' })),
    'docker container inspect "$container_name" >/dev/null',
    'compose_directory=$(docker inspect -f ''{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'' "$container_name")',
    'test -n "$compose_directory" || { echo "Container is not managed by Docker Compose." >&2; exit 2; }',
    'install_dir=$(dirname "$compose_directory")',
    ('backup_path="$install_dir/backups/{0}"' -f $remoteBackupFile),
    'mkdir -p "$(dirname "$backup_path")"',
    'test -s "$source_dump" || { echo "Uploaded database dump is empty." >&2; exit 2; }',
    'cleanup() { rm -f "$source_dump" "$skills_archive" "$uploads_archive"; }',
    'trap cleanup EXIT',
    'echo "Creating remote database backup: $backup_path"',
    'docker exec "$container_name" sh -c ''PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" "$POSTGRES_DB"'' > "$backup_path"',
    'test -s "$backup_path" || { echo "Remote database backup is empty." >&2; exit 2; }',
    'echo "Stopping API and Web writes..."',
    'docker exec "$container_name" supervisorctl stop web api',
    'restore_services() { docker exec "$container_name" supervisorctl start api web >/dev/null 2>&1 || true; }',
    'trap ''restore_services; cleanup'' EXIT',
    'echo "Restoring the complete local database..."',
    'docker exec "$container_name" sh -c ''PGPASSWORD="$POSTGRES_PASSWORD" psql --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO \"$POSTGRES_USER\";"''',
    'docker exec -i "$container_name" sh -c ''PGPASSWORD="$POSTGRES_PASSWORD" psql --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'' < "$source_dump"',
    'sync_runtime_archive() { archive="$1"; destination="$2"; [ -n "$archive" ] || return 0; docker cp "$archive" "$container_name:/tmp/yaya-runtime-sync.tar.gz"; docker exec "$container_name" sh -c "rm -rf \"$destination\"; mkdir -p \"$destination\"; tar -xzf /tmp/yaya-runtime-sync.tar.gz -C \"$destination\"; rm -f /tmp/yaya-runtime-sync.tar.gz; chown -R yaya:yaya \"$destination\""; }',
    'sync_runtime_archive "$skills_archive" "/var/lib/yaya/skills"',
    'sync_runtime_archive "$uploads_archive" "/var/lib/yaya/uploads"',
    'restore_services',
    'trap cleanup EXIT',
    'attempt=0',
    'until docker exec "$container_name" curl -fsS http://127.0.0.1:8787/healthz >/dev/null; do attempt=$((attempt + 1)); [ "$attempt" -lt 30 ] || { echo "Backend health check timed out after database restore." >&2; exit 3; }; sleep 2; done',
    'echo "Database migration completed. Remote backup retained at: $backup_path"'
  ) -join "`n"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
  Write-Host 'Backing up and restoring the remote database...'
  Invoke-Native 'ssh.exe' ($sshOptions + @($target, "echo $encoded | base64 -d | sh"))
  Write-Host "Database migration completed. Local dump retained at: $localDump"
}
finally {
  if ($passwordBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr) }
  if ($hadPgPassword) { $env:PGPASSWORD = $previousPgPassword } else { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  Remove-Item Env:YAYA_DEPLOY_SSH_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue
  Remove-Item Env:DISPLAY -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $askPass -Force -ErrorAction SilentlyContinue
}
