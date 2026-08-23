# Workspace Knowledge Base & Architecture Index

This document serves as the complete technical specification, architectural reference, and function-by-function catalog for the Minecraft AI Civilization project.

---

## 1. Tech Stack Summary
- **Runtime**: Node.js 20 (Alpine Linux container images)
- **Orchestration**: Docker Compose with strict per-container resource constraints (`cpus`, `memory`) and microservice health checks (`condition: service_healthy`)
- **Game Engine Bot Client**: `mineflayer` (^4.20.1)
- **Pathfinding Engine**: `mineflayer-pathfinder` (^2.4.5) with 3D A* navigation
- **Vector Utilities**: `vec3` (^0.1.10)
- **Minecraft Server**: Paper Minecraft Server 1.20.4 (`itzg/minecraft-server` in Docker, `online-mode=false`, capped at 2.5GB RAM)
- **HTTP Microservices**:
  - **Brain Broker Service**: Express.js on port `3001` (`broker/index.js`, 256MB RAM cap, `/health` endpoint)
  - **Central Memory Service**: Express.js on port `3002` (`memory-service/index.js`, 256MB RAM cap, `/health` endpoint)
  - **Ollama Embeddings Service**: Port `11434` running `nomic-embed-text` (768-dim normalized vectors)
- **LLM Provider Pool (Free Tiers)**:
  - **Gemini Flash (`gemini-2.5-flash`)**: Primary workhorse for complex reasoning, emotions, and Tier 2 memory consolidation.
  - **NVIDIA NIM (`meta/llama-3.1-70b-instruct`)**: High-intelligence secondary reasoning & diplomacy engine.
  - **Groq (`llama-3.1-8b-instant` / `qwen3.6-27b`)**: Primary for fast sub-second chat dialogue, quick reflexes, and Tier 1 buffer compaction.
  - **Cerebras (`llama3.1-8b`)**: Backup provider on rate limits (~1,800 tokens/sec).
  - **OpenRouter Free (`meta-llama/llama-3.1-8b-instruct:free`)**: Universal failover provider.
- **Detachable Embeddings Engine**:
  - **Ollama**: `nomic-embed-text` (768-dim normalized vectors via `POST /api/embeddings`)
  - **Hosted**: Gemini `text-embedding-004` (768 dimensions)
  - **Local**: Fast deterministic token frequency & N-gram hashing into unit hypersphere (zero GPU/RAM overhead).
  - Switchable via `EMBEDDING_PROVIDER='ollama' | 'gemini' | 'local' | 'auto'`.
- **Dual-Layer Caching Architecture**:
  - **Layer 1**: SHA-256 exact-match state hash cache with 300s TTL (`broker/cache/exactCache.js`).
  - **Layer 2**: Cosine similarity semantic vector cache with $\ge 0.88$ threshold (`broker/cache/semanticCache.js`).
