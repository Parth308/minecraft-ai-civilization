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
    Write-Host "Fetching logs for $c..."
    $cmd = "docker logs --timestamps --tail 5000 $c"
    ssh -o StrictHostKeyChecking=no user@100.65.166.23 $cmd > "$targetDir\$c.log" 2>&1
}

Write-Host "Done! Files in ${targetDir}:"
Get-ChildItem $targetDir
