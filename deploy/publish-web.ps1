[CmdletBinding()]
param(
  [string]$ServerIp,
  [string]$SshUser,
  [securestring]$SshPassword,
  [ValidatePattern('^[a-z0-9][a-z0-9_.-]*$')] [string]$ContainerName = 'test1',
  [ValidateRange(1, 65535)] [int]$SshPort = 22,
  [switch]$SkipBuild
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
if (-not $SshPassword) { $SshPassword = Read-Host 'SSH password' -AsSecureString }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
foreach ($command in @('ssh.exe', 'scp.exe', 'tar.exe', 'pnpm.cmd')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command was not found: $command" }
}

$webRoot = Join-Path $repoRoot 'web'
$nextDir = Join-Path $webRoot '.next'
if (-not $SkipBuild) {
  Write-Host 'Building the Next.js frontend only...'
  Invoke-Native 'pnpm.cmd' @('--dir', $webRoot, 'build')
}
if (-not (Test-Path -LiteralPath (Join-Path $nextDir 'BUILD_ID'))) {
  throw "Missing frontend build output: $nextDir"
}

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$archive = Join-Path ([IO.Path]::GetTempPath()) "yaya-web-$stamp-$PID.tar.gz"
$askPass = Join-Path ([IO.Path]::GetTempPath()) "yaya-web-askpass-$PID.cmd"
$remoteArchive = "/tmp/yaya-web-$stamp-$PID.tar.gz"
$target = "$SshUser@$ServerIp"
$sshOptions = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', "$SshPort")
$scpOptions = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-P', "$SshPort")
$passwordBstr = [IntPtr]::Zero
$stage = Join-Path ([IO.Path]::GetTempPath()) "yaya-web-stage-$PID"

try {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stage | Out-Null
  Copy-Item -LiteralPath $nextDir -Destination (Join-Path $stage '.next') -Recurse
  Remove-Item -LiteralPath (Join-Path $stage '.next\dev') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $stage '.next\cache') -Recurse -Force -ErrorAction SilentlyContinue
  $publicDir = Join-Path $webRoot 'public'
  if (Test-Path -LiteralPath $publicDir) { Copy-Item -LiteralPath $publicDir -Destination (Join-Path $stage 'public') -Recurse }
  # Next's incremental cache is not needed at runtime and can be hundreds of MB.
  Invoke-Native 'tar.exe' @('-czf', $archive, '--exclude=.next/cache', '-C', $stage, '.')

  $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SshPassword)
  $env:YAYA_WEB_DEPLOY_SSH_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
  $passwordBstr = [IntPtr]::Zero
  [IO.File]::WriteAllText($askPass, "@echo off`r`necho %YAYA_WEB_DEPLOY_SSH_PASSWORD%`r`n", [Text.Encoding]::ASCII)
  $env:SSH_ASKPASS = $askPass
  $env:SSH_ASKPASS_REQUIRE = 'force'
  $env:DISPLAY = 'yaya-web-publish'

  Write-Host 'Uploading frontend build...'
  Invoke-Native 'scp.exe' ($scpOptions + @($archive, "${target}:$remoteArchive"))
  $remoteScript = @(
    'set -eu',
    "container_name='$ContainerName'",
    "archive='$remoteArchive'",
    'docker container inspect "$container_name" >/dev/null',
    'rm -rf /tmp/yaya-web-deploy && mkdir -p /tmp/yaya-web-deploy',
    'tar -xzf "$archive" -C /tmp/yaya-web-deploy',
    'rm -f "$archive"',
    'docker exec "$container_name" supervisorctl stop web',
    'docker exec "$container_name" rm -rf /app/web/.next /app/web/public',
    'docker cp /tmp/yaya-web-deploy/.next "$container_name:/app/web/.next"',
    'if [ -d /tmp/yaya-web-deploy/public ]; then docker cp /tmp/yaya-web-deploy/public "$container_name:/app/web/public"; fi',
    'docker exec "$container_name" chown -R yaya:yaya /app/web/.next /app/web/public 2>/dev/null || true',
    'rm -rf /tmp/yaya-web-deploy',
    'docker exec "$container_name" supervisorctl start web',
    'attempt=0',
    'until docker exec "$container_name" curl -fsS http://127.0.0.1:8787/agent >/dev/null; do attempt=$((attempt + 1)); [ "$attempt" -lt 30 ] || { docker logs --tail 80 "$container_name" >&2; exit 3; }; sleep 2; done',
    'docker exec "$container_name" supervisorctl status web'
  ) -join "`n"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
  Write-Host 'Installing frontend and restarting Web...'
  Invoke-Native 'ssh.exe' ($sshOptions + @($target, "echo $encoded | base64 -d | sh"))
  Write-Host "Web publish completed: http://${ServerIp}:8787/agent"
}
finally {
  if ($passwordBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr) }
  Remove-Item Env:YAYA_WEB_DEPLOY_SSH_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue
  Remove-Item Env:DISPLAY -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $askPass -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
