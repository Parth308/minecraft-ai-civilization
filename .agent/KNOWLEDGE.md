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
  - **Central Memory Service**: Express.js on port `3002` (`memory-service/index.js`, 256MB RAM cap, `/health` endpoint with 50MB JSON parser limit)
  - **Civilization Control Dashboard**: Express.js + WebSocket on port `3003` (`dashboard/server/index.js`, 512MB RAM cap)
  - **Ollama Embeddings Service**: Port `11434` running `nomic-embed-text` (768-dim normalized vectors)
- **LLM Provider Pool (Free Tiers & Drivers)**:
  - **Gemini Flash (`gemini-2.5-flash`)**: Primary workhorse for complex reasoning, emotions, and Tier 2 memory consolidation.
  - **NVIDIA NIM (`meta/llama-3.1-70b-instruct`)**: High-intelligence secondary reasoning & diplomacy engine.
  - **Groq (`llama-3.1-8b-instant` / `qwen3.6-27b`)**: Primary for fast sub-second chat dialogue, quick reflexes, and Tier 1 buffer compaction.
  - **Cerebras (`llama3.1-8b`)**: Backup provider on rate limits (~1,800 tokens/sec).
  - **OpenRouter Free (`meta-llama/llama-3.1-8b-instruct:free` / `meta-llama/llama-3.2-3b-instruct`)**: Universal failover provider.
  - **Agnes AI (`agnes.js`)**: External conversational reasoning endpoint driver.
  - **LLM7 (`minimax-m2.7`)**: Extended fallback inference provider driver.
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
  - **Zero-Loss Chunked Retry Queue**: `agent/memory/client.js` buffers memory events in an in-memory queue, draining in 50-item chunks every 15s when `memory-service` comes online.
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
  - `username`: Agent player name (e.g. `Agent_Alpha`, `Agent_Beta`, `Agent_Gamma`).
  - `version`: Minecraft version target (`1.20.4`).
  - `prefix`: In-game chat command prefix (`!`).
  - `statusPort`: HTTP agent status server port (`3010`, `3011`, `3012`).
  - `personalitySeed`: Personality profile identifier (`friendly-explorer`, `cautious-builder`, `pragmatic-miner`).
  - `confidenceThreshold`: Escalation threshold score (`0.6`).
