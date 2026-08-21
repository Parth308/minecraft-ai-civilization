# Workspace Knowledge Base & Architecture Index

This document serves as the complete technical specification, architectural reference, and function-by-function catalog for the Minecraft AI Civilization project.

---

## 1. Tech Stack Summary
- **Runtime**: Node.js (CommonJS modules)
- **Game Engine Bot Client**: `mineflayer` (^4.20.1)
- **Pathfinding Engine**: `mineflayer-pathfinder` (^2.4.5) with 3D A* navigation
- **Vector Utilities**: `vec3` (^0.1.10)
- **Minecraft Server**: Paper Minecraft Server 1.20.4 (`itzg/minecraft-server` in Docker, `online-mode=false`)
- **HTTP Microservices**:
  - **Brain Broker Service**: Express.js on port `3001` (`broker/index.js`)
  - **Central Memory Service**: Express.js on port `3002` (`memory-service/index.js`)
- **LLM Provider Pool (Free Tiers)**:
  - **Gemini Flash (`gemini-2.5-flash`)**: Primary workhorse for complex reasoning, emotions, and Tier 2 memory consolidation.
  - **Groq (`llama-3.1-8b-instant`)**: Primary for fast sub-second chat dialogue, quick reflexes, and Tier 1 buffer compaction.
  - **Cerebras (`llama3.1-8b`)**: Backup provider on rate limits.
  - **OpenRouter Free (`meta-llama/llama-3.1-8b-instruct:free`)**: Universal failover provider.
