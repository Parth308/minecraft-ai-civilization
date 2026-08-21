# Workspace Knowledge Base & Architecture Index

This document serves as the complete technical specification, architectural reference, and function-by-function catalog for the Minecraft AI Civilization project.

---

## 1. Tech Stack Summary
- **Runtime**: Node.js 20 (Alpine Linux container images)
- **Orchestration**: Docker Compose with strict per-container resource constraints (`cpus`, `memory`)
- **Game Engine Bot Client**: `mineflayer` (^4.20.1)
- **Pathfinding Engine**: `mineflayer-pathfinder` (^2.4.5) with 3D A* navigation
- **Vector Utilities**: `vec3` (^0.1.10)
- **Minecraft Server**: Paper Minecraft Server 1.20.4 (`itzg/minecraft-server` in Docker, `online-mode=false`, capped at 2.5GB RAM)
- **HTTP Microservices**:
  - **Brain Broker Service**: Express.js on port `3001` (`broker/index.js`, 256MB RAM cap)
  - **Central Memory Service**: Express.js on port `3002` (`memory-service/index.js`, 256MB RAM cap)
- **LLM Provider Pool (Free Tiers)**:
  - **Gemini Flash (`gemini-2.5-flash`)**: Primary workhorse for complex reasoning, emotions, and Tier 2 memory consolidation.
  - **Groq (`llama-3.1-8b-instant`)**: Primary for fast sub-second chat dialogue, quick reflexes, and Tier 1 buffer compaction.
  - **Cerebras (`llama3.1-8b`)**: Backup provider on rate limits.
  - **OpenRouter Free (`meta-llama/llama-3.1-8b-instruct:free`)**: Universal failover provider.
- **Detachable Embeddings Engine**:
  - **Hosted**: Gemini `text-embedding-004` (768 dimensions)
  - **Local**: Fast deterministic token frequency & N-gram hashing into unit hypersphere (zero GPU/RAM overhead).
  - Switchable via `EMBEDDING_PROVIDER='local' | 'gemini' | 'auto'`.
- **Dual-Layer Caching Architecture**:
  - **Layer 1**: SHA-256 exact-match state hash cache with 300s TTL (`broker/cache/exactCache.js`).
  - **Layer 2**: Cosine similarity semantic vector cache with $\ge 0.88$ threshold (`broker/cache/semanticCache.js`).
