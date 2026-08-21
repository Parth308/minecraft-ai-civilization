# Workspace Knowledge Base & Architecture Index

This file maintains the full architectural map, tech stack details, file map, and function catalog for the Minecraft AI Civilization project.

---

## 1. Tech Stack Summary
- **Runtime**: Node.js (CommonJS modules)
- **Game Engine Bot Client**: `mineflayer` (^4.20.1)
- **Pathfinding Engine**: `mineflayer-pathfinder` (^2.4.5) with A* 3D navigation
- **Minecraft Server**: Paper Minecraft Server 1.20.4 (`itzg/minecraft-server` in Docker, `online-mode=false`)
- **HTTP Services**: Express.js (`broker/index.js` on port 3001, `memory-service/index.js` on port 3002)
- **LLM Provider Pool**:
  - **Gemini Flash**: `gemini-2.5-flash` (Primary for complex reasoning & emotion updates)
  - **Groq**: `llama-3.1-8b-instant` (Primary for fast chat dialogue & reflexes)
  - **Cerebras**: `llama3.1-8b` (Backup provider)
  - **OpenRouter Free**: `meta-llama/llama-3.1-8b-instruct:free` (Failover provider)
- **Caching**: SHA-256 exact-match state hashing with 300s TTL (`broker/cache/exactCache.js`)

---

## 2. Directory Structure & Module Index