- **Memory Architecture & Resiliency**:
  - Sectioned Markdown store (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`) with vector indexing (`vectorStore.js`) and two-tier compaction.
  - **Zero-Loss Retry Queue**: `agent/memory/client.js` buffers memory events in an in-memory queue and automatically drains when `memory-service` comes online.
  - **Offline Fallback**: `agent/brain-client/client.js` & `agent/decision/tree.js` gracefully fall back to local rule engine and dynamic rule cache when `brain-broker` is unreachable.
- **Detailed Audit & Simulation Logger**:
  - **Per-Agent Activity Logs**: `logs/agents/<agentId>/` (`movement.log`, `combat.log`, `inventory.log`, `chat_and_social.log`, `cognition_and_decisions.log`, `senses_and_environment.log`).
  - **Universal World Timeline**: `logs/world/` (`global_timeline.log`, `civilization_events.log`).

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
  - `createAgent()`: Instantiates Mineflayer client, loads pathfinder, initializes perception, actuators, stats, persona, goals, social dialogue, event buffer, memory client with retry queue, and launches the 1-second main tick loop.
  - `executeDecision(decision)`: Translates decision tree output into physical actions (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `EXPLORE`, `WANDER`).

---

#### 2. Cognitive & Goal Architecture (`agent/cognition/`)
- **[`agent/cognition/persona.js`](file:///e:/Projects/minecraft-community/agent/cognition/persona.js)** — `DynamicPersona` class:
  - `initializeTraits(seed)`: Initializes traits (`curiosity`, `sociability`, `greed`, `loyalty`, `caution`, `ambition`) based on cognitive seed.
  - `evolveFromExperience(eventType, impact)`: Mutes or amplifies traits in response to trauma (betrayals, scams, near-death) or triumph (cooperation, gifts).
  - `getPersonaPromptContext()`: Formats dynamic persona, traits, and free-will directives for LLM prompts.
- **[`agent/cognition/goals.js`](file:///e:/Projects/minecraft-community/agent/cognition/goals.js)** — `GoalManager` class:
  - `setGoal(description, details)`: Formulates an emergent short-term objective.
  - `setAspiration(aspiration)`: Establishes a life dream / long-term goal.
  - `markGoalCompleted(outcome)`: Logs goal completion.
  - `getGoalContext()`: Returns active goal snapshot.

---

#### 3. Social & Diplomatic Architecture (`agent/social/`)
- **[`agent/social/dialogue.js`](file:///e:/Projects/minecraft-community/agent/social/dialogue.js)** — `SocialDialogueEngine` class:
  - `processIncomingChat(sender, message, civContext)`: Parses natural chat messages from other bots or players, passes persona, goals, and history to Brain Broker (`SOCIAL_CHAT` task), updates dynamic relationship metrics, and returns natural spoken dialogue.
- **[`agent/social/factions.js`](file:///e:/Projects/minecraft-community/agent/social/factions.js)** — `FactionAffiliationManager` class:
  - `recordSecretBase(name, coords, notes)`: Records hidden private bases never published to the global ledger.
  - `declareWar(targetName, reason)` / `declarePeace(targetName)`: Manages hostile/war and peace states dynamically.
  - `recordTreaty(proposer, treatyType, honorsStatus)`: Logs treaties and whether the agent intends to honor or betray them.
  - `recognizeCurrency(currencyName)`: Tracks custom player-invented currencies the bot accepts.

---

#### 4. Perception Layer (`agent/perception/`)
- **[`agent/perception/senses.js`](file:///e:/Projects/minecraft-community/agent/perception/senses.js)** — `Senses` class:
  - `getNearbyMobs(maxDistance=16)`: Scans world entities for living non-player mobs.
  - `getNearbyHostileMobs(maxDistance=16)`: 25 hostile types: zombies, skeletons, creepers, phantoms, wardens, blazes, ghasts, piglin_brutes, etc.
  - `getNearbyPassiveMobs(maxDistance=16)`: 20 passive types: cows, pigs, sheep, villagers, axolotl, frogs, allays, etc.
  - `getNearbyPlayers(maxDistance=32)`: Scans all online players with spawned entities.
  - `getNearbyItems(maxDistance=16)`: Finds dropped `Item` object-type entities on the ground (fixed from broken `type='object'` filter).
  - `getNearbyProjectiles(maxDistance=12)`: **NEW** — Detects incoming arrows, fireballs, tridents, wither skulls within radius.
  - `getNearbyBlock(blockName, maxDistance=16)` / `getNearbyBlocks(blockName, maxDistance, count)`: Block scanning with null-filtered results.
  - `getNearbyBed(16)`, `getNearbyChests(16)`, `getNearbyFurnaces(16)`, `getNearbyCraftingTables(8)`: **NEW** — crafting table finder.
  - `getNearbyOres(16)`: Finds all ore types including `ancient_debris`, `emerald_ore`, `nether_quartz_ore`.
  - `getNearbyTrees(16)`, `getNearbyWater(16)`, `getNearbyLava(16)`.
  - `isNight()`, `getTimeOfDay()`, `getLightLevel()`, `getBiome()`, `isRaining()`.
  - `isInWater()`: **NEW** — checks `bot.entity.isInWater`.
  - `isOnFire()`: **NEW** — checks `bot.entity.onFire`.
  - `isUnderground()`: **NEW** — returns true if Y < 60.
  - `isFalling()`: **NEW** — returns true if `velocity.y < -0.1`.
  - `getInventoryFood()`, `getInventoryTools()`, `getEquipmentSummary()` (includes offhand slot).
  - `hasItem(itemName)`: **NEW** — boolean item existence check.
  - `countItem(itemName)`: **NEW** — total stack count across all inventory slots.
  - `canSeeEntity(entity)`: Line-of-sight raycast with try/catch protection.

- **[`agent/perception/events.js`](file:///e:/Projects/minecraft-community/agent/perception/events.js)** — `EventObserver` class (EventEmitter):
  - Emits: `agentHurt`, `agentDeath`, `agentRespawn`, `underAttack`, `nearbyAttackSwing` (NEW), `incomingProjectile` (NEW — arrow/fireball/trident within 20m), `agentOnFire` / `agentFireOut` (NEW — 500ms polling), `playerChat`, `playerWhisper`, `playerJoined` (NEW), `playerLeft` (NEW), `itemCollected`, `blockBroken`, `blockPlaced` (NEW), `weatherChanged`, `timeTransition`.
  - Item collection detection: Resolves item types through `bot.registry.items` using `metadata[8]` / `metadata[7]` payload IDs with fallback to entity name.
  - Mining block identification: Caches block state on `diggingStarted` so `diggingCompleted` accurately logs the true mined block name instead of post-break `air`.
  - Fire detection: 500ms interval polling `bot.entity.onFire` with debounce.
  - Attacker identification: Uses nearby entity proximity scan as proxy since mineflayer lacks direct hit-source API.

---

#### 5. Actuation & Skills Layer (`agent/actuation/`, `agent/skills/`)
- **[`agent/skills/builder.js`](file:///e:/Projects/minecraft-community/agent/skills/builder.js)** — `BuilderSkill` class:
  - `buildShelter(origin, width, length, height)`: Scans inventory for building blocks (planks, cobblestone, stone, dirt, wood, brick) and erects perimeter shelter walls with entrance.
  - **Failure Handling & Cooldown**: If `placedCount === 0`, marks the target site invalid in `invalidSites`, resets active building goals in `GoalManager`, and enforces a 60-second cooldown before shelter building can be re-triggered.
  - `getAvailableBuildingBlocks()`: Returns valid structural block items from inventory.

- **[`agent/skills/barter.js`](file:///e:/Projects/minecraft-community/agent/skills/barter.js)** — `BarterSkill` class:
  - `executeTrade(partner, giveItem, giveCount, wantItem, wantCount)`: Coordinates peer-to-peer item exchanges.

- **[`agent/actuation/movement.js`](file:///e:/Projects/minecraft-community/agent/actuation/movement.js)** — `MovementActuator` class:
  - `goto(x, y, z, range=1)`, `gotoBlock(x, y, z)`, `follow(entity, distance=2)`, `fleeFrom(entity, distance=16)` (null-guarded), `wander(radius=15)`, `stop()`, `isMoving()`.
  - `lookAt(x, y, z, force)` / `lookAtEntity(entity)`: Precise head aiming.
  - `sprint(enable)`, `sneak(enable)`, `jump()`, `swim()` / `stopSwimming()`.

- **[`agent/actuation/combat.js`](file:///e:/Projects/minecraft-community/agent/actuation/combat.js)** — `CombatActuator` class:
  - `equipBestArmor()`: Auto-equips highest tier armor (netherite > diamond > iron > golden > chainmail > leather) across all 4 slots.
  - `equipBestWeapon()`: Auto-equips best sword or axe into main hand.
  - `hasBow()` / `hasArrows()`: **NEW** — inventory presence checks.
  - `useShield(enable)`: Equips shield in offhand and raises/lowers blocking stance.
  - `criticalAttack(entity)`: **NEW** — Jumps, waits for descent, then hits for 1.5× damage (Minecraft crit mechanic).
  - `bowAttack(entity)`: **NEW** — Equips bow, charges for 1 full second (full power shot), releases. Falls back to melee if no bow/arrows.
  - `engageMelee(entity)`: **NEW** — Sustained combat loop (200ms tick): chases with `GoalFollow`, respects 630ms attack cooldown, uses crit every 3rd hit, auto-stops when target dies.
  - `attack(entity)`: **UPDATED** — Orchestrates full combat: equips armor, tries bow if target is >6m away + has bow, then falls back to sustained melee loop. Cancels any existing loop before re-engaging.
  - `stopCombat()`: Clears combat loop interval, disengages pathfinding, lowers shield.

- **[`agent/actuation/inventory.js`](file:///e:/Projects/minecraft-community/agent/actuation/inventory.js)** — `InventoryActuator` class:
  - `_navigateWithin(pos, range=3, timeoutMs=15000)`: **NEW** shared helper — pathfinds to within range of a position, used by dig/place/chest/craft.
  - `getFoodCategories()`, `findBestFood(health, hunger)`, `eatFood(health, hunger)`.
  - `equipOptimalTool(block)`: Automatically equips matching tool (pickaxe for stone/ore, axe for wood, shovel for dirt/sand, shears for leaves/wool).
  - `digBlock(block)`: Navigates within 3m, equips tool, looks at block center, excavates. **Fixed** — previously could fail silently if out of reach.
  - `placeBlock(blockName, referenceBlock, faceVector)`: Navigates within 3m, looks at face center, equips block, places. **Fixed** — previously placed without proximity/aim.
  - `dropItem(itemName, count)`: Clamps count to available stack size. **Fixed** — was previously unclamped.
  - `tossItemToPlayer(itemName, playerEntity, count)`: Faces player before tossing.
  - `openChestAndDeposit(chestBlock, itemNames)`: Navigates to chest first. **Fixed** — was opening at distance.
  - `openChestAndWithdraw(chestBlock, itemNames)`: Navigates to chest first. **Fixed** — was opening at distance.
  - `craftItem(itemName, count)`: Auto-searches for crafting table within 8m, places mobile table if needed, crafts via `bot.craft()`, and automatically recovers workbench. On `missing ingredient` error, automatically invokes `setCraftCooldown(itemName, 30000)`.
  - `listInventory()`: Returns formatted `name x count` strings.

- **[`agent/actuation/chat.js`](file:///e:/Projects/minecraft-community/agent/actuation/chat.js)** — `ChatActuator` class:
  - `say(message)`: Enqueues to rate-limited FIFO queue (1.2s interval). **Fixed** — was sending all at once causing server kick for chat flood.
  - `whisper(username, message)`: Rate-limited private whisper. Messages capped at 256 chars.

---

#### 6. Stats & Social Engine (`agent/stats/`) — Zero LLM
- **[`agent/stats/stats.js`](file:///e:/Projects/minecraft-community/agent/stats/stats.js)** — `StatsManager` class:
  - Manages numeric values: `health` (0-20), `hunger` (0-100%), `anger` (0-100%), `happiness` (0-100%), `fatigue` (0-100%).
- **[`agent/stats/decay.js`](file:///e:/Projects/minecraft-community/agent/stats/decay.js)** — `StatsDecayEngine` class.
- **[`agent/stats/relationships.js`](file:///e:/Projects/minecraft-community/agent/stats/relationships.js)** — `RelationshipTracker` class.

---

#### 7. Decision Engine (`agent/decision/`)
- **[`agent/decision/confidence.js`](file:///e:/Projects/minecraft-community/agent/decision/confidence.js)** — `ConfidenceEvaluator` class.
- **[`agent/decision/dynamicRules.js`](file:///e:/Projects/minecraft-community/agent/decision/dynamicRules.js)** — `DynamicRuleEngine` class.
- **[`agent/decision/rules/`](file:///e:/Projects/minecraft-community/agent/decision/rules/)**:
  - `eat.js`, `fight.js`, `sleep.js`, `mine.js`, `explore.js`, `trade.js`, `talk.js`.
  - `craft.js`: Strict prerequisite verification ensuring all input materials exist in inventory before returning confidence $\ge 0.9$. Integrates recipe cooldown registry (`setCraftCooldown`, `isCraftOnCooldown`).
  - `flee.js`: Evaluates mortal danger, swarm threshold (3+ hostiles), and **Night-Awareness** (unarmored/unarmed agents prioritize `FLEE` and retreat to shelter during night cycle or light level $\le 7$).
- **[`agent/decision/tree.js`](file:///e:/Projects/minecraft-community/agent/decision/tree.js)** — `DecisionTree` class:
  - Evaluates static & dynamic rules, escalates to Brain Broker if confidence < 0.6, and gracefully falls back to local rules if Broker is offline.
- **[`agent/decision/escalate.js`](file:///e:/Projects/minecraft-community/agent/decision/escalate.js)** — `EscalationManager` class:
  - `escalate(situationContext)`: Dispatches payload to `BrainClient`.

---

#### 8. Memory Client & Resilient Queue (`agent/memory/`)
- **[`agent/memory/buffer.js`](file:///e:/Projects/minecraft-community/agent/memory/buffer.js)** — `EventBuffer` class:
  - Rolling 20-event buffer triggering callback on overflow.
- **[`agent/memory/client.js`](file:///e:/Projects/minecraft-community/agent/memory/client.js)** — `MemoryClient` class:
  - `flushBuffer(events)`: Pushes events to local `pendingQueue` and attempts flush.
  - `drainQueue()`: Chunks backlog into max 50-event batches in a loop. On temporary failure, only the failing batch is re-queued, eliminating request size blowups.
  - `queryMemories(query, section, limit)`: Queries `GET /api/memory/query`.

---

### Central Brain Broker Service (`broker/`)
- **[`broker/Dockerfile`](file:///e:/Projects/minecraft-community/broker/Dockerfile)**: Docker container build with `/health` check.
- **[`broker/index.js`](file:///e:/Projects/minecraft-community/broker/index.js)**: Express REST server on port `3001`.
- **[`broker/config.js`](file:///e:/Projects/minecraft-community/broker/config.js)**: API keys and port configuration (`GEMINI_API_KEY`, `GROQ_API_KEY`, `NVIDIA_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`).
- **[`broker/providers/nvidia.js`](file:///e:/Projects/minecraft-community/broker/providers/nvidia.js)**: NVIDIA NIM API integration (`meta/llama-3.1-70b-instruct`).
- **[`broker/router.js`](file:///e:/Projects/minecraft-community/broker/router.js)** — `ProviderRouter` class:
  - Supports task modes: `REASONING`, `CHAT`, `REFLEX`, `SOCIAL_CHAT`, `REFLECTION`.
  - Injects dynamic persona, active goals, and free-will directives into prompts.
- **[`broker/rateLimiter.js`](file:///e:/Projects/minecraft-community/broker/rateLimiter.js)**: Provider cooldown manager.
- **[`broker/cache/exactCache.js`](file:///e:/Projects/minecraft-community/broker/cache/exactCache.js)**: SHA-256 state hash cache.
- **[`broker/cache/semanticCache.js`](file:///e:/Projects/minecraft-community/broker/cache/semanticCache.js)**: Cosine similarity vector cache ($\ge 0.88$).

---

### Central Memory Service (`memory-service/`)
- **[`memory-service/Dockerfile`](file:///e:/Projects/minecraft-community/memory-service/Dockerfile)**: Docker container build with `/health` check.
- **[`memory-service/index.js`](file:///e:/Projects/minecraft-community/memory-service/index.js)**: Express REST server on port `3002` with 50MB payload parsing limit (`express.json({ limit: '50mb' })`). Exposes `GET /health`, `POST /api/memory/init`, `POST /api/memory/compact`, `POST /api/memory/consolidate`, `GET /api/memory/query`, `GET /api/memory/sections/:agentId/:section`, `GET /api/ledger`.
- **[`memory-service/embeddings/client.js`](file:///e:/Projects/minecraft-community/memory-service/embeddings/client.js)** — `EmbeddingClient` class:
  - Supports **Ollama (`nomic-embed-text`)**, **Gemini (`text-embedding-004`)**, and **Local N-Gram Fallback** with L2 vector normalization.
- **[`memory-service/store/vectorStore.js`](file:///e:/Projects/minecraft-community/memory-service/store/vectorStore.js)**: Memory vector store and semantic search.
- **[`memory-service/sections/schema.js`](file:///e:/Projects/minecraft-community/memory-service/sections/schema.js)**: Sectioned markdown manager (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`).
- **[`memory-service/router.js`](file:///e:/Projects/minecraft-community/memory-service/router.js)**: Zero-LLM event router.
- **[`memory-service/sections/compactor.js`](file:///e:/Projects/minecraft-community/memory-service/sections/compactor.js)**: Two-tier compaction engine.
- **[`memory-service/scheduler.js`](file:///e:/Projects/minecraft-community/memory-service/scheduler.js)**: Background compaction sweep scheduler.
- **[`memory-service/reflection/engine.js`](file:///e:/Projects/minecraft-community/memory-service/reflection/engine.js)** — `GenerativeReflectionEngine` class:
  - `runReflection(agentId)`: Synthesizes high-level reflections, worldviews, and social insights into `profile.md`.
- **[`memory-service/store/civilization/ledger.js`](file:///e:/Projects/minecraft-community/memory-service/store/civilization/ledger.js)** — `CivilizationLedger` class:
  - Records emergent currencies, settlements, and factions.

---

### Civilization Control Dashboard (`dashboard/`)
- **[`dashboard/Dockerfile`](file:///e:/Projects/minecraft-community/dashboard/Dockerfile)**: Docker container build (Node 20 Alpine, 512MB RAM cap) with `/health` check.
- **[`dashboard/package.json`](file:///e:/Projects/minecraft-community/dashboard/package.json)**: `express`, `ws`, `mineflayer`, `prismarine-viewer`, `http-proxy-middleware`.
- **[`dashboard/server/index.js`](file:///e:/Projects/minecraft-community/dashboard/server/index.js)**: Express REST server on port `3003` + WebSocket server on `/ws` + reverse proxy for `prismarine-viewer` on `/viewer`.
- **[`dashboard/server/aggregator.js`](file:///e:/Projects/minecraft-community/dashboard/server/aggregator.js)**: Polls Brain Broker (5s), Memory Service (5s), Agent status endpoints (2s), diffs chat, and broadcasts WebSocket snapshots.
- **[`dashboard/server/spectator.js`](file:///e:/Projects/minecraft-community/dashboard/server/spectator.js)**: Embedded `SpectatorBot` mineflayer client. On spawn, automatically configures OP + spectator mode via RCON, runs `prismarine-viewer` on internal port 3004, and enables instantaneous noclip teleporting (`/tp SpectatorBot <AgentName>`) when switching camera between agents.
- **[`dashboard/server/rcon.js`](file:///e:/Projects/minecraft-community/dashboard/server/rcon.js)**: Zero-dependency Minecraft RCON client implementation.
- **[`dashboard/server/routes/`](file:///e:/Projects/minecraft-community/dashboard/server/routes/)**:
  - `health.js`: Health metrics and response times for all microservices.
  - `agents.js`: Snapshot and details for all active agents.
  - `chat.js`: Relays chat history and enables browser-based operator chat messages via `/tellraw` with `[Operator]` prefix.
  - `memory.js`: Memory query and raw section retrieval proxies.
  - `ledger.js`: Civilization ledger proxy.
- **[`dashboard/client/`](file:///e:/Projects/minecraft-community/dashboard/client/)**:
  - `index.html`: Responsive 3-column cyberpunk observation UI (Service health, Agent cards with dynamic confidence rings & stat meters, World view iframe with spectate switcher, Live world chat & operator input, Decision tree rule ranking, Markdown memory viewer, Civilization ledger).
  - `app.js`: Zero-build ES module frontend with auto-reconnecting WebSocket telemetry.

---

### Ops & Orchestration Scripts (`scripts/`)
- **[`docker-compose.yml`](file:///e:/Projects/minecraft-community/docker-compose.yml)**: Orchestrates Paper Server (2.5GB limit + RCON enabled on port 25575), Ollama (`nomic-embed-text`, 1.5GB limit), Memory Service (256MB limit), Brain Broker (256MB limit), Dashboard (512MB limit, port 3003), Agent Alpha (256MB limit, status port 3010), Agent Beta (256MB limit, status port 3011).
- **[`scripts/spawn-agent.sh`](file:///e:/Projects/minecraft-community/scripts/spawn-agent.sh)**: Spawns new dynamic agent containers with custom names and personalities.
- **[`scripts/benchmark-resources.sh`](file:///e:/Projects/minecraft-community/scripts/benchmark-resources.sh)**: Measures live container footprints and projects max agent scaling capacity on a 16GB RAM VPS.

---

### Shared Utilities (`shared/`)
- **[`shared/detailedLogger.js`](file:///e:/Projects/minecraft-community/shared/detailedLogger.js)** — `DetailedAuditLogger` class:
  - Logs granular streams to `logs/agents/<agentId>/` and `logs/world/`.
- **[`shared/logger.js`](file:///e:/Projects/minecraft-community/shared/logger.js)**: Standardized formatted console logging.
- **[`shared/constants.js`](file:///e:/Projects/minecraft-community/shared/constants.js)**: Action enum (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `WANDER`, `IDLE`, `TRADE`, `EXPLORE`, `BUILD`, `TALK`) and stat ranges.