- **Memory Architecture**: Sectioned Markdown store (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`) with vector indexing (`vectorStore.js`) and two-tier compaction.

---

## 2. Comprehensive Module & Function Catalog

### Core Agent (`agent/`)

#### 1. Configuration, Dockerfile & Entrypoint
- **[`agent/Dockerfile`](file:///e:/Projects/minecraft-community/agent/Dockerfile)**: Multi-stage Node 20 Alpine build for lean, resource-capped agent containers (~80MB RAM live).
- **[`agent/config.js`](file:///e:/Projects/minecraft-community/agent/config.js)**
  - `host`: Minecraft server host (default: `localhost` / `minecraft-server`).
  - `port`: Minecraft server port (default: `25565`).
  - `username`: Agent player name (e.g. `Agent_Alpha`, `Agent_Beta`).
  - `version`: Minecraft version target (`1.20.4`).
  - `prefix`: In-game chat command prefix (`!`).
  - `personalitySeed`: Personality profile identifier (`friendly-explorer`, `cautious-builder`).
  - `confidenceThreshold`: Escalation threshold score (`0.6`).
- **[`agent/index.js`](file:///e:/Projects/minecraft-community/agent/index.js)**
  - `createAgent()`: Instantiates Mineflayer client, loads pathfinder, initializes perception, actuators, stats, event buffer, memory client, and launches the 1-second main tick loop.
  - `executeDecision(decision)`: Translates decision tree output into physical actions (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `EXPLORE`, `WANDER`).

---

#### 2. Perception Layer (`agent/perception/`)
- **[`agent/perception/senses.js`](file:///e:/Projects/minecraft-community/agent/perception/senses.js)** — `Senses` class:
  - `getNearbyMobs(maxDistance=16)`: Scans world entities and filters for living non-player mobs.
  - `getNearbyHostileMobs(maxDistance=16)`: Filters for dangerous hostiles (zombies, skeletons, creepers, phantoms, wardens, etc.).
  - `getNearbyPassiveMobs(maxDistance=16)`: Filters for passive animals (cows, pigs, sheep, chickens, horses, villagers).
  - `getNearbyPlayers(maxDistance=32)`: Scans for other human/bot player entities in visual range.
  - `getNearbyItems(maxDistance=16)`: Locates dropped item entities on the ground.
  - `getNearbyBlock(blockName, maxDistance=16)`: Finds single closest block matching substring.
  - `getNearbyBlocks(blockName, maxDistance=16, count=5)`: Finds up to N matching blocks.
  - `getNearbyBed(maxDistance=16)`: Locates nearest bed for sleeping.
  - `getNearbyChests(maxDistance=16)`: Locates nearby chest/storage containers.
  - `getNearbyFurnaces(maxDistance=16)`: Locates smelting furnaces.
  - `getNearbyOres(maxDistance=16)`: Locates coal, iron, gold, diamond, copper, redstone ores.
  - `getNearbyTrees(maxDistance=16)`: Finds log blocks for timber harvesting.
  - `getNearbyWater(maxDistance=16)` / `getNearbyLava(maxDistance=16)`: Identifies fluid hazards/sources.
  - `isNight()`: Returns boolean if in-game tick is between 13000 and 23000.
  - `getTimeOfDay()`: Returns semantic phase (`morning`, `afternoon`, `sunset`, `night`, `sunrise`).
  - `getLightLevel()`: Calculates block light level at bot position to assess monster spawn danger.
  - `getBiome()`: Returns biome identifier name (`plains`, `forest`, `desert`, etc.).
  - `isRaining()`: Detects active precipitation.
  - `getInventoryFood()`: Scans bot inventory for edible items.
  - `getInventoryTools()`: Scans bot inventory for weapons/tools.
  - `getEquipmentSummary()`: Inspects equipped armor and held hand items.
  - `canSeeEntity(entity)`: Raycasts line-of-sight to check if target is obscured by blocks.

- **[`agent/perception/events.js`](file:///e:/Projects/minecraft-community/agent/perception/events.js)** — `EventObserver` class (EventEmitter):
  - Emits `agentHurt`: Triggered when bot entity loses health.
  - Emits `agentDeath`: Triggered when bot dies.
  - Emits `agentRespawn`: Triggered when bot respawns in world.
  - Emits `underAttack`: Triggered when attacker targets and hits bot.
  - Emits `playerChat`: Normalizes public in-game chat messages.
  - Emits `playerWhisper`: Normalizes direct private messages.
  - Emits `itemCollected`: Triggered when bot picks up ground items.
  - Emits `blockBroken`: Triggered upon completing block excavation.
  - Emits `weatherChanged`: Triggered on rain/clear weather transitions.
  - Emits `timeTransition`: Triggered when transitioning between day phases.

---

#### 3. Actuation Layer (`agent/actuation/`)
- **[`agent/actuation/movement.js`](file:///e:/Projects/minecraft-community/agent/actuation/movement.js)** — `MovementActuator` class:
  - `goto(x, y, z, range=1)`: Navigates using `GoalNear` pathfinding.
  - `gotoBlock(x, y, z)`: Navigates directly on top of specific block using `GoalBlock`.
  - `fleeFrom(entity, distance=16)`: Calculates vector away from threat and navigates away.
  - `wander(radius=15)`: Picks random offset coordinate and wanders.
  - `stop()`: Clears active pathfinder goal.
  - `isMoving()`: Checks if pathfinder is actively traversing a path.

- **[`agent/actuation/chat.js`](file:///e:/Projects/minecraft-community/agent/actuation/chat.js)** — `ChatActuator` class:
  - `say(message)`: Broadcasts message to public server chat.
  - `whisper(username, message)`: Sends private direct message to specific player.

- **[`agent/actuation/combat.js`](file:///e:/Projects/minecraft-community/agent/actuation/combat.js)** — `CombatActuator` class:
  - `attack(entity)`: Auto-equips best sword/axe and attacks entity.
  - `stopCombat()`: Disengages target.

- **[`agent/actuation/inventory.js`](file:///e:/Projects/minecraft-community/agent/actuation/inventory.js)** — `InventoryActuator` class:
  - `getFoodCategories()`: Returns multi-tier categorization (`comfort`, `emergency`, `desperation`).
  - `findBestFood(health, hunger)`: Selects optimal item based on physical state:
    - *Comfort*: Cooked steak, bread, baked potato (Normal operation).
    - *Emergency*: Raw pork, raw beef, apples, carrots (Starving or HP < 10).
    - *Desperation*: Rotten flesh, spider eyes (Fatal starvation at HP <= 4).
  - `eatFood(health, hunger)`: Equips selected food and consumes it.
  - `craftItem(itemName, count)`: Automatically finds matching recipe in bot registry and crafts item.
  - `listInventory()`: Returns formatted array of item names and stack counts.

---

#### 4. Stats & Social Engine (`agent/stats/`) — Zero LLM
- **[`agent/stats/stats.js`](file:///e:/Projects/minecraft-community/agent/stats/stats.js)** — `StatsManager` class:
  - Manages numeric values: `health` (0-20), `hunger` (0-100%), `anger` (0-100%), `happiness` (0-100%), `fatigue` (0-100%).
  - `clamp(val)`: Constrains values within min/max bounds.
  - `updateHealth(mcHealth)` / `updateHungerFromMC(mcFood)`: Synchronizes with Minecraft engine.
  - `addAnger(amt)` / `addHappiness(amt)` / `addFatigue(amt)`: Modifies dynamic emotional states.
  - `getSummary()`: Returns snapshot object of all current stats.

- **[`agent/stats/decay.js`](file:///e:/Projects/minecraft-community/agent/stats/decay.js)** — `StatsDecayEngine` class:
  - `tick()`: Updates hunger (faster during movement), fatigue, anger calm-down, and happiness.

- **[`agent/stats/relationships.js`](file:///e:/Projects/minecraft-community/agent/stats/relationships.js)** — `RelationshipTracker` class:
  - `get(username)`: Retrieves trust (0-100) and affinity (0-100) for a player.
  - `updateTrust(username, delta)` / `updateAffinity(username, delta)`: Modifies player metrics.

---

#### 5. Decision Engine (`agent/decision/`)
- **[`agent/decision/confidence.js`](file:///e:/Projects/minecraft-community/agent/decision/confidence.js)** — `ConfidenceEvaluator` class:
  - `shouldEscalate(confidence)`: Returns true if rule score < `0.6`.
- **[`agent/decision/dynamicRules.js`](file:///e:/Projects/minecraft-community/agent/decision/dynamicRules.js)** — `DynamicRuleEngine` class:
  - `learnRule(situationPayload, decisionData)`: Replicates LLM decisions locally with confidence `0.85`, reinforcing matching rules on repeated hits and writing durable survival tactics into `skills.md`.
  - `evaluateDynamicRules(senses, stats)`: Returns candidate actions generated from learned rules.
- **[`agent/decision/rules/`](file:///e:/Projects/minecraft-community/agent/decision/rules/)**:
  - `eat.js`: Evaluates multi-tier emergency/comfort feeding needs.
  - `flee.js`: Evaluates threat avoidance when overwhelmed or critical HP.
  - `fight.js`: Evaluates counter-attacks on hostiles.
  - `sleep.js`: Evaluates night-time rest when fatigue is high.
  - `mine.js`: Evaluates idle resource harvesting.
  - `explore.js`: Evaluates curiosity wander when stamina is high.
  - `trade.js`: Evaluates bartering with trusted players.
- **[`agent/decision/tree.js`](file:///e:/Projects/minecraft-community/agent/decision/tree.js)** — `DecisionTree` class:
  - `evaluate(senses, statsManager)`: Combines static and dynamic rules, selects top action, and escalates to Brain Broker if confidence < `0.6`. Applies returned `emotionDelta` to stats.
- **[`agent/decision/escalate.js`](file:///e:/Projects/minecraft-community/agent/decision/escalate.js)** — `EscalationManager` class:
  - `escalate(situationContext)`: Dispatches payload to `BrainClient`.

---

#### 6. Memory Client (`agent/memory/`)
- **[`agent/memory/buffer.js`](file:///e:/Projects/minecraft-community/agent/memory/buffer.js)** — `EventBuffer` class:
  - `addEvent(type, payload)`: Appends event; automatically flushes when capacity (20) is reached.
- **[`agent/memory/client.js`](file:///e:/Projects/minecraft-community/agent/memory/client.js)** — `MemoryClient` class:
  - `flushBuffer(events)`: Calls `POST /api/memory/compact`.
  - `queryMemories(query, section, limit)`: Calls `GET /api/memory/query`.

---

### Central Brain Broker Service (`broker/`)
- **[`broker/Dockerfile`](file:///e:/Projects/minecraft-community/broker/Dockerfile)**: Docker container build for Brain Broker microservice.
- **[`broker/index.js`](file:///e:/Projects/minecraft-community/broker/index.js)**:
  - Express REST server running on port `3001` (`/health`, `/api/escalate`).
- **[`broker/config.js`](file:///e:/Projects/minecraft-community/broker/config.js)**:
  - Loads API keys, port (`3001`), and cache settings.
- **[`broker/router.js`](file:///e:/Projects/minecraft-community/broker/router.js)** — `ProviderRouter` class:
  - Checks **Exact SHA-256 Cache** $\rightarrow$ Checks **Semantic Vector Cache ($\ge 0.88$)** $\rightarrow$ Calls LLM pool with task-preference order $\rightarrow$ Caches decision in both Exact and Semantic Caches.
- **[`broker/rateLimiter.js`](file:///e:/Projects/minecraft-community/broker/rateLimiter.js)** — `RateLimiter` class:
  - Imposes 60s cooldown on rate-limited providers.
- **[`broker/cache/exactCache.js`](file:///e:/Projects/minecraft-community/broker/cache/exactCache.js)** — `ExactCache` class:
  - SHA-256 state hash cache with 300s TTL.
- **[`broker/cache/semanticCache.js`](file:///e:/Projects/minecraft-community/broker/cache/semanticCache.js)** — `SemanticCache` class:
  - `cosineSimilarity(vecA, vecB)`: Computes normalized vector dot product.
  - `findSimilar(situation)`: Searches stored situation vectors for matches $\ge 0.88$.
  - `store(situation, decision)`: Embeds situation text and stores with TTL.

---

### Central Memory Service (`memory-service/`)
- **[`memory-service/Dockerfile`](file:///e:/Projects/minecraft-community/memory-service/Dockerfile)**: Docker container build with volume mount for persistent section markdown stores.
- **[`memory-service/index.js`](file:///e:/Projects/minecraft-community/memory-service/index.js)**:
  - Express REST server on port `3002` (`/api/memory/compact`, `/api/memory/consolidate`, `/api/memory/query`, `/health`).
- **[`memory-service/config.js`](file:///e:/Projects/minecraft-community/memory-service/config.js)**:
  - Configuration for storage paths, soft caps, and scheduler intervals.
- **[`memory-service/embeddings/client.js`](file:///e:/Projects/minecraft-community/memory-service/embeddings/client.js)** — `EmbeddingClient` class:
  - `getEmbedding(text)`: Detachable provider generating 768-dimensional normalized vectors via Gemini `text-embedding-004` (hosted) or deterministic token frequency & N-gram hashing (local zero-overhead fallback).
- **[`memory-service/store/vectorStore.js`](file:///e:/Projects/minecraft-community/memory-service/store/vectorStore.js)** — `VectorMemoryStore` class:
  - `indexSectionEntries(agentId, section, entries)`: Embeds and indexes memory entries.
  - `searchSimilar(agentId, queryText, limit)`: Performs semantic cosine similarity search over stored memory vectors.
- **[`memory-service/sections/schema.js`](file:///e:/Projects/minecraft-community/memory-service/sections/schema.js)**:
  - Creates and parses sectioned markdown files (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`).
