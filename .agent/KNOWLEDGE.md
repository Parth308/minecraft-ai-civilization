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
- **Emergent Social & Civilization Layer**:
  - **Cognition & Persona**: Dynamic evolving persona and autonomous goal generation (`persona.js`, `goals.js`).
  - **Social Dialogue**: Open-ended conversational social agent with free-will disposition (`dialogue.js`, `factions.js`).
  - **Generative Reflection**: Periodic LLM reflection synthesizing societal insights and worldviews (`reflection/engine.js`).
  - **Civilization Ledger**: Shared cultural state tracking emergent currencies, settlements, and treaties (`civilization/ledger.js`).

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
  - `createAgent()`: Instantiates Mineflayer client, loads pathfinder, initializes perception, actuators, stats, persona, goals, social dialogue, event buffer, memory client, and launches the 1-second main tick loop.
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

#### 5. Actuation Layer (`agent/actuation/`)
- **[`agent/actuation/movement.js`](file:///e:/Projects/minecraft-community/agent/actuation/movement.js)** — `MovementActuator` class:
  - `goto(x, y, z, range=1)`: Navigates using `GoalNear` pathfinding.
  - `gotoBlock(x, y, z)`: Navigates directly on top of specific block using `GoalBlock`.
  - `follow(entity, distance=2)`: Dynamically follows an entity using `GoalFollow`.
  - `fleeFrom(entity, distance=16)`: Calculates vector away from threat and navigates away.
  - `wander(radius=15)`: Picks random offset coordinate and wanders.
  - `stop()`: Clears active pathfinder goal and clears control states.
  - `isMoving()`: Checks if pathfinder is actively traversing a path.
  - `lookAt(x, y, z, force)` / `lookAtEntity(entity)`: Precise head aiming and yaw/pitch rotation.
  - `sprint(enable)`: Toggles sprinting state.
  - `sneak(enable)`: Toggles crouching/sneaking (essential for stealth, edge safety, hiding nametags).
  - `jump()`: Triggers jump.
  - `swim()` / `stopSwimming()`: Handles water swimming controls.

- **[`agent/actuation/combat.js`](file:///e:/Projects/minecraft-community/agent/actuation/combat.js)** — `CombatActuator` class:
  - `equipBestArmor()`: Auto-equips highest tier armor (netherite > diamond > iron > golden > leather) across helmet, chestplate, leggings, boots.
  - `equipBestWeapon()`: Auto-equips best sword or axe into main hand.
  - `useShield(enable)`: Equips shield in offhand and raises/lowers blocking stance.
  - `attack(entity)`: Auto-equips armor & weapon, aims head directly at entity, and strikes.
  - `stopCombat()`: Disengages combat and lowers shield.

- **[`agent/actuation/inventory.js`](file:///e:/Projects/minecraft-community/agent/actuation/inventory.js)** — `InventoryActuator` class:
  - `getFoodCategories()`: Returns multi-tier categorization (`comfort`, `emergency`, `desperation`).
  - `findBestFood(health, hunger)`: Selects optimal food item based on physical state.
  - `eatFood(health, hunger)`: Equips selected food and consumes it.
  - `equipOptimalTool(block)`: Automatically equips matching tool (pickaxe for stone/ore, axe for wood, shovel for dirt/sand, shears for leaves/wool).
  - `digBlock(block)`: Equips optimal tool and excavates block.
  - `placeBlock(blockName, referenceBlock, faceVector)`: Places block against reference block with precise vector.
  - `dropItem(itemName, count)`: Drops items to ground.
  - `tossItemToPlayer(itemName, playerEntity, count)`: Aims at player and tosses item directly at them.
  - `openChestAndDeposit(chestBlock, itemNames)`: Transfers items into chests.
  - `openChestAndWithdraw(chestBlock, itemNames)`: Retrieves items from chests.
  - `craftItem(itemName, count)`: Automatically finds matching recipe in bot registry and crafts item.
  - `listInventory()`: Returns formatted array of item names and stack counts.

- **[`agent/actuation/chat.js`](file:///e:/Projects/minecraft-community/agent/actuation/chat.js)** — `ChatActuator` class:
  - `say(message)`: Broadcasts message to public server chat.
  - `whisper(username, message)`: Sends private direct message to specific player.

---

#### 6. Stats & Social Engine (`agent/stats/`) — Zero LLM
- **[`agent/stats/stats.js`](file:///e:/Projects/minecraft-community/agent/stats/stats.js)** — `StatsManager` class:
  - Manages numeric values: `health` (0-20), `hunger` (0-100%), `anger` (0-100%), `happiness` (0-100%), `fatigue` (0-100%).
  - `clamp(val)`: Constrains values within min/max bounds.
  - `updateHealth(mcHealth)` / `updateHungerFromMC(mcFood)`: Synchronizes with Minecraft engine.
  - `addAnger(amt)` / `addHappiness(amt)` / `addFatigue(amt)`: Modifies dynamic emotional states.
  - `getSummary()`: Returns snapshot object of all current stats.

- **[`agent/stats/decay.js`](file:///e:/Projects/minecraft-community/agent/stats/decay.js)** — `StatsDecayEngine` class:
  - `tick()`: Updates hunger, fatigue, anger calm-down, and happiness.

- **[`agent/stats/relationships.js`](file:///e:/Projects/minecraft-community/agent/stats/relationships.js)** — `RelationshipTracker` class:
  - `get(username)`: Retrieves trust (0-100) and affinity (0-100) for a player.
  - `updateTrust(username, delta)` / `updateAffinity(username, delta)`: Modifies player metrics.

---

#### 7. Decision Engine (`agent/decision/`)
- **[`agent/decision/confidence.js`](file:///e:/Projects/minecraft-community/agent/decision/confidence.js)** — `ConfidenceEvaluator` class:
  - `shouldEscalate(confidence)`: Returns true if rule score < `0.6`.
- **[`agent/decision/dynamicRules.js`](file:///e:/Projects/minecraft-community/agent/decision/dynamicRules.js)** — `DynamicRuleEngine` class:
  - `learnRule(situationPayload, decisionData)`: Replicates LLM decisions locally with confidence `0.85` and writes durable survival tactics into `skills.md`.
  - `evaluateDynamicRules(senses, stats)`: Returns candidate actions generated from learned rules.
- **[`agent/decision/rules/`](file:///e:/Projects/minecraft-community/agent/decision/rules/)**:
  - `eat.js`, `flee.js`, `fight.js`, `sleep.js`, `mine.js`, `explore.js`, `trade.js`.
- **[`agent/decision/tree.js`](file:///e:/Projects/minecraft-community/agent/decision/tree.js)** — `DecisionTree` class:
  - `evaluate(senses, statsManager)`: Combines static and dynamic rules, selects top action, escalates to Brain Broker if confidence < `0.6`.
- **[`agent/decision/escalate.js`](file:///e:/Projects/minecraft-community/agent/decision/escalate.js)** — `EscalationManager` class:
  - `escalate(situationContext)`: Dispatches payload to `BrainClient`.

---

#### 8. Memory Client (`agent/memory/`)
- **[`agent/memory/buffer.js`](file:///e:/Projects/minecraft-community/agent/memory/buffer.js)** — `EventBuffer` class:
  - `addEvent(type, payload)`: Appends event; flushes at capacity (20).
- **[`agent/memory/client.js`](file:///e:/Projects/minecraft-community/agent/memory/client.js)** — `MemoryClient` class:
  - `flushBuffer(events)`: Calls `POST /api/memory/compact`.
  - `queryMemories(query, section, limit)`: Calls `GET /api/memory/query`.

---

### Central Brain Broker Service (`broker/`)
- **[`broker/Dockerfile`](file:///e:/Projects/minecraft-community/broker/Dockerfile)**: Docker container build.
- **[`broker/index.js`](file:///e:/Projects/minecraft-community/broker/index.js)**: Express REST server on port `3001`.
- **[`broker/config.js`](file:///e:/Projects/minecraft-community/broker/config.js)**: API keys and port configuration.
- **[`broker/router.js`](file:///e:/Projects/minecraft-community/broker/router.js)** — `ProviderRouter` class:
  - Supports task modes: `REASONING`, `CHAT`, `REFLEX`, `SOCIAL_CHAT`, `REFLECTION`.
  - Injects dynamic persona, active goals, and free-will directives into prompts.
- **[`broker/rateLimiter.js`](file:///e:/Projects/minecraft-community/broker/rateLimiter.js)**: Provider cooldown manager.
- **[`broker/cache/exactCache.js`](file:///e:/Projects/minecraft-community/broker/cache/exactCache.js)**: SHA-256 state hash cache.
- **[`broker/cache/semanticCache.js`](file:///e:/Projects/minecraft-community/broker/cache/semanticCache.js)**: Cosine similarity vector cache ($\ge 0.88$).

---

### Central Memory Service (`memory-service/`)
- **[`memory-service/Dockerfile`](file:///e:/Projects/minecraft-community/memory-service/Dockerfile)**: Docker container build.
- **[`memory-service/index.js`](file:///e:/Projects/minecraft-community/memory-service/index.js)**: Express REST server on port `3002`.
- **[`memory-service/embeddings/client.js`](file:///e:/Projects/minecraft-community/memory-service/embeddings/client.js)**: Detachable Gemini hosted vs local N-gram vector generator.
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

### Ops & Orchestration Scripts (`scripts/`)
- **[`docker-compose.yml`](file:///e:/Projects/minecraft-community/docker-compose.yml)**: Orchestrates Paper Server (2.5GB limit), Memory Service (256MB limit), Brain Broker (256MB limit), Agent Alpha (256MB limit), Agent Beta (256MB limit).
- **[`scripts/spawn-agent.sh`](file:///e:/Projects/minecraft-community/scripts/spawn-agent.sh)**: Spawns new dynamic agent containers with custom names and personalities.
- **[`scripts/benchmark-resources.sh`](file:///e:/Projects/minecraft-community/scripts/benchmark-resources.sh)**: Measures live container footprints and projects max agent scaling capacity on a 16GB RAM VPS.

---

### Shared Utilities (`shared/`)
- **[`shared/logger.js`](file:///e:/Projects/minecraft-community/shared/logger.js)**: Standardized formatted console logging.
- **[`shared/constants.js`](file:///e:/Projects/minecraft-community/shared/constants.js)**: Action enum (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `WANDER`, `IDLE`, `TRADE`, `EXPLORE`, `BUILD`, `TALK`) and stat ranges.
