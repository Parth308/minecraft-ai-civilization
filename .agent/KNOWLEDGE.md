# Workspace Knowledge Base & Architecture Index

This file maintains the full architectural map, tech stack details, file map, and function catalog for the Minecraft AI Civilization project.

---

## 1. Tech Stack Summary
- **Runtime**: Node.js (CommonJS modules)
- **Game Engine Bot Client**: `mineflayer` (^4.20.1)
- **Pathfinding Engine**: `mineflayer-pathfinder` (^2.4.5) with A* 3D navigation
- **Minecraft Server**: Paper Minecraft Server 1.20.4 (`itzg/minecraft-server` in Docker, `online-mode=false`)
- **HTTP Services**:
  - Brain Broker Service (`broker/index.js` on port 3001)
  - Central Memory Service (`memory-service/index.js` on port 3002)
- **LLM Provider Pool**:
  - **Gemini Flash**: `gemini-2.5-flash` (Primary for complex reasoning, emotions, and Tier 2 memory consolidation)
  - **Groq**: `llama-3.1-8b-instant` (Primary for fast chat dialogue, reflexes, and Tier 1 buffer compaction)
  - **Cerebras**: `llama3.1-8b` (Backup provider)
  - **OpenRouter Free**: `meta-llama/llama-3.1-8b-instruct:free` (Failover provider)
