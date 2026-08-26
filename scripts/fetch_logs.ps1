<#
.SYNOPSIS
    Fetches production container logs from the VPS into a versioned dump directory,
    matching the logs_dump_v1 layout (flat .txt files + 00_container_status.txt).

.DESCRIPTION
    Usage:
        pwsh scripts/fetch_logs.ps1                          # -> logs_dump_v3/
        pwsh scripts/fetch_logs.ps1 -OutDir logs_dump_v4     # custom target dir
        pwsh scripts/fetch_logs.ps1 -Tail 20000              # deeper history

    Output layout (v1-compatible):
        <OutDir>/00_container_status.txt   docker ps -a snapshot (fetched FIRST)
        <OutDir>/agent_alpha.txt           agent-alpha container logs
        <OutDir>/agent_beta.txt            agent-beta container logs
        <OutDir>/agent_gamma.txt           agent-gamma container logs
        <OutDir>/brain_broker.txt          brain-broker container logs
        <OutDir>/memory_service.txt        memory-service container logs
        <OutDir>/dashboard.txt             civilization-dashboard container logs
        <OutDir>/minecraft_server.txt      minecraft-paper-server container logs
        <OutDir>/ollama_embeddings.txt     ollama-embeddings container logs

    Robustness rules (fixes the v2 dump problem):
      - Verifies SSH connectivity before any fetch.
      - Only fetches containers that actually exist (no more
        "Error response from daemon: No such container" garbage inside files).
      - A failed fetch writes a clearly-marked failure stub instead of silently
        polluting the log file.
#>
param(
    [string]$Server = "user@100.65.166.23",
    [int]$Tail = 8000,
    [string]$OutDir = ""
)

$ErrorActionPreference = 'Continue'

# ── Target directory (default: next versioned dump) ──────────────────────────
if (-not $OutDir) {
    $existing = Get-ChildItem -Directory -Filter 'logs_dump_v*' -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($_.Name -match '^logs_dump_v(\d+)$') { [int]$matches[1] }
        } | Sort-Object -Descending | Select-Object -First 1
    $nextVer = if ($existing) { $existing + 1 } else { 1 }
    $OutDir = "logs_dump_v$nextVer"
}

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

# ── SSH connectivity pre-flight ───────────────────────────────────────────────
$sshOpts = @('-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
Write-Host "[pre-flight] Testing SSH to $Server ..."
ssh @sshOpts $Server "echo ok" *>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FATAL] Cannot reach $Server over SSH. Aborting — no files written." -ForegroundColor Red
    exit 1
}
Write-Host "[pre-flight] SSH OK." -ForegroundColor Green

function Invoke-SshLogFetch {
    param([string]$Container, [string]$DestFile)

    # Skip containers that do not exist at all
    $existsCmd = "docker inspect --format '{{.State.Status}}' $Container 2>/dev/null || echo __MISSING__"
    $state = ssh @sshOpts $Server $existsCmd
    if ($LASTEXITCODE -ne 0 -or "$state".Trim() -eq '__MISSING__') {
        Write-Host "  [SKIP] '$Container' not found on host." -ForegroundColor Yellow
        return
    }

    Write-Host "  [FETCH] $Container -> $DestFile (tail: $Tail, state: $(("$state").Trim()))"
    $cmd = "docker logs --timestamps --tail $Tail $Container 2>&1"
    $logContent = ssh @sshOpts $Server $cmd

    if ($LASTEXITCODE -ne 0 -or ("$logContent" -match 'No such container|Error response from daemon')) {
        $stub = @(
            "=== FETCH FAILED for container '$Container' at $(Get-Date -Format o) ===",
            "ssh exit code: $LASTEXITCODE",
            ($logContent | Select-Object -First 5)
        )
        [System.IO.File]::WriteAllLines((Join-Path $OutDir $DestFile), $stub, [System.Text.Encoding]::UTF8)
        Write-Host "  [WARN ] wrote failure stub for $DestFile" -ForegroundColor Yellow
        return
    }

    [System.IO.File]::WriteAllLines((Join-Path $OutDir $DestFile), $logContent, [System.Text.Encoding]::UTF8)
}

# ── 1. Container status snapshot (always first, like v1's 00_container_status.txt) ──
Write-Host "[status] Capturing docker ps -a snapshot ..."
$statusContent = ssh @sshOpts $Server "docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
[System.IO.File]::WriteAllLines((Join-Path $OutDir '00_container_status.txt'), $statusContent, [System.Text.Encoding]::UTF8)

# ── 2. Per-container log dumps (v1 naming convention) ─────────────────────────
$map = [ordered]@{
    'agent-alpha'            = 'agent_alpha.txt'
    'agent-beta'             = 'agent_beta.txt'
    'agent-gamma'            = 'agent_gamma.txt'
    'agent-delta'            = 'agent_delta.txt'
    'agent-echo'             = 'agent_echo.txt'
    'agent-golf'             = 'agent_golf.txt'
    'agent-hotel'            = 'agent_hotel.txt'
    'brain-broker'           = 'brain_broker.txt'
    'memory-service'         = 'memory_service.txt'
    'civilization-dashboard' = 'dashboard.txt'
    'minecraft-paper-server' = 'minecraft_server.txt'
    'ollama-embeddings'      = 'ollama_embeddings.txt'
}

foreach ($entry in $map.GetEnumerator()) {
    Invoke-SshLogFetch -Container $entry.Key -DestFile $entry.Value
}

# ── 3. Summary ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Done! Dump written to ${OutDir}:" -ForegroundColor Green
Get-ChildItem $OutDir | ForEach-Object {
    "{0,-28} {1,10:N0} bytes" -f $_.Name, $_.Length
}