### Core Agent (`agent/`)
- **[`agent/config.js`](file:///e:/Projects/minecraft-community/agent/config.js)**
  - Configuration loader (`MC_HOST`, `MC_PORT`, `MC_USERNAME`, `CONFIDENCE_THRESHOLD=0.6`).
- **[`agent/index.js`](file:///e:/Projects/minecraft-community/agent/index.js)**
  - Entrypoint: instantiates bot, perception, actuators, stats engine, and main 1s tick loop (`setInterval`).

#### Perception (`agent/perception/`)
- **[`agent/perception/senses.js`](file:///e:/Projects/minecraft-community/agent/perception/senses.js)**
  - `Senses` class:
    - `getNearbyMobs(maxDistance=16)`: Finds nearby entities of type mob.
    - `getNearbyHostileMobs(maxDistance=16)`: Filters zombies, skeletons, creepers, etc.
    - `getNearbyPlayers(maxDistance=32)`: Returns nearby human/bot player entities.
    - `getNearbyBlock(blockName, maxDistance=16)`: Searches for specific block coordinates.
    - `getNearbyBed(maxDistance=16)`: Finds nearest bed block.
    - `isNight()`: Checks Minecraft time of day (13000-23000 ticks).
    - `getInventoryFood()`: Scans inventory for edible food items.
- **[`agent/perception/events.js`](file:///e:/Projects/minecraft-community/agent/perception/events.js)**
  - `EventObserver` (EventEmitter): Normalizes raw Mineflayer events into `agentHurt`, `playerChat`, `underAttack`.

#### Actuation (`agent/actuation/`)
- **[`agent/actuation/movement.js`](file:///e:/Projects/minecraft-community/agent/actuation/movement.js)**
  - `MovementActuator`: `goto`, `gotoBlock`, `fleeFrom`, `wander`, `stop`, `isMoving`.
- **[`agent/actuation/chat.js`](file:///e:/Projects/minecraft-community/agent/actuation/chat.js)**
  - `ChatActuator`: `say`, `whisper`.
- **[`agent/actuation/combat.js`](file:///e:/Projects/minecraft-community/agent/actuation/combat.js)**
  - `CombatActuator`: `attack`, `stopCombat`.
- **[`agent/actuation/inventory.js`](file:///e:/Projects/minecraft-community/agent/actuation/inventory.js)**
  - `InventoryActuator`: `eatFood` (equips and consumes food), `listInventory`.

#### Stats Engine (`agent/stats/`) — Zero LLM
- **[`agent/stats/stats.js`](file:///e:/Projects/minecraft-community/agent/stats/stats.js)**
  - `StatsManager`: Manages numeric states (`health`, `hunger`, `anger`, `happiness`, `fatigue`).
- **[`agent/stats/decay.js`](file:///e:/Projects/minecraft-community/agent/stats/decay.js)**
  - `StatsDecayEngine`: `tick()` updates hunger, fatigue, anger, and happiness every second.
- **[`agent/stats/relationships.js`](file:///e:/Projects/minecraft-community/agent/stats/relationships.js)**
  - `RelationshipTracker`: Tracks `trust` and `affinity` per player username.

#### Decision Engine (`agent/decision/`)
- **[`agent/decision/confidence.js`](file:///e:/Projects/minecraft-community/agent/decision/confidence.js)**
  - `ConfidenceEvaluator`: Checks if rule confidence is below threshold (`0.6`).
- **[`agent/decision/rules/`](file:///e:/Projects/minecraft-community/agent/decision/rules/)**
  - `eat.js`: Triggers eating when hunger <= 50% or injured.
  - `flee.js`: Triggers fleeing when health <= 6 or hostiles >= 3.
  - `fight.js`: Triggers attack when hostiles nearby and health > 8.
  - `sleep.js`: Triggers bed navigation at night when fatigue > 60%.
  - `mine.js`: Triggers resource gathering when idle.
  - `explore.js`: Triggers exploration when stamina is high and happiness needs boosting.
  - `trade.js`: Triggers trading when high-trust player is nearby.
- **[`agent/decision/dynamicRules.js`](file:///e:/Projects/minecraft-community/agent/decision/dynamicRules.js)**
  - `DynamicRuleEngine`: Replicates LLM escalation decisions into local dynamic rules with confidence `0.85`, allowing the bot to learn and avoid repeating LLM calls for identical situations.
- **[`agent/decision/tree.js`](file:///e:/Projects/minecraft-community/agent/decision/tree.js)**
  - `DecisionTree`: Evaluates static + dynamic rules, selects top action, and escalates to Brain Broker if confidence < `0.6`.
- **[`agent/decision/escalate.js`](file:///e:/Projects/minecraft-community/agent/decision/escalate.js)**
  - `EscalationManager`: Dispatches low-confidence payloads to `BrainClient`.

#### Brain Broker Client (`agent/brain-client/`)
- **[`agent/brain-client/client.js`](file:///e:/Projects/minecraft-community/agent/brain-client/client.js)**
  - `BrainClient`: Issues `POST /api/escalate` to central Brain Broker service.

---

### Central Brain Broker Service (`broker/`)
- **[`broker/index.js`](file:///e:/Projects/minecraft-community/broker/index.js)**
  - Express REST server (`GET /health`, `POST /api/escalate`).
- **[`broker/config.js`](file:///e:/Projects/minecraft-community/broker/config.js)**
  - Loads `GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, and `CACHE_TTL_SECONDS`.
- **[`broker/router.js`](file:///e:/Projects/minecraft-community/broker/router.js)**
  - `ProviderRouter`: Implements task-type model preference order (`Groq` for `CHAT`/`REFLEX`, `Gemini` for `REASONING`/`EMOTION`), handles round-robin, failover on HTTP 429, and parses JSON output including `emotionDelta`.
- **[`broker/rateLimiter.js`](file:///e:/Projects/minecraft-community/broker/rateLimiter.js)**
  - Tracks 60s provider cooldowns on rate limit errors.
- **[`broker/cache/exactCache.js`](file:///e:/Projects/minecraft-community/broker/cache/exactCache.js)**
  - `ExactCache`: SHA-256 exact-match state hash cache with 300s TTL.
- **[`broker/providers/`](file:///e:/Projects/minecraft-community/broker/providers/)**
  - `gemini.js`, `groq.js`, `cerebras.js`, `openrouter.js`: Direct HTTP API wrappers for each LLM provider.

---

### Shared Utilities (`shared/`)
- **[`shared/logger.js`](file:///e:/Projects/minecraft-community/shared/logger.js)**: Standardized formatted console logging.
- **[`shared/constants.js`](file:///e:/Projects/minecraft-community/shared/constants.js)**: Action enum (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `WANDER`, `IDLE`, `TRADE`, `EXPLORE`, `BUILD`, `TALK`) and stat ranges.
