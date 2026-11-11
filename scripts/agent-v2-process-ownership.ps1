# Fail closed: a port is not proof that a process belongs to this checkout.
function Assert-DevelopmentProcessOwnership {
    param([int]$ProcessId, [string]$RepositoryRoot, [ValidateSet('backend','frontend')][string]$ServiceName)
    $workspace = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\', '/')
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
    if (-not $process) { throw "Cannot verify $ServiceName process identity (PID $ProcessId)." }
    $executable = [string]$process.ExecutablePath
    $command = [string]$process.CommandLine
    $owned = if ($ServiceName -eq 'backend') {
        $executable.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($executable) -eq 'yaya-api.exe'
    } else {
        [IO.Path]::GetFileName($executable) -eq 'node.exe' -and
        $command -match ([regex]::Escape((Join-Path $workspace 'web')) + '[\\/]') -and
        $command -match '(next|start-server)'
    }
    if (-not $owned) { throw "Port is occupied by an unverified $ServiceName process (PID $ProcessId); it will not be stopped." }
}
