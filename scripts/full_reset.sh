#!/usr/bin/env bash
# CANONICAL full sim reset (world + memories -> zero). Code is preserved.
# Usage: bash scripts/full_reset.sh    (run from VPS repo root)
set -uo pipefail
cd "$(dirname "$0")/.."

echo "[1/6] stop sims (ollama stays up)"
docker compose stop agent-alpha agent-beta agent-gamma agent-delta agent-echo agent-golf agent-hotel minecraft-server dashboard brain-broker memory-service >/dev/null 2>&1
sleep 5

echo "[2/6] wipe RUNTIME data only (tracked code files survive)"
docker run --rm -v "$(pwd)/memory-service/store:/store" alpine sh -c "
  rm -rf /store/agents
  rm -f  /store/civilization/ledger.json /store/world_discoveries.json /store/vectorIndex.snapshot.json* /store/vectorIndex.snapshot.json.tmp
  mkdir -p /store/agents /store/civilization
"
docker run --rm -v "$(pwd)/minecraft-server:/data" alpine \
  sh -c "rm -rf /data/world /data/world_nether /data/world_the_end"
docker run --rm -v "$(pwd)/logs:/lg" alpine \
  sh -c "rm -rf /lg/agents /lg/world && mkdir -p /lg/agents /lg/world"
docker run --rm -v "$(pwd)/memory-service/store:/store" alpine chown -R 1000:1000 /store
echo "    wiped"

echo "[3/6] infra boot, gated on memory-service health"
docker compose up -d memory-service >/dev/null
ST=none
for i in $(seq 1 40); do
  ST=$(docker inspect -f '{{.State.Health.Status}}' memory-service 2>/dev/null || echo none)
  [ "$ST" = "healthy" ] && break
  sleep 4
done
[ "$ST" = "healthy" ] || { echo "FATAL: memory-service unhealthy"; exit 1; }
docker compose up -d brain-broker minecraft-server >/dev/null

echo "[4/6] world gen + phantom guard"
for i in $(seq 1 90); do
  docker exec minecraft-paper-server rcon-cli gamerule doInsomnia false >/dev/null 2>&1 && break
  sleep 5
done
docker exec minecraft-paper-server rcon-cli gamerule doInsomnia false

echo "[5/6] dashboard (post-paper so SpectatorBot boots against live server) + agents"
docker compose up -d dashboard >/dev/null
docker compose up -d --build agent-alpha agent-beta agent-gamma agent-delta agent-echo agent-golf agent-hotel >/dev/null
sleep 30

echo "[6/6] state"
docker compose ps --format '{{.Name}} {{.Status}}' | sort
curl -s localhost:3001/api/stats | python3 -c "import json,sys; print('broker calls:', json.load(sys.stdin)['totals']['calls'])"
ls memory-service/store/agents/
echo "=== RESET COMPLETE ==="
