[CmdletBinding()]
param(
    [string]$WebBaseUrl = "http://127.0.0.1:8787",
    [string]$ApiBaseUrl = "http://127.0.0.1:8788",
    [string]$AgentBaseUrl = "http://127.0.0.1:8789",
    [string]$AdminUsername = "yaya",
    [string]$AdminPassword = "yaya"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$testUserId = $null
$testSessionId = $null
$testModelRouteId = $null
$testToken = $null
$adminToken = $null

function Invoke-Json {
    param(
        [string]$Method,
        [string]$Url,
        [object]$Body,
        [hashtable]$Headers = @{}
    )

    $arguments = @{ Method = $Method; Uri = $Url; Headers = $Headers; UseBasicParsing = $true }
    if ($null -ne $Body) {
        $arguments.ContentType = "application/json"
        $arguments.Body = $Body | ConvertTo-Json -Depth 12 -Compress
    }
    $response = Invoke-WebRequest @arguments
    if (-not $response.Content.Trim()) { return $null }
    return $response.Content | ConvertFrom-Json
}

function Get-Token {
    param([string]$Username, [string]$Password)
    $response = Invoke-Json -Method "POST" -Url "$WebBaseUrl/api/auth/login" -Body @{ username = $Username; password = $Password }
    if ($response.code -ne 0 -or -not $response.data.token) { throw "login failed for $Username" }
    return [string]$response.data.token
}

function Test-GatewayFrame {
    param([string]$Protocol, [string]$ExpectedSessionId, [hashtable]$Headers)
    if ($Protocol -eq "ws") {
        $socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $socket.Options.SetRequestHeader("Authorization", $Headers.Authorization)
        $uri = [Uri](($AgentBaseUrl -replace '^http', 'ws') + '/api/agent/dsh/events.mux')
        try {
            $connect = $socket.ConnectAsync($uri, [Threading.CancellationToken]::None)
            if (-not $connect.Wait(10000)) { throw "WebSocket connection timed out" }
            $buffer = New-Object byte[] 65536
            $receive = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None)
            if (-not $receive.Wait(10000)) { throw "WebSocket did not emit a mux frame" }
            $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $receive.Result.Count)
        } finally {
            if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) { $socket.Dispose() }
        }
    } else {
        $client = [System.Net.Http.HttpClient]::new()
        $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::Parse($Headers.Authorization)
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, "$WebBaseUrl/api/agent/dsh/events.mux")
        $request.Headers.Accept.ParseAdd("text/event-stream")
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { throw "SSE gateway returned $([int]$response.StatusCode)" }
        $reader = [IO.StreamReader]::new($response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
        $line = $null
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline -and $null -eq $line) {
            $read = $reader.ReadLineAsync()
            if ($read.Wait(1000) -and $read.Result.StartsWith("data: ")) { $line = $read.Result.Substring(6) }
        }
        $reader.Dispose(); $response.Dispose(); $client.Dispose()
        if ($null -eq $line) { throw "SSE did not emit a mux frame" }
        $text = $line
    }
    $frame = $text | ConvertFrom-Json
    if ($frame.type -ne "server-request" -or $frame.method -ne "session/subscribed" -or $frame.payload.sessionId -ne $ExpectedSessionId) {
        throw "$Protocol mux did not return the expected subscribed frame"
    }
}

