#!/usr/bin/env bash
# Deploy FreeLLMAPI alongside the civ stack and seed it with keys already
# present in ~/minecraft-ai-civilization/.env. Idempotent: re-running updates
# the same container/config. Prints the unified API key at the end.
set -euo pipefail

ENV_FILE="$HOME/minecraft-ai-civilization/.env"
NETWORK="minecraft-ai-civilization_minecraft-network"
IMAGE="ghcr.io/tashfeenahmed/freellmapi:latest"

get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r'; }

GROQ="$(get GROQ_API_KEY)"
GOOGLE="$(get GEMINI_API_KEY)"
MISTRAL="$(get MISTRAL_API_KEY)"
NVIDIA="$(get NVIDIA_API_KEY)"
OPENROUTER="$(get OPENROUTER_API_KEY)"
CLOUDFLARE="$(get CLOUDFLARE_API_TOKEN)"
COHERE="$(get COHERE_API_KEY)"
HF="$(get HF_TOKEN)"

CONFIG_JSON="$(python3 - "$GROQ" "$GOOGLE" "$MISTRAL" "$NVIDIA" "$OPENROUTER" "$CLOUDFLARE" "$COHERE" "$HF" <<'PYEOF'
import json, sys
groq, google, mistral, nvidia, openrouter, cloudflare, cohere, hf = sys.argv[1:9]
keys = []
for platform, key in [("groq", groq), ("google", google), ("mistral", mistral),
                      ("nvidia", nvidia), ("openrouter", openrouter),
                      ("cloudflare", cloudflare), ("cohere", cohere),
                      ("huggingface", hf)]:
    if key:
        keys.append({"platform": platform, "key": key, "enabled": True})
cfg = {"keys": keys, "routing": {"strategy": "balanced"}}
print(json.dumps(cfg))
PYEOF
)"

echo "[freellm] keys seeded: $(echo "$CONFIG_JSON" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["keys"]))')"

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "[freellm] FATAL: network $NETWORK not found"; exit 1
fi

docker rm -f freellmapi >/dev/null 2>&1 || true
ENCRYPTION_KEY="$(openssl rand -hex 32)"

# Persist encryption key so restarts can decrypt stored provider keys
grep -q '^FREELLMAPI_ENCRYPTION_KEY=' "$ENV_FILE" || echo "FREELLMAPI_ENCRYPTION_KEY=$ENCRYPTION_KEY" >> "$ENV_FILE"
ENCRYPTION_KEY="$(get FREELLMAPI_ENCRYPTION_KEY)"

docker run -d --name freellmapi --restart unless-stopped \
  --network "$NETWORK" \
  -p 127.0.0.1:3100:3001 \
  -e ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  -e FREEAPI_CONFIG_JSON="$CONFIG_JSON" \
  "$IMAGE"

echo "[freellm] waiting for health..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3100/v1/models >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "[freellm] extracting unified API key..."
UNIFIED_KEY="$(docker exec freellmapi node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('/app/server/data/freeapi.db');
const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r=>r.name);
let key = null;
for (const t of ['api_keys','tokens','unified_keys','auth_tokens']) {
  if (!tables.includes(t)) continue;
  try {
    const row = db.prepare('SELECT * FROM ' + t + ' LIMIT 5').all();
    console.error(t + ': ' + JSON.stringify(row).slice(0,400));
  } catch {}
}
try {
  const rows = db.prepare(\"SELECT * FROM api_keys\").all();
  const k = rows.find(r => JSON.stringify(r).includes('freellmapi-'));
  if (k) key = Object.values(k).find(v => String(v).includes('freellmapi-'));
} catch {}
if (!key) { console.log('__NOT_FOUND__ tables=' + tables.join(',')); }
else { console.log(key); }
")"

echo "=================================================="
if [ "$UNIFIED_KEY" != "__NOT_FOUND__" ] && [ -n "$UNIFIED_KEY" ]; then
  echo "UNIFIED_KEY=$UNIFIED_KEY"
  grep -q '^FREELLMAPI_KEY=' "$ENV_FILE" && sed -i "s|^FREELLMAPI_KEY=.*|FREELLMAPI_KEY=$UNIFIED_KEY|" "$ENV_FILE" || echo "FREELLMAPI_KEY=$UNIFIED_KEY" >> "$ENV_FILE"
  echo "[freellm] wrote FREELLMAPI_KEY into .env"
else
  echo "Unified key not auto-extracted. Inspect manually:"
  echo "  docker exec freellmapi node -e \"console.log(require('fs').readdirSync('/app/server/data'))\""
fi
echo "Dashboard (SSH tunnel): ssh -L 3100:127.0.0.1:3100 user@server -> http://localhost:3100"