- **Caching**: SHA-256 exact-match state hashing with 300s TTL (`broker/cache/exactCache.js`)
- **Memory System**: Sectioned Markdown store (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`) with two-tier compaction (Tier 1 buffer compaction via Groq, Tier 2 section consolidation via Gemini Flash).

---

## 2. Directory Structure & Module Index

### Core Agent (`agent/`)
- **[`agent/config.js`](file:///e:/Projects/minecraft-community/agent/config.js)**: Configuration loader (`MC_HOST`, `MC_PORT`, `MC_USERNAME`, `CONFIDENCE_THRESHOLD=0.6`).
- **[`agent/index.js`](file:///e:/Projects/minecraft-community/agent/index.js)**: Entrypoint: instantiates bot, perception, actuators, stats engine, event buffer, memory client, and main 1s tick loop (`setInterval`).

#### Perception (`agent/perception/`)
- **[`agent/perception/senses.js`](file:///e:/Projects/minecraft-community/agent/perception/senses.js)**: `Senses` class (`getNearbyMobs`, `getNearbyHostileMobs`, `getNearbyPlayers`, `getNearbyBlock`, `getNearbyBed`, `isNight`, `getInventoryFood`).
- **[`agent/perception/events.js`](file:///e:/Projects/minecraft-community/agent/perception/events.js)**: `EventObserver` (EventEmitter): Normalizes raw Mineflayer events into `agentHurt`, `playerChat`, `underAttack`.

#### Actuation (`agent/actuation/`)
- **[`agent/actuation/movement.js`](file:///e:/Projects/minecraft-community/agent/actuation/movement.js)**: `MovementActuator`: `goto`, `gotoBlock`, `fleeFrom`, `wander`, `stop`, `isMoving`.
- **[`agent/actuation/chat.js`](file:///e:/Projects/minecraft-community/agent/actuation/chat.js)**: `ChatActuator`: `say`, `whisper`.
- **[`agent/actuation/combat.js`](file:///e:/Projects/minecraft-community/agent/actuation/combat.js)**: `CombatActuator`: `attack`, `stopCombat`.
- **[`agent/actuation/inventory.js`](file:///e:/Projects/minecraft-community/agent/actuation/inventory.js)**: `InventoryActuator`: `eatFood`, `listInventory`.

#### Stats Engine (`agent/stats/`) — Zero LLM
- **[`agent/stats/stats.js`](file:///e:/Projects/minecraft-community/agent/stats/stats.js)**: `StatsManager` (`health`, `hunger`, `anger`, `happiness`, `fatigue`).
- **[`agent/stats/decay.js`](file:///e:/Projects/minecraft-community/agent/stats/decay.js)**: `StatsDecayEngine`: `tick()` updates hunger, fatigue, anger, and happiness every second.
- **[`agent/stats/relationships.js`](file:///e:/Projects/minecraft-community/agent/stats/relationships.js)**: `RelationshipTracker`: Tracks `trust` and `affinity` per player.

#### Decision Engine (`agent/decision/`)
- **[`agent/decision/confidence.js`](file:///e:/Projects/minecraft-community/agent/decision/confidence.js)**: `ConfidenceEvaluator`: Checks if confidence < threshold (`0.6`).
- **[`agent/decision/rules/`](file:///e:/Projects/minecraft-community/agent/decision/rules/)**: `eat.js`, `flee.js`, `fight.js`, `sleep.js`, `mine.js`, `explore.js`, `trade.js`.
- **[`agent/decision/dynamicRules.js`](file:///e:/Projects/minecraft-community/agent/decision/dynamicRules.js)**: `DynamicRuleEngine`: Replicates LLM decisions into local dynamic rules with confidence `0.85`.
- **[`agent/decision/tree.js`](file:///e:/Projects/minecraft-community/agent/decision/tree.js)**: `DecisionTree`: Evaluates static + dynamic rules, selects top action, and escalates to Brain Broker if confidence < `0.6`.
- **[`agent/decision/escalate.js`](file:///e:/Projects/minecraft-community/agent/decision/escalate.js)**: `EscalationManager`: Dispatches low-confidence payloads to `BrainClient`.

#### Memory Client (`agent/memory/`)
- **[`agent/memory/buffer.js`](file:///e:/Projects/minecraft-community/agent/memory/buffer.js)**: `EventBuffer`: In-memory rolling buffer (max capacity 20) with automatic flush on overflow.
- **[`agent/memory/client.js`](file:///e:/Projects/minecraft-community/agent/memory/client.js)**: `MemoryClient`: Sends buffer flushes to `POST /api/memory/compact` and queries memories via `GET /api/memory/query`.

#### Brain Broker Client (`agent/brain-client/`)
- **[`agent/brain-client/client.js`](file:///e:/Projects/minecraft-community/agent/brain-client/client.js)**: `BrainClient`: Issues `POST /api/escalate` to central Brain Broker service.

---

### Central Brain Broker Service (`broker/`)
- **[`broker/index.js`](file:///e:/Projects/minecraft-community/broker/index.js)**: Express REST server (`GET /health`, `POST /api/escalate`).
- **[`broker/config.js`](file:///e:/Projects/minecraft-community/broker/config.js)**: Loads API keys and port (`3001`).
- **[`broker/router.js`](file:///e:/Projects/minecraft-community/broker/router.js)**: `ProviderRouter`: Implements task-type model preference order (`Groq` for `CHAT`/`REFLEX`, `Gemini` for `REASONING`/`EMOTION`), handles round-robin, failover on HTTP 429, injects retrieved memories, and parses JSON output with `emotionDelta`.
- **[`broker/rateLimiter.js`](file:///e:/Projects/minecraft-community/broker/rateLimiter.js)**: Tracks 60s provider cooldowns on rate limit errors.
- **[`broker/cache/exactCache.js`](file:///e:/Projects/minecraft-community/broker/cache/exactCache.js)**: `ExactCache`: SHA-256 exact-match state hash cache with 300s TTL.
- **[`broker/providers/`](file:///e:/Projects/minecraft-community/broker/providers/)**: `gemini.js`, `groq.js`, `cerebras.js`, `openrouter.js`.

---

### Central Memory Service (`memory-service/`)
- **[`memory-service/index.js`](file:///e:/Projects/minecraft-community/memory-service/index.js)**: Express REST server on port `3002` (`/api/memory/compact`, `/api/memory/consolidate`, `/api/memory/query`, `/health`).
- **[`memory-service/config.js`](file:///e:/Projects/minecraft-community/memory-service/config.js)**: Port (`3002`), store path (`store/agents/`), soft caps (~3KB/section), and scheduler intervals (5 min).
- **[`memory-service/sections/schema.js`](file:///e:/Projects/minecraft-community/memory-service/sections/schema.js)**: Defines section files (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`), markdown frontmatter parser & writer.
- **[`memory-service/router.js`](file:///e:/Projects/minecraft-community/memory-service/router.js)**: Zero-LLM event router categorizing events into section files.
- **[`memory-service/sections/compactor.js`](file:///e:/Projects/minecraft-community/memory-service/sections/compactor.js)**: Two-tier compaction engine (Tier 1 buffer summarizer via Groq, Tier 2 section consolidation via Gemini Flash).
- **[`memory-service/scheduler.js`](file:///e:/Projects/minecraft-community/memory-service/scheduler.js)**: Background sweep scheduler monitoring file sizes and triggering Tier 2 consolidation passes.

---

### Shared Utilities (`shared/`)
- **[`shared/logger.js`](file:///e:/Projects/minecraft-community/shared/logger.js)**: Standardized formatted console logging.
- **[`shared/constants.js`](file:///e:/Projects/minecraft-community/shared/constants.js)**: Action enum (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `WANDER`, `IDLE`, `TRADE`, `EXPLORE`, `BUILD`, `TALK`) and stat ranges.
