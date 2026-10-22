param(
  [string]$BaseURL = "http://localhost:8182",
  [ValidateRange(1,500)][int]$Clients = 20,
  [ValidateRange(5,3600)][int]$DurationSeconds = 60,
  [ValidateRange(1000,60000)][int]$PollIntervalMs = 10000,
  [switch]$Synchronized,
  [switch]$AllowRemote
)

$ErrorActionPreference = "Stop"
$uri = [Uri]$BaseURL
$isLocal = $uri.Host -in @("localhost", "127.0.0.1", "::1")
if (-not $isLocal -and -not $AllowRemote) {
  throw "Remote load test is disabled. Review the target and pass -AllowRemote explicitly."
}
if (-not $isLocal -and (-not $env:POS_IDENTIFIER -or -not $env:POS_SECRET)) {
  throw "Remote load test requires POS_IDENTIFIER and POS_SECRET environment variables."
}

$resultDir = Join-Path $PSScriptRoot "results"
New-Item -ItemType Directory -Force -Path $resultDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$resultFile = Join-Path $resultDir "polling-load-$stamp.json"

$env:BASE_URL = $BaseURL.TrimEnd('/')
$env:CLIENTS = [string]$Clients
$env:DURATION_SECONDS = [string]$DurationSeconds
$env:POLL_INTERVAL_MS = [string]$PollIntervalMs
$env:SYNCHRONIZED = if ($Synchronized) { "true" } else { "false" }
$env:RESULT_FILE = $resultFile
node (Join-Path $PSScriptRoot "load/polling-load.mjs")
exit $LASTEXITCODE