try {
    foreach ($url in @("$WebBaseUrl/login", "$ApiBaseUrl/healthz", "$AgentBaseUrl/healthz")) {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 $url
        if ($response.StatusCode -notin @(200, 302)) { throw "service unavailable: $url" }
    }

    $adminToken = Get-Token -Username $AdminUsername -Password $AdminPassword
    $adminHeaders = @{ Authorization = "Bearer $adminToken" }
    $users = Invoke-Json -Method "GET" -Url "$ApiBaseUrl/api/identity/users" -Body $null -Headers $adminHeaders
    $admin = $users.data | Where-Object { $_.username -eq $AdminUsername } | Select-Object -First 1
    if ($null -eq $admin -or $admin.roleIds.Count -eq 0) { throw "the E2E admin needs at least one local role" }

    $suffix = [Guid]::NewGuid().ToString("N").Substring(0, 12)
    $testUsername = "agent-e2e-$suffix"
    $testPassword = "E2E-$suffix!"
    $createdUser = Invoke-Json -Method "POST" -Url "$ApiBaseUrl/api/identity/users" -Headers $adminHeaders -Body @{
        username = $testUsername; password = $testPassword; displayName = "Agent E2E $suffix"; roleIds = @($admin.roleIds)
    }
    $testUserId = [string]$createdUser.data.id
    if (-not $testUserId) { throw "test user was not created" }
    $testToken = Get-Token -Username $testUsername -Password $testPassword
    $testHeaders = @{ Authorization = "Bearer $testToken" }
    # Session initialization resolves the user's model route but does not make
    # an LLM call. Point it at a closed local port so this test can never use a
    # real provider credential or produce a billable model request.
    $testRoute = Invoke-Json -Method "POST" -Url "$ApiBaseUrl/api/settings/model-routes" -Headers $testHeaders -Body @{
        name = "Agent Workbench E2E"; apiBaseUrl = "http://127.0.0.1:1"; apiKey = "e2e-no-network"; defaultChatModel = "e2e-model"; models = @("e2e-model"); enabled = $true; isDefault = $true
    }
    $testModelRouteId = [string]$testRoute.data.id
    if (-not $testModelRouteId) { throw "test model route was not created" }

    $employees = Invoke-Json -Method "GET" -Url "$ApiBaseUrl/api/agent/runtime-employees" -Body $null -Headers $testHeaders
    $employeeId = [string]$employees.data[0].id
    if (-not $employeeId) { throw "no runtime AI employee is available to the test user" }
    $created = Invoke-Json -Method "POST" -Url "$AgentBaseUrl/api/agent/dsh" -Headers $testHeaders -Body @{
        type = "client-request"; rpcId = "e2e-create-$suffix"; method = "session.create"; payload = @{ agentId = $employeeId; source = "e2e" }
    }
    if (-not $created.result.ok) { throw "DSH session.create failed: $($created.result.error.message)" }
    $testSessionId = [string]$created.result.value.sessionId
    if (-not $testSessionId) { throw "DSH did not return the Rust session UUID" }

    # This route is deliberately a closed local port, so this assertion proves
    # the YaYa session route is selected without invoking or billing a real
    # model provider. A historical regression selected DSH's global
    # deepseek-official default here and failed with MISSING_CREDENTIAL before
    # the configured BYOM route was ever attempted.
    $prompted = Invoke-Json -Method "POST" -Url "$AgentBaseUrl/api/agent/dsh" -Headers $testHeaders -Body @{
        type = "client-request"; rpcId = "e2e-prompt-$suffix"; method = "session.prompt"; payload = @{
            sessionId = $testSessionId; mode = "queue"; content = @(@{ type = "text"; text = "route verification" })
        }
    }
    if (-not $prompted.result.ok) { throw "DSH session.prompt was rejected: $($prompted.result.error.message)" }
    $history = $null
    $promptDeadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $promptDeadline) {
        Start-Sleep -Milliseconds 300
        $history = Invoke-Json -Method "POST" -Url "$AgentBaseUrl/api/agent/dsh" -Headers $testHeaders -Body @{
            type = "client-request"; rpcId = "e2e-history-$suffix"; method = "session.history"; payload = @{ sessionId = $testSessionId; maxMessages = 100 }
        }
        $events = @($history.result.value.events | ForEach-Object { $_.event } | Where-Object { $null -ne $_ })
        $requestHeader = $events | Where-Object { $_.type -eq "request/header" } | Select-Object -Last 1
        if ($null -ne $requestHeader) { break }
    }
    if ($null -eq $requestHeader -or $requestHeader.data.header.config.provider -notlike "yaya-byom-*" -or $requestHeader.data.header.config.model -ne "e2e-model") {
        throw "first YaYa prompt did not use its owner-bound BYOM route"
    }
    # Do not wait through the deliberately unreachable model route's retry
    # budget. End the synthetic run, then wait for its terminal event so the
    # test's archive cleanup exercises the same terminal-only rule as the UI.
    $cancelled = Invoke-Json -Method "POST" -Url "$AgentBaseUrl/api/agent/dsh" -Headers $testHeaders -Body @{
        type = "client-request"; rpcId = "e2e-cancel-$suffix"; method = "session.cancel"; payload = @{ sessionId = $testSessionId }
    }
    if (-not $cancelled.result.ok) { throw "DSH session.cancel was rejected: $($cancelled.result.error.message)" }
    $terminalDeadline = (Get-Date).AddSeconds(10)
    $terminal = $false
    while ((Get-Date) -lt $terminalDeadline) {
        Start-Sleep -Milliseconds 200
        $history = Invoke-Json -Method "POST" -Url "$AgentBaseUrl/api/agent/dsh" -Headers $testHeaders -Body @{
            type = "client-request"; rpcId = "e2e-terminal-history-$suffix"; method = "session.history"; payload = @{ sessionId = $testSessionId; maxMessages = 100 }
        }
        $terminal = @($history.result.value.events | ForEach-Object { $_.event } | Where-Object { $_.type -eq "turn/end" }).Count -gt 0
        if ($terminal) { break }
    }
    if (-not $terminal) { throw "synthetic prompt did not reach a terminal state after cancellation" }

    $ownerDirectory = Invoke-Json -Method "GET" -Url "$ApiBaseUrl/api/agent/workbench/sessions?limit=100" -Body $null -Headers $testHeaders
    if (-not ($ownerDirectory.data.items.id -contains $testSessionId)) { throw "created session is absent from its owner's Rust directory" }
    $adminDirectory = Invoke-Json -Method "GET" -Url "$ApiBaseUrl/api/agent/workbench/sessions?limit=100" -Body $null -Headers $adminHeaders
    if ($adminDirectory.data.items.id -contains $testSessionId) { throw "a second user can see the test owner's session" }

    $denied = Invoke-Json -Method "POST" -Url "$AgentBaseUrl/api/agent/dsh" -Headers $adminHeaders -Body @{
        type = "client-request"; rpcId = "e2e-denied-$suffix"; method = "session.history"; payload = @{ sessionId = $testSessionId }
    }
    if ($denied.result.ok -or $denied.result.error.message -ne "agent session access denied") { throw "non-owner gateway request was not uniformly denied" }

    $bff = Invoke-Json -Method "POST" -Url "$WebBaseUrl/api/agent/dsh/session.list" -Headers $testHeaders -Body @{ type = "client-request"; rpcId = "e2e-list-$suffix"; method = "session.list"; payload = @{} }
    if (-not $bff.result.ok -or -not ($bff.result.value.items.sessionId -contains $testSessionId)) { throw "Next BFF did not expose the owner's DSH session list" }
    Test-GatewayFrame -Protocol "ws" -ExpectedSessionId $testSessionId -Headers $testHeaders
    Test-GatewayFrame -Protocol "sse" -ExpectedSessionId $testSessionId -Headers $testHeaders

    foreach ($legacyPath in @("/api/agent/sessions/$testSessionId/messages", "/api/agent/sessions/$testSessionId/runtime-status")) {
        $legacy = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -SkipHttpErrorCheck "$WebBaseUrl$legacyPath"
        if ($legacy.StatusCode -ne 404) { throw "legacy route unexpectedly returned $($legacy.StatusCode)" }
    }
    Write-Host "Agent Workbench E2E passed: HTTP, owner isolation, WebSocket, SSE fallback, and legacy-route removal."
} finally {
    if ($testSessionId -and $testToken) {
        try { Invoke-WebRequest -UseBasicParsing -Method DELETE -Uri "$ApiBaseUrl/api/agent/sessions/$testSessionId" -Headers @{ Authorization = "Bearer $testToken" } | Out-Null } catch { Write-Warning "could not archive E2E session ${testSessionId}: $($_.Exception.Message)" }
    }
    if ($testModelRouteId -and $testToken) {
        try { Invoke-WebRequest -UseBasicParsing -Method DELETE -Uri "$ApiBaseUrl/api/settings/model-routes/$testModelRouteId" -Headers @{ Authorization = "Bearer $testToken" } | Out-Null } catch { Write-Warning "could not delete E2E model route ${testModelRouteId}: $($_.Exception.Message)" }
    }
    if ($testUserId -and $adminToken) {
        try { Invoke-WebRequest -UseBasicParsing -Method DELETE -Uri "$ApiBaseUrl/api/identity/users/$testUserId" -Headers @{ Authorization = "Bearer $adminToken" } | Out-Null } catch { Write-Warning "could not delete E2E user ${testUserId}: $($_.Exception.Message)" }
    }
}