- **[`memory-service/router.js`](file:///e:/Projects/minecraft-community/memory-service/router.js)** — `EventRouter` class:
  - Zero-LLM event router categorizing raw events into section files.
- **[`memory-service/sections/compactor.js`](file:///e:/Projects/minecraft-community/memory-service/sections/compactor.js)** — `MemoryCompactor` class:
  - Tier 1 fast compaction (Groq) & Tier 2 smart section consolidation (Gemini Flash).
- **[`memory-service/scheduler.js`](file:///e:/Projects/minecraft-community/memory-service/scheduler.js)** — `MemoryScheduler` class:
  - Periodic background sweep monitoring file sizes and triggering Tier 2 passes.

---

### Ops & Orchestration Scripts (`scripts/`)
- **[`docker-compose.yml`](file:///e:/Projects/minecraft-community/docker-compose.yml)**: Orchestrates Paper Server (2.5GB limit), Memory Service (256MB limit), Brain Broker (256MB limit), Agent Alpha (256MB limit), Agent Beta (256MB limit).
- **[`scripts/spawn-agent.sh`](file:///e:/Projects/minecraft-community/scripts/spawn-agent.sh)**: Spawns new dynamic agent containers with custom names and personalities.
- **[`scripts/benchmark-resources.sh`](file:///e:/Projects/minecraft-community/scripts/benchmark-resources.sh)**: Measures live container footprints and projects max agent scaling capacity on a 16GB RAM VPS.

---

### Shared Utilities (`shared/`)
- **[`shared/logger.js`](file:///e:/Projects/minecraft-community/shared/logger.js)**: Standardized formatted console logging.
- **[`shared/constants.js`](file:///e:/Projects/minecraft-community/shared/constants.js)**: Action enum (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `WANDER`, `IDLE`, `TRADE`, `EXPLORE`, `BUILD`, `TALK`) and stat ranges.
