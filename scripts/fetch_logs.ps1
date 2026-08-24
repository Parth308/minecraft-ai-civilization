param(
    [string]$Server = "user@100.65.166.23",
    [int]$Tail = 8000
)

$targetDir = "logs\server_logs_current"
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

$containers = @(
    "agent-alpha",
    "agent-beta",
    "agent-gamma",
    "brain-broker",
    "memory-service",
    "minecraft-paper-server",
    "civilization-dashboard",
    "ollama-embeddings"
)

foreach ($c in $containers) {
    Write-Host "Fetching logs for $c (tail: $Tail)..."
    $cmd = "docker logs --timestamps --tail $Tail $c"
    $logContent = ssh -o StrictHostKeyChecking=no $Server $cmd 2>&1
    [System.IO.File]::WriteAllLines("$targetDir\$c.log", $logContent, [System.Text.Encoding]::UTF8)
}

Write-Host "Done! Files in ${targetDir}:"
Get-ChildItem $targetDir