- **[`agent/index.js`](file:///e:/Projects/minecraft-community/agent/index.js)**
  - `createAgent()`: Instantiates Mineflayer client, loads pathfinder, initializes perception, actuators, stats, persona, goals, social dialogue, event buffer, memory client with retry queue, and launches the 1-second main tick loop.
  - `statusServer`: Runs lightweight HTTP server on `:3010+` serving `/status`, `/health`, and `/personality` (supports live trait hot-reloading).
  - `announceToDashboard()`: Periodically registers agent name and status URL with the Civilization Dashboard (`:3003`).
  - `executeDecision(decision)`: Translates decision tree output into physical actions (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `CRAFT`, `BUILD`, `TRADE`, `TALK`, `EXPLORE`, `WANDER`).

---

#### 2. Brain Client (`agent/brain-client/`)
- **[`agent/brain-client/client.js`](file:///e:/Projects/minecraft-community/agent/brain-client/client.js)** — `BrainClient` class:
  - `escalate(situationPayload)` / `escalateSituation(situationPayload)`: Transmits situation context to `http://brain-broker:3001/api/escalate`.
  - **Graceful Offline Fallback**: Returns fallback object adopting `topCandidate.name` or `WANDER` with zero-delta emotions if broker is unreachable.

---

#### 3. Cognitive & Goal Architecture (`agent/cognition/`)
- **[`agent/cognition/persona.js`](file:///e:/Projects/minecraft-community/agent/cognition/persona.js)** — `DynamicPersona` class:
  - **Truly Procedural Multi-Dimensional Persona Generation (`PERSONALITY_SEED=random`)**:
    - Rolls 7 completely independent continuous traits in `[0.10, 0.95]`: `curiosity`, `sociability`, `greed`, `loyalty`, `caution`, `ambition`, `openness`.
    - Synthesizes emergent procedural titles from dominant/secondary trait pairings (e.g. *Charismatic Herald*, *Restless Guardian*, *Honorable Strategist*, *Audacious Tycoon*, *Reckless Pathfinder*).
    - Procedurally derives speaking style, favorite items, life mottos, and privacy preferences (`public` if openness $\ge 0.60$, `private` if openness $\le 0.35$, else `ask`).
  - **Archetype Templates**: Supports named archetypes (`friendly-explorer`, `cautious-builder`, `shrewd-trader`, `lone-survivalist`, `reckless-miner`, `zen-gatherer`, `quirky-tinkerer`).
  - `traits`: Includes `openness` (0.0-1.0), `curiosity`, `sociability`, `greed`, `loyalty`, `caution`, `ambition`.
  - `privacyPreference`: `'public' | 'private' | 'ask'` (overridable via `PRIVACY_PREFERENCE` env, constructor, or `/personality` endpoint).
  - `setPrivacyPreference(pref)`: Live hot-reload of privacy mode.
  - `evolveFromExperience(eventType, impact)`: Mutes or amplifies traits in response to trauma (betrayals, scams, near-death) or triumph (cooperation, gifts).
  - `getPersonaPromptContext()`: Formats dynamic persona, traits, privacy preference, and free-will directives for LLM prompts.
- **[`agent/cognition/goals.js`](file:///e:/Projects/minecraft-community/agent/cognition/goals.js)** — `GoalManager` class:
  - `setGoal(description, details)`: Formulates an emergent short-term objective.
  - `setAspiration(aspiration)`: Establishes a life dream / long-term goal.
  - `markGoalCompleted(outcome)`: Logs goal completion with timestamp and status update.
  - `getGoalContext()`: Returns active goal snapshot.
- **[`agent/cognition/reflection.js`](file:///e:/Projects/minecraft-community/agent/cognition/reflection.js)** — `ReflectionEngine` class:
  - **Per-Event Micro-Reflection Architecture**: Runs after significant events (death, night transition, milestones), writes short 2-sentence diary entries tagged with `source: 'agent-diary'` to the central vector store.
  - **Profile Isolation Guard**: `allowProfileWrite = false` strictly enforces that agent micro-reflections NEVER touch or overwrite `profile.md`.
  - **Privacy-Aware Cross-Agent Sharing**:
    - `public`: Automatically broadcasts lessons to civilization ledger via `POST /api/ledger/lessons`.
    - `private`: Preserves lesson only in private agent memory.
    - `ask`: Prompts in-game chat for consent (`"I learned something: ... — should I share it?"`), sharing to the shared ledger only upon affirmation (`confirmPendingLessonShare(true)`).

---

#### 4. Social & Diplomatic Architecture (`agent/social/`)
- **[`agent/social/dialogue.js`](file:///e:/Projects/minecraft-community/agent/social/dialogue.js)** — `SocialDialogueEngine` class:
  - `processIncomingChat(sender, message, civContext)`: Parses natural chat messages from other bots or players, passes persona, goals, and history to Brain Broker (`SOCIAL_CHAT` task), updates dynamic relationship metrics, and returns natural spoken dialogue.
- **[`agent/social/factions.js`](file:///e:/Projects/minecraft-community/agent/social/factions.js)** — `FactionAffiliationManager` class:
  - `recordSecretBase(name, coords, notes)`: Records hidden private bases never published to the global ledger.
  - `declareWar(targetName, reason)` / `declarePeace(targetName)`: Manages hostile/war and peace states dynamically.
  - `recordTreaty(proposer, treatyType, honorsStatus)`: Logs treaties and whether the agent intends to honor or betray them.
  - `recognizeCurrency(currencyName)`: Tracks custom player-invented currencies the bot accepts.

---

#### 5. Perception Layer (`agent/perception/`)
- **[`agent/perception/senses.js`](file:///e:/Projects/minecraft-community/agent/perception/senses.js)** — `Senses` class:
  - `getNearbyMobs(maxDistance=16)`: Scans world entities for living non-player mobs.
  - `getNearbyHostileMobs(maxDistance=16)`: Scans 25 hostile types (zombies, skeletons, creepers, phantoms, wardens, blazes, ghasts, etc.).
  - `getNearbyPassiveMobs(maxDistance=16)`: Scans 20 passive types (cows, pigs, sheep, villagers, frogs, allays, etc.).
  - `getNearbyPlayers(maxDistance=32)`: Scans all online players with spawned entities.
  - `getNearbyItems(maxDistance=16)`: Finds dropped `Item` object-type entities on the ground.
  - `getNearbyProjectiles(maxDistance=12)`: Detects incoming arrows, fireballs, tridents, wither skulls within radius.
  - `getNearbyBlock(blockName, maxDistance=16)` / `getNearbyBlocks(blockName, maxDistance, count)`: Block scanning with null-filtered results.
  - `getNearbyBed(16)`, `getNearbyChests(16)`, `getNearbyFurnaces(16)`, `getNearbyCraftingTables(8)`.
  - `getNearbyOres(16)`: Finds all ore types including `ancient_debris`, `emerald_ore`, `nether_quartz_ore`.
  - `getNearbyTrees(16)`, `getNearbyWater(16)`, `getNearbyLava(16)`.
  - `isNight()`, `getTimeOfDay()`, `getLightLevel()`, `getBiome()`, `isRaining()`.
  - `isInWater()`, `isOnFire()`, `isUnderground()` (Y < 60), `isFalling()`.
  - `getInventoryFood()`, `getInventoryTools()`, `getEquipmentSummary()` (includes offhand slot).
  - `hasItem(itemName)`: Boolean item existence check.
  - `countItem(itemName)`: Total stack count across all inventory slots.
  - `canSeeEntity(entity)`: Line-of-sight raycast with try/catch protection.
- **[`agent/perception/events.js`](file:///e:/Projects/minecraft-community/agent/perception/events.js)** — `EventObserver` class (EventEmitter):
  - Emits: `agentHurt`, `agentDeath`, `agentRespawn`, `underAttack`, `nearbyAttackSwing`, `incomingProjectile`, `agentOnFire` / `agentFireOut`, `playerChat`, `playerWhisper`, `playerJoined`, `playerLeft`, `itemCollected`, `blockBroken`, `blockPlaced`, `weatherChanged`, `timeTransition`.
  - **Item Metadata Resolution**: Resolves item IDs using `metadata[8]` / `metadata[7]` mapped through `bot.registry.items[id].name` with fallback to entity name.
  - **Mining Block Pre-Cache**: Caches block metadata on `diggingStarted` so `diggingCompleted` accurately identifies the mined block instead of post-break `air`.
  - Fire detection: 500ms interval polling `bot.entity.onFire` with debounce.
  - Attacker identification: Uses nearby entity proximity scan as proxy since mineflayer lacks direct hit-source API.

---

#### 6. Actuation & Skills Layer (`agent/actuation/`, `agent/skills/`)
- **[`agent/skills/builder.js`](file:///e:/Projects/minecraft-community/agent/skills/builder.js)** — `BuilderSkill` class:
  - `buildShelter(origin, width, length, height)`: Scans inventory for building blocks (planks, cobblestone, stone, dirt, wood, brick) and erects perimeter shelter walls with entrance.
  - **Failure Handling & Cooldown**: If `placedCount === 0`, marks the target site invalid in `invalidSites`, resets active building goals in `GoalManager`, and enforces a 60-second cooldown before shelter building can be re-triggered.
  - `getAvailableBuildingBlocks()`: Returns valid structural block items from inventory.
- **[`agent/skills/barter.js`](file:///e:/Projects/minecraft-community/agent/skills/barter.js)** — `BarterSkill` class:
  - `executeTrade(partner, giveItem, giveCount, wantItem, wantCount)`: Coordinates peer-to-peer item exchanges, navigates within trading distance, looks at partner, drops offer, and monitors exchange.
- **[`agent/actuation/movement.js`](file:///e:/Projects/minecraft-community/agent/actuation/movement.js)** — `MovementActuator` class:
  - `goto(x, y, z, range=1)`, `gotoBlock(x, y, z)`, `follow(entity, distance=2)`, `fleeFrom(entity, distance=16)` (null-guarded), `wander(radius=15)`, `stop()`, `isMoving()`.
  - `lookAt(x, y, z, force)` / `lookAtEntity(entity)`: Precise head aiming.
  - `sprint(enable)`, `sneak(enable)`, `jump()`, `swim()` / `stopSwimming()`.
- **[`agent/actuation/combat.js`](file:///e:/Projects/minecraft-community/agent/actuation/combat.js)** — `CombatActuator` class:
  - `equipBestArmor()`: Auto-equips highest tier armor (netherite > diamond > iron > golden > chainmail > leather) across all 4 slots.
  - `equipBestWeapon()`: Auto-equips best sword or axe into main hand.
  - `hasBow()` / `hasArrows()`: Inventory presence checks.
  - `useShield(enable)`: Equips shield in offhand and raises/lowers blocking stance.
  - `criticalAttack(entity)`: Jumps, waits for descent, then hits for 1.5× damage (Minecraft crit mechanic).
  - `bowAttack(entity)`: Equips bow, charges for 1 full second (full power shot), releases. Falls back to melee if no bow/arrows.
  - `engageMelee(entity)`: Sustained combat loop (200ms tick): chases with `GoalFollow`, respects 630ms attack cooldown, uses crit every 3rd hit, auto-stops when target dies.
  - `attack(entity)`: Orchestrates full combat: equips armor, tries bow if target is >6m away + has bow, then falls back to sustained melee loop.
  - `stopCombat()`: Clears combat loop interval, disengages pathfinding, lowers shield.
- **[`agent/actuation/inventory.js`](file:///e:/Projects/minecraft-community/agent/actuation/inventory.js)** — `InventoryActuator` class:
  - `_navigateWithin(pos, range=3, timeoutMs=15000)`: Shared proximity navigation helper for digging, placing, opening chests, and crafting.
  - `getFoodCategories()`, `findBestFood(health, hunger)`, `eatFood(health, hunger)`.
  - `equipOptimalTool(block)`: Automatically equips matching tool (pickaxe for stone/ore, axe for wood, shovel for dirt/sand, shears for leaves/wool).
  - `digBlock(block)`: Navigates within 3m, equips tool, looks at block center, excavates, and runs vacuum pickup on drops.
  - `placeBlock(blockName, referenceBlock, faceVector)`: Navigates within 3m, looks at face center, equips block, places.
  - `dropItem(itemName, count)`: Clamps count to available stack size and tosses.
  - `tossItemToPlayer(itemName, playerEntity, count)`: Faces player before tossing.
  - `openChestAndDeposit(chestBlock, itemNames)` / `openChestAndWithdraw(chestBlock, itemNames)`: Proximity navigation and container transfer.
  - `craftItem(itemName, count)`: Auto-searches for crafting table within 8m, places mobile table if needed (with smart alcove carving), crafts via `bot.craft()`, and automatically recovers workbench. On `missing ingredient` error, automatically invokes `setCraftCooldown(itemName, 30000)`.
  - `listInventory()`: Returns formatted inventory item objects.
- **[`agent/actuation/chat.js`](file:///e:/Projects/minecraft-community/agent/actuation/chat.js)** — `ChatActuator` class:
  - `say(message)`: Enqueues to rate-limited FIFO queue (1.2s interval) to prevent server kicks for chat flooding.
  - `whisper(username, message)`: Rate-limited private whisper (capped at 256 characters).

---

#### 7. Stats & Social Engine (`agent/stats/`) — Zero LLM
- **[`agent/stats/stats.js`](file:///e:/Projects/minecraft-community/agent/stats/stats.js)** — `StatsManager` class:
  - Manages numeric vitals and emotions: `health` (0-20), `hunger` (0-100%), `anger` (0-100%), `happiness` (0-100%), `fatigue` (0-100%).
  - Provides modifiers: `addAnger()`, `addHappiness()`, `addFatigue()`, `setHealth()`, `setHunger()`, `getSummary()`.
- **[`agent/stats/decay.js`](file:///e:/Projects/minecraft-community/agent/stats/decay.js)** — `StatsDecayEngine` class:
  - Applies periodic decay ticks (hunger reduction on movement, fatigue accumulation, emotional stabilization).
- **[`agent/stats/relationships.js`](file:///e:/Projects/minecraft-community/agent/stats/relationships.js)** — `RelationshipTracker` class:
  - Tracks per-peer relationship metrics: `affinity` (-1.0 to 1.0), `trust` (0.0 to 1.0), `familiarity`, and recent interaction timestamps.

---

#### 8. Decision Engine (`agent/decision/`)
- **[`agent/decision/confidence.js`](file:///e:/Projects/minecraft-community/agent/decision/confidence.js)** — `ConfidenceEvaluator` class:
  - Compares evaluated confidence scores against threshold (`0.6`) to determine when LLM escalation is needed.
- **[`agent/decision/dynamicRules.js`](file:///e:/Projects/minecraft-community/agent/decision/dynamicRules.js)** — `DynamicRuleEngine` class:
  - `learnRule(situation, decision)`: Learns new dynamic rules from LLM escalations (initial confidence `0.72`).
  - `decayRules(maxIdleMs=1200000)`: Every 500 ticks, decays unreinforced rules by 10% and prunes rules whose confidence falls below `0.20`.
  - `reinforceRule(ruleId, outcomeSuccess)`: Asymmetric reinforcement (+0.05 on success, -0.15 on failure).
  - `seedFromSharedLessons(memoryServiceUrl)`: Pulls public civilization lessons from ledger and seeds initial rules at `0.40` confidence.
  - `pollRuleAdjustments(agentId, memoryServiceUrl)` & `applyRuleAdjustment(adj)`: Ingests macro-reflection rule weight adjustments (+/- delta) from memory service.
- **[`agent/decision/escalate.js`](file:///e:/Projects/minecraft-community/agent/decision/escalate.js)** — `EscalationManager` class:
  - Formats rich situation context (inventory, equipment, position, biome, light, hostiles, goals, persona) and dispatches to `BrainClient` (supports `RESEARCH` task mode routing).
- **[`agent/decision/tree.js`](file:///e:/Projects/minecraft-community/agent/decision/tree.js)** — `DecisionTree` class:
  - Gathers static and dynamic rule evaluations, forwards active `ruleId`, applies persona trait weighting, and triggers `RESEARCH` task mode escalation when unknown mechanics or repeated recipe failures occur.
- **[`agent/decision/rules/`](file:///e:/Projects/minecraft-community/agent/decision/rules/)** — Specialized Rule Evaluators:
  - **`craft.js`**: Strict prerequisite ingredient validation ensuring all required items exist in inventory before returning confidence $\ge 0.9$. Integrates recipe cooldown registry (`setCraftCooldown`, `isCraftOnCooldown`).
  - **`eat.js`**: Evaluates hunger ($\le 60\%$) and health ($< 15$) to propose eating comfort, emergency, or desperation food.
  - **`explore.js`**: Proposes wandering/exploration based on curiosity and daytime conditions.
  - **`fight.js`**: Evaluates weapon readiness and hostile mob proximity within 8m.
  - **`flee.js`**: Evaluates mortal danger (health $\le 6$), hostile swarms (3+ enemies), and **Night-Awareness** (unarmored/unarmed agents prioritize `FLEE` and retreat to shelter during night cycle or light level $\le 7$).
  - **`mine.js`**: Ore value ranking (`diamond` > `iron` > `coal` > `stone`), enforces tool tier requirements (wooden for coal/stone, stone for iron/copper, iron for gold/diamond).
  - **`sleep.js`**: Proposes sleep when night falls and a bed is within range.
  - **`talk.js`**: Proposes social dialogue when other players/bots are nearby, respecting a 45s conversational cooldown.
  - **`trade.js`**: Proposes barter when inventory surplus exists and peers are in vicinity.

---

#### 9. Memory Client & Resilient Queue (`agent/memory/`)
- **[`agent/memory/buffer.js`](file:///e:/Projects/minecraft-community/agent/memory/buffer.js)** — `EventBuffer` class:
  - Rolling 20-event buffer that compacts and fires callbacks on overflow.
- **[`agent/memory/client.js`](file:///e:/Projects/minecraft-community/agent/memory/client.js)** — `MemoryClient` class:
  - `flushBuffer(events)`: Pushes events to local `pendingQueue` and attempts drain.
  - `drainQueue()`: Chunks backlog into max 50-event batches in a loop. On temporary failure, only the failing batch is re-queued to the head of the queue, preventing body payload overflows.
  - `queryMemories(query, section, limit)`: Proxies vector search queries to `GET /api/memory/query`.

---

### Central Brain Broker Service (`broker/`)
- **[`broker/Dockerfile`](file:///e:/Projects/minecraft-community/broker/Dockerfile)**: Docker container build with `/health` check.
- **[`broker/config.js`](file:///e:/Projects/minecraft-community/broker/config.js)**: API keys and port configuration (`GEMINI_API_KEY`, `GROQ_API_KEY`, `NVIDIA_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`, `AGNES_API_KEY`, `LLM7_API_KEY`).
- **[`broker/index.js`](file:///e:/Projects/minecraft-community/broker/index.js)**: Express REST server on port `3001` exposing `POST /api/escalate` and `GET /health`.
- **[`broker/router.js`](file:///e:/Projects/minecraft-community/broker/router.js)** — `ProviderRouter` class:
  - Supports task modes: `REASONING`, `CHAT`, `REFLEX`, `SOCIAL_CHAT`, `REFLECTION`, `RESEARCH`.
  - **RESEARCH Task Mode**: Automatically executes `WebKnowledgeClient` query before LLM dispatch, injects real Minecraft wiki / mechanic knowledge into prompt context, and executes fallback provider cascade.
  - Executes resilient provider fallback cascade when primary endpoints rate-limit or fail.
- **[`broker/rateLimiter.js`](file:///e:/Projects/minecraft-community/broker/rateLimiter.js)**: Provider cooldown manager + per-agent task rate limiter (enforces max 1 `RESEARCH` task per agent per 5 minutes).
- **[`broker/cache/exactCache.js`](file:///e:/Projects/minecraft-community/broker/cache/exactCache.js)**: SHA-256 state hash cache with 300s TTL.
- **[`broker/cache/semanticCache.js`](file:///e:/Projects/minecraft-community/broker/cache/semanticCache.js)**: Cosine similarity vector cache ($\ge 0.88$).
- **[`broker/search/webSearch.js`](file:///e:/Projects/minecraft-community/broker/search/webSearch.js)** — `WebKnowledgeClient` class:
  - Live Minecraft Wiki Search API integration (`minecraft.wiki/api.php`) + built-in architectural blueprint, combat, barter, and mining mechanics database.
- **[`broker/providers/`](file:///e:/Projects/minecraft-community/broker/providers/)** — Individual LLM Drivers:
  - **`gemini.js`**: Google Gemini Flash API driver (`gemini-2.5-flash`).
  - **`nvidia.js`**: NVIDIA NIM API driver (`meta/llama-3.1-70b-instruct`).
  - **`groq.js`**: Groq fast sub-second inference driver (`llama-3.1-8b-instant` / `qwen3.6-27b`).
  - **`cerebras.js`**: Cerebras ultra-fast inference driver (`llama3.1-8b`).
  - **`openrouter.js`**: OpenRouter free & paid fallback driver (`meta-llama/llama-3.1-8b-instruct:free` / `meta-llama/llama-3.2-3b-instruct`).
  - **`agnes.js`**: Agnes AI endpoint driver.
  - **`llm7.js`**: LLM7 / Minimax endpoint driver (`minimax-m2.7`).

---

### Central Memory Service (`memory-service/`)
- **[`memory-service/Dockerfile`](file:///e:/Projects/minecraft-community/memory-service/Dockerfile)**: Docker container build with `/health` check.
- **[`memory-service/config.js`](file:///e:/Projects/minecraft-community/memory-service/config.js)**: Memory store file paths, embedding provider configuration, and compaction schedules.
- **[`memory-service/index.js`](file:///e:/Projects/minecraft-community/memory-service/index.js)**: Express REST server on port `3002` with 50MB payload parsing limit (`express.json({ limit: '50mb' })`). Exposes:
  - `GET /health`
  - `POST /api/memory/init`, `POST /api/memory/compact`, `POST /api/memory/consolidate`
  - `GET /api/memory/query`, `GET /api/memory/sections/:agentId/:section`
  - `GET /api/ledger`, `GET /api/ledger/lessons`, `POST /api/ledger/lessons`
  - `GET /api/ledger/trades`, `POST /api/ledger/trades`
  - `GET /api/ledger/territory`, `GET /api/ledger/territory/all`, `POST /api/ledger/territory/claim`
  - `GET /api/ledger/shared-goals`, `POST /api/ledger/shared-goals/propose`, `POST /api/ledger/shared-goals/join`, `POST /api/ledger/shared-goals/contribute`
  - `GET /api/ledger/chronicle`, `POST /api/ledger/chronicle`
  - `POST /api/rules/adjust`, `GET /api/rules/adjust/:agentId`
- **[`memory-service/embeddings/client.js`](file:///e:/Projects/minecraft-community/memory-service/embeddings/client.js)** — `EmbeddingClient` class:
  - Supports **Ollama (`nomic-embed-text`)**, **Gemini (`text-embedding-004`)**, and **Local N-Gram Fallback** with L2 vector normalization.
- **[`memory-service/store/vectorStore.js`](file:///e:/Projects/minecraft-community/memory-service/store/vectorStore.js)**: Memory vector store and semantic search.
- **[`memory-service/sections/schema.js`](file:///e:/Projects/minecraft-community/memory-service/sections/schema.js)**: Sectioned markdown manager (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`).
- **[`memory-service/router.js`](file:///e:/Projects/minecraft-community/memory-service/router.js)**: Zero-LLM event router for memory entries.
- **[`memory-service/sections/compactor.js`](file:///e:/Projects/minecraft-community/memory-service/sections/compactor.js)**: Two-tier compaction engine.
- **[`memory-service/scheduler.js`](file:///e:/Projects/minecraft-community/memory-service/scheduler.js)**: Background compaction sweep scheduler.
- **[`memory-service/reflection/engine.js`](file:///e:/Projects/minecraft-community/memory-service/reflection/engine.js)** — `GenerativeReflectionEngine` class:
  - **Periodic Macro-Reflection Architecture**: Sole authorized writer to `profile.md` (tagged with `source: 'macro-reflection'`), synthesizing worldview and high-level insights across history, skills, and relationships.
  - **Prose-to-Weight Feedback Loop**: Runs structured extraction pass converting prose realizations into numeric rule adjustments (`POST /api/rules/adjust`).
- **[`memory-service/store/civilization/ledger.js`](file:///e:/Projects/minecraft-community/memory-service/store/civilization/ledger.js)** — `CivilizationLedger` class:
  - **Emergent Economics & Trade**: `recordTrade()` logs market transactions with calculated fairness score.
  - **Spatial Sovereignty**: `claimTerritory()` with radius-based collision rejection, `getTerritoryAt()`, `getTerritoryClaims()`.
  - **Coordinated Community Projects**: `createSharedGoal()`, `joinSharedGoal()`, `contributeToSharedGoal()` tracking collaborative milestones.
  - **Living Chronicle & Lore Feed**: `addChronicleEntry()`, `getChronicle()`, `recordTreaty()` auto-generating evocative historical chronicles across treaties, territorial settlements, and communal victories.
  - **Shared Lessons**: Public lore discovery pool with per-agent privacy opt-in (`public`, `private`, `ask`).

---

### Civilization Control Dashboard (`dashboard/`)
- **[`dashboard/Dockerfile`](file:///e:/Projects/minecraft-community/dashboard/Dockerfile)**: Docker container build (Node 20 Alpine, 512MB RAM cap) with `/health` check.
- **[`dashboard/package.json`](file:///e:/Projects/minecraft-community/dashboard/package.json)**: `express`, `ws`, `mineflayer`, `prismarine-viewer`, `http-proxy-middleware`.
- **[`dashboard/server/index.js`](file:///e:/Projects/minecraft-community/dashboard/server/index.js)**: Express REST server on port `3003` + WebSocket server on `/ws` + reverse proxy for `prismarine-viewer` on `/viewer`.
- **[`dashboard/server/aggregator.js`](file:///e:/Projects/minecraft-community/dashboard/server/aggregator.js)**: Polls Brain Broker (5s), Memory Service (5s), Agent status endpoints (2s), diffs chat, and broadcasts WebSocket snapshots.
- **[`dashboard/server/spectator.js`](file:///e:/Projects/minecraft-community/dashboard/server/spectator.js)**: Embedded `SpectatorBot` mineflayer client with OP and spectator noclip teleportation.
- **[`dashboard/server/rcon.js`](file:///e:/Projects/minecraft-community/dashboard/server/rcon.js)**: Zero-dependency Minecraft RCON client implementation.
- **[`dashboard/server/routes/`](file:///e:/Projects/minecraft-community/dashboard/server/routes/)**:
  - `health.js`: Health metrics and response times for all microservices.
  - `agents.js`: Snapshot, trait scar summaries (`scarHistory`, `scarCount`), and details for all active agents.
  - `chat.js`: Relays chat history and enables browser-based operator chat messages via `/tellraw` with `[Operator]` prefix.
  - `memory.js`: Memory query and raw section retrieval proxies.
  - `ledger.js`: Civilization ledger & chronicle feed proxy (`/api/dashboard/chronicle`).
  - `timeline.js`: Historical timeline scrubber route (`GET /api/timeline?agentId=&from=&to=`).
- **[`dashboard/client/`](file:///e:/Projects/minecraft-community/dashboard/client/)**:
  - `index.html`: Responsive multi-view dashboard (Overview, 3D World View, Agents with Scar Badges, Decisions, Chronicle Lore Feed, Costs & Limits).
  - `styles.css`: Cyberpunk visual design system, glassmorphism panels, stat meters, confidence rings, and scrubber controls.
  - `app.js`: Real-time WebSocket telemetry + Timeline Replay scrubber (step, seek, play/pause historical states) + Chronicle feed.

---

### Shared Utilities (`shared/`)
- **[`shared/detailedLogger.js`](file:///e:/Projects/minecraft-community/shared/detailedLogger.js)** — `DetailedAuditLogger` class:
  - Logs granular streams to `logs/agents/<agentId>/` and `logs/world/` (`global_timeline.log`, `civilization_events.log`).
- **[`shared/logger.js`](file:///e:/Projects/minecraft-community/shared/logger.js)**: Standardized formatted console logging with timestamps and tags.
- **[`shared/constants.js`](file:///e:/Projects/minecraft-community/shared/constants.js)**: Action enum and `SCARCE_RESOURCES` tier (`emerald`, `diamond`, `ancient_debris`, `netherite_scrap`, `gold_ingot`, `iron_ingot`) with scarcity weights and base values.
