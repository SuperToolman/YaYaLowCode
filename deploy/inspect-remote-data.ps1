[CmdletBinding()]
param(
  [string]$ServerIp,
  [string]$SshUser,
  [securestring]$SshPassword,
  [string]$ContainerName,
  [ValidateRange(1, 65535)] [int]$SshPort = 22
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Read-Required {
  param([string]$Value, [string]$Prompt)
  if ([string]::IsNullOrWhiteSpace($Value)) { return (Read-Host $Prompt).Trim() }
  return $Value.Trim()
}

$ServerIp = Read-Required $ServerIp 'Server IP'
$SshUser = Read-Required $SshUser 'SSH user'
$ContainerName = Read-Required $ContainerName 'Container name'
if (-not $SshPassword) { $SshPassword = Read-Host 'SSH password' -AsSecureString }
if ($ContainerName -notmatch '^[a-z0-9][a-z0-9_.-]*$') { throw 'ContainerName must use lowercase letters, numbers, dots, underscores, or hyphens.' }

$passwordBstr = [IntPtr]::Zero
$askPass = Join-Path ([IO.Path]::GetTempPath()) "yaya-inspect-$PID.cmd"
try {
  $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SshPassword)
  $env:YAYA_DEPLOY_SSH_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
  $passwordBstr = [IntPtr]::Zero
  [IO.File]::WriteAllText($askPass, "@echo off`r`necho %YAYA_DEPLOY_SSH_PASSWORD%`r`n", [Text.Encoding]::ASCII)
  $env:SSH_ASKPASS = $askPass
  $env:SSH_ASKPASS_REQUIRE = 'force'
  $env:DISPLAY = 'yaya-remote-inspection'

  $summarySql = "SELECT 'form_storage_definitions=' || count(*) FROM form_storage_definitions UNION ALL SELECT 'dynamic_tables=' || count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'form_data_%' UNION ALL SELECT 'agent_skills=' || count(*) FROM agent_resources WHERE kind = 'skill';"
  $tablesSql = 'SELECT physical_table FROM form_storage_definitions ORDER BY physical_table;'
  $dynamicRowsSql = @'
DO $$
DECLARE
  item record;
  row_count bigint;
BEGIN
  FOR item IN SELECT physical_table FROM form_storage_definitions ORDER BY physical_table LOOP
    EXECUTE format('SELECT count(*) FROM %I', item.physical_table) INTO row_count;
    RAISE NOTICE 'dynamic_table=% rows=%', item.physical_table, row_count;
  END LOOP;
END
$$;
'@
  $summarySqlEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($summarySql))
  $tablesSqlEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($tablesSql))
  $dynamicRowsSqlEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dynamicRowsSql))
  $remoteScript = @(
    'set -eu',
    "container_name='$ContainerName'",
    ('summary_sql=$(echo ''{0}'' | base64 -d)' -f $summarySqlEncoded),
    ('tables_sql=$(echo ''{0}'' | base64 -d)' -f $tablesSqlEncoded),
    ('dynamic_rows_sql=$(echo ''{0}'' | base64 -d)' -f $dynamicRowsSqlEncoded),
    'docker container inspect "$container_name" >/dev/null',
    'query() { printf "%s\n" "$1" | docker exec -i "$container_name" sh -c ''PGPASSWORD="$POSTGRES_PASSWORD" psql --tuples-only --no-align --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"''; }',
    'echo "[database counts]"',
    'query "$summary_sql"',
    'echo "[physical tables]"',
    'query "$tables_sql"',
    'echo "[dynamic table rows]"',
    'query "$dynamic_rows_sql"',
    'echo "[runtime files]"',
    'docker exec "$container_name" sh -c ''printf "skill_files="; find /var/lib/yaya/skills -type f 2>/dev/null | wc -l; printf "upload_files="; find /var/lib/yaya/uploads -type f 2>/dev/null | wc -l'''
  ) -join "`n"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
  & ssh.exe -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -p $SshPort "$SshUser@$ServerIp" "echo $encoded | base64 -d | sh"
  if ($LASTEXITCODE -ne 0) { throw "ssh.exe failed with exit code $LASTEXITCODE." }
}
finally {
  if ($passwordBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr) }
  Remove-Item Env:YAYA_DEPLOY_SSH_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS -ErrorAction SilentlyContinue
  Remove-Item Env:SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue
  Remove-Item Env:DISPLAY -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $askPass -Force -ErrorAction SilentlyContinue
}