- **Caching**: SHA-256 exact-match state hash cache with 300s TTL (`broker/cache/exactCache.js`).
- **Memory Architecture**: Sectioned Markdown store (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`) with two-tier compaction (Tier 1 buffer compaction via Groq, Tier 2 section consolidation via Gemini Flash).

---

## 2. Comprehensive Module & Function Catalog

### Core Agent (`agent/`)

#### 1. Configuration & Entrypoint
- **[`agent/config.js`](file:///e:/Projects/minecraft-community/agent/config.js)**
  - `host`: Minecraft server host (default: `localhost`).
  - `port`: Minecraft server port (default: `25565`).
  - `username`: Agent player name (default: `Agent_Alpha`).
  - `version`: Minecraft version target (`1.20.4`).
  - `prefix`: In-game chat command prefix (`!`).
  - `personalitySeed`: Personality profile identifier (`friendly-explorer`).
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
  - `getInventoryFood()`: Scans bot inventory for edible items (`bread`, `cooked_beef`, `apple`, etc.).
  - `getInventoryTools()`: Scans bot inventory for weapons/tools (`pickaxe`, `axe`, `sword`, `shovel`).
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
  - `eatFood()`: Equips food item into main hand and consumes it.
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
  - `tick()`: Ticks every second:
    - Natural hunger decay (accelerated 1.5x while moving).
    - Fatigue accumulation while moving, recovery while resting.
    - Natural anger decay towards 0.
    - Happiness decay if starved or severely injured.

- **[`agent/stats/relationships.js`](file:///e:/Projects/minecraft-community/agent/stats/relationships.js)** — `RelationshipTracker` class:
  - `get(username)`: Retrieves trust (0-100) and affinity (0-100) for a player.
  - `updateTrust(username, delta)`: Modifies player trust (e.g. decreased on attacks).
  - `updateAffinity(username, delta)`: Modifies player affinity (e.g. increased on friendly chat/trade).

---

#### 5. Decision Engine (`agent/decision/`)
- **[`agent/decision/confidence.js`](file:///e:/Projects/minecraft-community/agent/decision/confidence.js)** — `ConfidenceEvaluator` class:
  - `shouldEscalate(confidence)`: Returns true if rule score is below escalation threshold (`0.6`).
- **[`agent/decision/dynamicRules.js`](file:///e:/Projects/minecraft-community/agent/decision/dynamicRules.js)** — `DynamicRuleEngine` class:
  - `learnRule(situationPayload, decisionData)`: Replicates LLM escalation decisions locally with confidence `0.85`, allowing the agent to evolve and avoid re-calling the LLM for repeated situations.
  - `evaluateDynamicRules(senses, stats)`: Returns candidate actions generated from learned rules.
- **[`agent/decision/rules/`](file:///e:/Projects/minecraft-community/agent/decision/rules/)**:
  - `eat.js`: Priority when hunger <= 50% or injured with available food.
  - `flee.js`: Priority when health <= 6 or hostiles >= 3.
  - `fight.js`: Priority when hostiles in melee range and health > 8.
  - `sleep.js`: Priority at night when fatigue > 60% and bed nearby.
  - `mine.js`: Priority when idle and wood/ore blocks discovered.
  - `explore.js`: Priority when stamina is high and happiness needs boosting.
  - `trade.js`: Priority when high-trust player is nearby.
- **[`agent/decision/tree.js`](file:///e:/Projects/minecraft-community/agent/decision/tree.js)** — `DecisionTree` class:
  - `evaluate(senses, statsManager)`: Combines static and dynamic rules, selects top confidence action, and triggers escalation to Brain Broker if confidence < `0.6`. Applies returned `emotionDelta` to stats.
- **[`agent/decision/escalate.js`](file:///e:/Projects/minecraft-community/agent/decision/escalate.js)** — `EscalationManager` class:
  - `escalate(situationContext)`: Dispatches payload to `BrainClient`.

---

#### 6. Memory Client (`agent/memory/`)
- **[`agent/memory/buffer.js`](file:///e:/Projects/minecraft-community/agent/memory/buffer.js)** — `EventBuffer` class:
  - `addEvent(type, payload)`: Appends event; automatically triggers callback when capacity (20) is reached.
  - `getSnapshot()` / `clear()`: Inspects or resets buffer.
- **[`agent/memory/client.js`](file:///e:/Projects/minecraft-community/agent/memory/client.js)** — `MemoryClient` class:
  - `flushBuffer(events)`: Calls `POST /api/memory/compact` on Central Memory Service.
  - `queryMemories(query, section, limit)`: Calls `GET /api/memory/query` to fetch relevant section memory lines.

---

### Central Brain Broker Service (`broker/`)
- **[`broker/index.js`](file:///e:/Projects/minecraft-community/broker/index.js)**:
  - Express REST server running on port `3001`.
  - `GET /health`: Reports server status and active LLM provider count.
  - `POST /api/escalate`: Primary escalation endpoint routing situations to LLM pool.
- **[`broker/config.js`](file:///e:/Projects/minecraft-community/broker/config.js)**:
  - Loads API keys (`GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`), `BROKER_PORT`, and `CACHE_TTL_SECONDS`.
- **[`broker/router.js`](file:///e:/Projects/minecraft-community/broker/router.js)** — `ProviderRouter` class:
  - `getPreferredProviders(taskType)`: Sets priority order:
    - `CHAT` / `REFLEX` $\rightarrow$ Groq $\rightarrow$ Gemini Flash $\rightarrow$ Cerebras $\rightarrow$ OpenRouter.
    - `REASONING` / `EMOTION` $\rightarrow$ Gemini Flash $\rightarrow$ Groq $\rightarrow$ Cerebras $\rightarrow$ OpenRouter.
  - `fetchRelevantMemories(agentId, situation)`: Queries memory-service for context lines.
  - `processEscalation(situationPayload)`: Checks exact-match cache $\rightarrow$ queries preferred LLM $\rightarrow$ handles 429 failover $\rightarrow$ caches result $\rightarrow$ parses JSON with `emotionDelta`.
  - `buildPrompt(payload, taskType, memories)`: Injects stats, candidate actions, and retrieved memories into structured prompt.
- **[`broker/rateLimiter.js`](file:///e:/Projects/minecraft-community/broker/rateLimiter.js)** — `RateLimiter` class:
  - `isBlocked(providerName)`: Checks if provider is in cooldown.
  - `markRateLimited(providerName, cooldownMs=60000)`: Imposes 60s cooldown on HTTP 429 errors.
- **[`broker/cache/exactCache.js`](file:///e:/Projects/minecraft-community/broker/cache/exactCache.js)** — `ExactCache` class:
  - `hashSituation(situation)`: Produces SHA-256 hash of payload.
  - `get(situation)` / `set(situation, data)`: Stores decisions with 300s TTL.
- **[`broker/providers/`](file:///e:/Projects/minecraft-community/broker/providers/)**:
  - `gemini.js`: Calls Gemini Flash (`gemini-2.5-flash`).
  - `groq.js`: Calls Groq Llama 3.1 8B Instant.
  - `cerebras.js`: Calls Cerebras Llama 3.1 8B.
  - `openrouter.js`: Calls OpenRouter Free Llama 3.1 8B.

---

### Central Memory Service (`memory-service/`)
- **[`memory-service/index.js`](file:///e:/Projects/minecraft-community/memory-service/index.js)**:
  - Express REST server running on port `3002`.
  - `GET /health`: Health check.
  - `POST /api/memory/init`: Initializes agent memory markdown files.
  - `POST /api/memory/compact`: Tier 1 buffer compaction endpoint.
  - `POST /api/memory/consolidate`: Tier 2 section consolidation endpoint.
  - `GET /api/memory/query`: Section-scoped memory retrieval endpoint.
- **[`memory-service/config.js`](file:///e:/Projects/minecraft-community/memory-service/config.js)**:
  - Memory service port (`3002`), store path (`store/agents/`), soft caps (~3KB / section), and scheduler sweep interval (5 min).
- **[`memory-service/sections/schema.js`](file:///e:/Projects/minecraft-community/memory-service/sections/schema.js)**:
  - `initializeAgentMemoryFiles(agentId, personality)`: Creates `profile.md`, `relationships.md`, `events.md`, `skills.md`, and `recent.md` with YAML frontmatter.
  - `parseSectionFile(filePath)`: Parses frontmatter metadata and markdown bullet points.
  - `writeSectionFile(filePath, frontmatter, entries)`: Writes formatted markdown.
- **[`memory-service/router.js`](file:///e:/Projects/minecraft-community/memory-service/router.js)** — `EventRouter` class:
  - `routeEvent(event)`: Zero-LLM categorizer directing chat to `relationships.md`, combat to `events.md`, and mining/skills to `skills.md`.
- **[`memory-service/sections/compactor.js`](file:///e:/Projects/minecraft-community/memory-service/sections/compactor.js)** — `MemoryCompactor` class:
  - `compactBufferToSections(agentId, eventsList, eventRouter)`: Tier 1 fast compaction appending tagged entries to section files.
  - `consolidateSectionFile(agentId, sectionName, apiKey)`: Tier 2 smart consolidation pass via Gemini Flash deduplicating entries and preserving durable facts.
- **[`memory-service/scheduler.js`](file:///e:/Projects/minecraft-community/memory-service/scheduler.js)** — `MemoryScheduler` class:
  - `runSweep()`: Periodically monitors section sizes across all agent folders and triggers Tier 2 consolidation when soft caps are exceeded.

---

### Shared Utilities (`shared/`)
- **[`shared/logger.js`](file:///e:/Projects/minecraft-community/shared/logger.js)**: Formatted timestamped logging (`info`, `warn`, `error`, `debug`).
- **[`shared/constants.js`](file:///e:/Projects/minecraft-community/shared/constants.js)**: Action enum (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `WANDER`, `IDLE`, `TRADE`, `EXPLORE`, `BUILD`, `TALK`) and stat ranges.
