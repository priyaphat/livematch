[CmdletBinding()]
param(
    [switch]$KeepStack
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$composeFile = Join-Path $repoRoot 'qa/docker-compose.qa.yml'
$qaDatabaseUrl = 'postgres://livematch_qa:livematch_qa_only@localhost:5534/livematch_qa?sslmode=disable'
$projectName = 'livematch-pos-qa'
$startedAt = Get-Date
$result = 'FAIL'
$failure = ''

function Invoke-InDirectory {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][scriptblock]$Action)
    Push-Location $Path
    try { & $Action } finally { Pop-Location }
}

function Wait-QAEndpoint {
    param([Parameter(Mandatory)][string]$Url, [int]$TimeoutSeconds = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch { Start-Sleep -Seconds 2 }
    } while ((Get-Date) -lt $deadline)
    throw "QA endpoint did not become ready: $Url"
}

function Write-QAResult {
    $finishedAt = Get-Date
    $duration = [math]::Round(($finishedAt - $startedAt).TotalSeconds, 1)
    $content = @(
        "# Booking QA Result — $($finishedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))",
        '',
        '- Environment: isolated Docker QA (livematch_qa, ports 5273/5275/8182/5534)',
        "- Started: $($startedAt.ToString('o'))",
        "- Duration: $duration seconds",
        "- Result: $result",
        '- Development/Production database touched: NO',
        '- Real payment performed: NO',
        '',
        '## Failure',
        '',
        $failure
    ) -join [Environment]::NewLine
    $resultDir = Join-Path $PSScriptRoot 'results'
    if (-not (Test-Path $resultDir)) { New-Item -ItemType Directory -Path $resultDir | Out-Null }
    Set-Content -LiteralPath (Join-Path $resultDir 'latest.md') -Value $content -Encoding utf8
    Set-Content -LiteralPath (Join-Path $resultDir "run-$($startedAt.ToString('yyyyMMdd-HHmmss')).md") -Value $content -Encoding utf8
}

try {
    if ($qaDatabaseUrl -notmatch ':5534/livematch_qa\?') {
        throw 'QA database safety check failed'
    }
    Write-Host '[Booking QA] Reset isolated stack' -ForegroundColor Cyan
    & docker compose -p $projectName -f $composeFile down --volumes --remove-orphans
    & docker compose -p $projectName -f $composeFile up -d --build
    Wait-QAEndpoint -Url 'http://localhost:8182/health'
    Wait-QAEndpoint -Url 'http://localhost:5273/'

    $env:DATABASE_URL = $qaDatabaseUrl
    $env:LIVEMATCH_TEST_DATABASE_URL = $qaDatabaseUrl
    Invoke-InDirectory (Join-Path $repoRoot 'backend') { go run ./cmd/qa-seed }

    Write-Host '[Booking QA] Go unit + PostgreSQL integration' -ForegroundColor Cyan
    Invoke-InDirectory (Join-Path $repoRoot 'backend') { go test ./... }

    Write-Host '[Booking QA] Vue/Vitest booking, security, report and regression tests' -ForegroundColor Cyan
    Invoke-InDirectory (Join-Path $repoRoot 'frontend') { npm test -- --run; npm run build }

    Write-Host '[Booking QA] Read-only booking reconciliation' -ForegroundColor Cyan
    $env:AUDIT_DATABASE_URL = $qaDatabaseUrl
    $env:AUDIT_ADMIN_ID = ''
    try {
        Invoke-InDirectory (Join-Path $repoRoot 'backend') { go run ./cmd/booking-audit }
    } finally {
        Remove-Item Env:AUDIT_DATABASE_URL -ErrorAction SilentlyContinue
        Remove-Item Env:AUDIT_ADMIN_ID -ErrorAction SilentlyContinue
    }
    $result = 'PASS'
} catch {
    $failure = $_.Exception.Message
    Write-Error "Booking QA failed: $failure"
} finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:LIVEMATCH_TEST_DATABASE_URL -ErrorAction SilentlyContinue
    Write-QAResult
    if (-not $KeepStack) {
        & docker compose -p $projectName -f $composeFile down --volumes --remove-orphans
    } else {
        Write-Host '[Booking QA] Stack kept: http://localhost:5273/booking/qa-booking-a' -ForegroundColor Yellow
    }
}

if ($result -ne 'PASS') { exit 1 }
Write-Host '[Booking QA] full PASS' -ForegroundColor Green

