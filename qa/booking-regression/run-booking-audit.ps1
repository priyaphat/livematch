[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DatabaseUrl,
    [string]$AdminId = '',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$resolvedOutput = if ($OutputPath) {
    $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
} else { '' }

if ($DatabaseUrl -notmatch '^postgres(ql)?://') {
    throw 'DatabaseUrl must be an explicit PostgreSQL connection string'
}

$env:AUDIT_DATABASE_URL = $DatabaseUrl
$env:AUDIT_ADMIN_ID = $AdminId
try {
    Push-Location (Join-Path $repoRoot 'backend')
    try {
        $previousNativePreference = $PSNativeCommandUseErrorActionPreference
        $PSNativeCommandUseErrorActionPreference = $false
        try {
            $output = (& go run ./cmd/booking-audit 2>&1) -join [Environment]::NewLine
            $auditExitCode = $LASTEXITCODE
        } finally {
            $PSNativeCommandUseErrorActionPreference = $previousNativePreference
        }
        if ($resolvedOutput) {
            Set-Content -LiteralPath $resolvedOutput -Value $output -Encoding utf8
        }
        $output
        if ($auditExitCode -ne 0) { throw "Booking audit failed with exit code $auditExitCode" }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:AUDIT_DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:AUDIT_ADMIN_ID -ErrorAction SilentlyContinue
}

