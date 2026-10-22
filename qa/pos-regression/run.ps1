[CmdletBinding()]
param(
    [ValidateSet('smoke', 'cross-system', 'full')]
    [string]$Suite = 'smoke',
    [switch]$CI,
    [switch]$KeepStack
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$composeFile = Join-Path $repoRoot 'qa/docker-compose.qa.yml'
$qaDirectory = Join-Path $repoRoot 'qa/pos-regression'
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
    $commit = (& git -C $repoRoot rev-parse --short HEAD 2>$null) -join ''
    if (-not $commit) { $commit = 'unknown' }
    $knownIssuesPath = Join-Path $qaDirectory 'known-issues.md'
    $knownIssueCount = 0
    if (Test-Path $knownIssuesPath) {
        $knownIssueCount = [math]::Max(0, @((Get-Content -LiteralPath $knownIssuesPath) | Where-Object { $_ -match '^\|' }).Count - 2)
    }
    $content = @(
        "# POS QA Result — $($finishedAt.ToString('yyyy-MM-dd HH:mm:ss zzz'))",
        '',
        "- Commit: $commit",
        "- Suite: $Suite",
        '- Environment: isolated Docker QA (livematch_qa, ports 5273/5275/8182/5534)',
        '- Browser matrix: Chromium Desktop/Mobile ตาม suite และ WebKit smoke',
        "- Started: $($startedAt.ToString('o'))",
        "- Duration: $duration seconds",
        "- Result: $result",
        '- Development/Production database touched: NO',
        '- Real payment performed: NO',
        "- Known issues: $knownIssueCount (ดู qa/pos-regression/known-issues.md)",
        '',
        '## Failure',
        '',
        $failure,
        '',
        '## Artifacts',
        '',
        '- Playwright HTML: qa/pos-regression/artifacts/html-report/',
        '- JUnit: qa/pos-regression/artifacts/junit.xml',
        '- Screenshot/video/trace on failure: qa/pos-regression/artifacts/test-results/'
    ) -join [Environment]::NewLine
    $resultDir = Join-Path $qaDirectory 'results'
    Set-Content -LiteralPath (Join-Path $resultDir 'latest.md') -Value $content -Encoding utf8
    $stamp = $startedAt.ToString('yyyyMMdd-HHmmss')
    Set-Content -LiteralPath (Join-Path $resultDir "run-$stamp-$Suite.md") -Value $content -Encoding utf8
}

try {
    if ($qaDatabaseUrl -notmatch ':5534/livematch_qa\?') {
        throw 'QA database safety check failed: expected port 5534 and database livematch_qa'
    }

    Write-Host "[QA] Reset isolated stack ($projectName)" -ForegroundColor Cyan
    & docker compose -p $projectName -f $composeFile down --volumes --remove-orphans
    & docker compose -p $projectName -f $composeFile up -d --build

    Wait-QAEndpoint -Url 'http://localhost:8182/health'
    Wait-QAEndpoint -Url 'http://localhost:5273/'
    Wait-QAEndpoint -Url 'http://localhost:5275/'

    Write-Host '[QA] Seed deterministic QA data' -ForegroundColor Cyan
    $env:DATABASE_URL = $qaDatabaseUrl
    $env:LIVEMATCH_TEST_DATABASE_URL = $qaDatabaseUrl
    Invoke-InDirectory (Join-Path $repoRoot 'backend') { go run ./cmd/qa-seed }

    Invoke-InDirectory $qaDirectory {
        if (Test-Path 'package-lock.json') { npm ci } else { npm install }
        npm run validate:cases
        if (-not $CI) { npx playwright install chromium webkit }
    }

    if ($Suite -in @('smoke', 'full')) {
        Write-Host '[QA] Backend unit + PostgreSQL integration' -ForegroundColor Cyan
        Invoke-InDirectory (Join-Path $repoRoot 'backend') { go test ./... }

        Write-Host '[QA] Match Vitest' -ForegroundColor Cyan
        Invoke-InDirectory (Join-Path $repoRoot 'frontend') { npm test -- --run }

        Write-Host '[QA] POS typecheck + build' -ForegroundColor Cyan
        Invoke-InDirectory (Join-Path $repoRoot 'pos') { npm run lint; npm run build }
    }

    Write-Host "[QA] Playwright suite: $Suite" -ForegroundColor Cyan
    Invoke-InDirectory $qaDirectory {
        if ($Suite -eq 'smoke') {
            npx playwright test --project=chromium-desktop --grep '@smoke'
            npx playwright test --project=webkit-smoke
        } elseif ($Suite -eq 'cross-system') {
            npx playwright test --project=chromium-desktop --grep '@cross-system'
        } else {
            npx playwright test
        }
    }

    if ($Suite -eq 'full') {
        Write-Host '[QA] Read-only stock ledger reconciliation' -ForegroundColor Cyan
        $env:AUDIT_DATABASE_URL = $qaDatabaseUrl
        $env:AUDIT_ADMIN_ID = ''
        try {
            Invoke-InDirectory (Join-Path $repoRoot 'backend') { go run ./cmd/stock-audit }
        } finally {
            Remove-Item Env:AUDIT_DATABASE_URL -ErrorAction SilentlyContinue
            Remove-Item Env:AUDIT_ADMIN_ID -ErrorAction SilentlyContinue
        }
    }

    $result = 'PASS'
} catch {
    $failure = $_.Exception.Message
    Write-Error "POS QA $Suite failed: $failure"
} finally {
    Write-QAResult
    if (-not $KeepStack) {
        Write-Host '[QA] Destroy isolated QA stack and volume' -ForegroundColor Cyan
        & docker compose -p $projectName -f $composeFile down --volumes --remove-orphans
    } else {
        Write-Host '[QA] Stack kept for inspection: POS http://localhost:5275' -ForegroundColor Yellow
    }
}

if ($result -ne 'PASS') { exit 1 }
Write-Host "[QA] $Suite PASS" -ForegroundColor Green
