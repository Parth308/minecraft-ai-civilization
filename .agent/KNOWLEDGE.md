# Workspace Knowledge Base & Architecture Index

This document serves as the complete technical specification, architectural reference, and function-by-function catalog for the Minecraft AI Civilization project.

---

## 1. Tech Stack Summary
- **Runtime**: Node.js 20 (Alpine Linux container images) with `--max-old-space-size=400` on each Node agent container.
- **Orchestration**: Docker Compose with strict per-container resource constraints (`cpus`, `memory`), global `json-file` log rotation (50MB max, 3 files), and microservice health checks (`condition: service_healthy`).
- **Fleet Capacity**: 8 autonomous bot containers (`agent-alpha` through `agent-hotel` on ports `3010`-`3017` for HTTP status and `3020`-`3027` for native 3D POV streams).
- **Game Engine Bot Client**: `mineflayer` (^4.20.1)
- **Pathfinding Engine**: `mineflayer-pathfinder` (^2.4.5) with 3D A* navigation
- **Vector Utilities**: `vec3` (^0.1.10)
- **Minecraft Server**: Paper Minecraft Server 1.20.4 (`itzg/minecraft-server` in Docker, `online-mode=false`, `VIEW_DISTANCE=6`, capped at 2.5GB RAM, RCON enabled).
- **HTTP Microservices**:
  - **Brain Broker Service**: Express.js on port `3001` (`broker/index.js`, 256MB RAM cap, `/health` endpoint).
  - **Central Memory Service**: Express.js on port `3002` (`memory-service/index.js`, 256MB RAM cap, `/health` endpoint with 50MB JSON parser limit).
  - **Civilization Control Dashboard**: Express.js + WebSocket on port `3003` (`dashboard/server/index.js`, 512MB RAM cap).
  - **Ollama Embeddings Service**: Port `11434` running `nomic-embed-text` (768-dim normalized vectors).
- **LLM Provider Pool (Free Tiers & Drivers)**:
  - **Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fp8-fast`)**: #1 high-volume lane (10,000 free neurons/day) for social chatter and rapid reflex actions.
  - **Mistral (`mistral-small-latest`)**: ~1B tokens/month free tier; primary workhorse for deep macro-reflection and Tier 2 memory consolidation.
  - **NVIDIA NIM (`meta/llama-3.1-8b-instruct`, `meta/llama-3.1-70b-instruct`)**: High-intelligence secondary reasoning, planning, and Tier 2 consolidation engine.
  - **Groq (`llama-3.1-8b-instant`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.6-27b`)**: Fast sub-second dialogue and reflex provider with candidate fallback cascade.
  - **Cerebras (`llama3.1-8b`, `llama-3.3-70b`, `gpt-oss-120b`)**: Dynamic live model catalog discovery with automatic candidate fallback (~1,800 tokens/sec).
  - **Cohere (`command-a-02-2025`, `command-r7b-12-2024`)**: 20 RPM permanent free evaluation tier for command reasoning and reflection.
  - **Alibaba DashScope / Qwen (`qwen-flash`, `qwen-plus`, `qwen-turbo`)**: International OpenAI-compatible mode with 1M free tokens per candidate model.
  - **HuggingFace Inference Router (`meta-llama/Llama-3.1-8B-Instruct`, `deepseek-ai/DeepSeek-V3-0324`)**: Serverless inference routing.
  - **OpenRouter Free (`meta-llama/llama-3.3-70b-instruct:free`, `nvidia/nemotron-3.5-lightning:free`, `google/gemma-2-9b-it:free`)**: Universal failover pool with automatic free model rotation.
  - **Agnes AI (`agnes.js`)**: External conversational reasoning endpoint driver (`agnes-2.0-flash`).
  - **LLM7 (`minimax-m2.7`)**: Extended fallback inference provider driver.
  - **Gemini Flash (`gemini-2.5-flash`)**: High-intelligence multimodal reasoning (daily quotas, resets 00:00 UTC).
  - **GitHub Models (`openai/gpt-4o-mini`)**: PAT-backed fallback driver.
  - **LiteRouter (`deepseek-v3.2:free`) & TokenReply (`gemini-3.7-flash-default-free`)**: Auxiliary free-model endpoints.
  - **Task-Specific Provider Routing**: `getPreferredProviders(taskType)` routes `REASONING`/`PLAN`/`RESEARCH` to thinking models (Groq, Mistral, Nvidia, SiliconFlow, Cohere) and `SOCIAL_CHAT`/`REFLEX` to high-throughput dialogue models (Cloudflare, Groq, Nvidia, Qwen, Mistral, OpenRouter).
  - **Circuit Breaker**: `broker/rateLimiter.js` quarantines failing providers for 30 minutes on 5 consecutive transient failures, or 1 hour on 2 strikes for permanent authorization/quota errors (401, 402, 403, 404, 410). Tracks `breakerTrips` and failure streaks.
  - **Human-like Anti-Stuck Loop Breaker**: `DecisionTree` detects repetitive non-productive actions (6+ consecutive unrewarded explore/wander/mine ticks) and forces strategic planning escalation to formulate multi-step goals.
- **Detachable Embeddings Engine & LRU Caching**:
  - **Ollama**: `nomic-embed-text` (768-dim normalized vectors via `POST /api/embeddings`).
  - **Hosted**: Gemini `text-embedding-004` (768 dimensions).
  - **Local**: Fast deterministic token frequency & N-gram hashing into unit hypersphere.
  - **LRU In-Memory Cache**: 2000-entry SHA-1 keyed cache in `EmbeddingClient` eliminating redundant Ollama computation and host CPU bottlenecks.
  - **Snapshot Persistence**: `VectorMemoryStore` periodically serializes memory embeddings to `vectorIndex.snapshot.json` to prevent re-indexing churn on reboot.
- **Dual-Layer Caching Architecture**:
  - **Layer 1**: SHA-256 exact-match state hash cache with 300s TTL (`broker/cache/exactCache.js`).
  - **Layer 2**: Cosine similarity semantic vector cache with $\ge 0.88$ threshold (`broker/cache/semanticCache.js`).
  - **Agency Bypass**: Both caches are strictly bypassed for `CHAT`, `REFLECTION`, `PLAN`, and anti-stuck-loop escalations (`shouldSkipCache` in `broker/router.js`), so dynamic, social, and planning behavior is never served a stale cached decision.
- **Affordance-Grounded Prompting**:
  - [`agent/perception/affordances.js`](file:///e:/Projects/minecraft-community/agent/perception/affordances.js): Synchronous `build(bot, senses, stats)` engine computing verified capabilities per tick — `craftable` (real recipe math against inventory via `bot.registry.recipes`, shaped + shapeless + ingredient alternatives, `needsTable` from grid size), `notCraftable` (with missing-ingredient reasons), `minable` / `blockedMine` (tool-tier gated, mirroring mine.js rules), `harvestable`, `food`, `furniture`, `tradeablePlayers`, `dangers`. Attached as `payload.affordances` in `DecisionTree.evaluate` and rendered as a "WHAT YOU CAN DO RIGHT NOW" prompt section by `broker/router.js`.
  - **Action Outcome Feedback Loop**: `executeDecision` records `agentState.lastActionResult = { action, ok, detail }`; the next escalation renders it as "LAST ACTION OUTCOME" so the LLM never blindly repeats failed actions.
  - **Native Structured JSON Output**: Groq/Cerebras/OpenRouter/Nvidia/Cohere receive `response_format: {type: 'json_object'}` and Gemini `responseMimeType: 'application/json'` for REASONING/PLAN/RESEARCH/SOCIAL_CHAT/EMOTION tasks; regex-based `parseLLMResponse` remains as universal fallback.
  - **Learned-Skills Few-Shot Injection**: `ProviderRouter.fetchRelevantSkills()` queries `/api/memory/query?section=skills` (top 3 cosine matches) and injects them as "TRICKS YOU LEARNED BEFORE" examples.
- **PLAN v2 Multi-Step Executor**:
  - LLM may return a `steps[]` array (2-6 short executable steps) alongside PLAN; `GoalManager.setPlan()/advancePlan()/failCurrentStep()/clearPlan()` manage the queue.
  - Tick loop executes plan steps WITHOUT further LLM calls via keyword mapping (`planStepToDecision`: craft/smelt/mine/eat/build/harvest/farm/sleep/chest/equip/explore); advances on success, abandons plan after 2 consecutive failures on one step.
- **Pre-Flight Decision Validation**: Escalated decisions are locally validated before execution — ore mining without sufficient pickaxe tier falls back to the local target chain, daytime SLEEP overrides to WANDER, TRADE without nearby players falls back to top rule candidate.
- **Community Plugins**: `mineflayer-collectblock` (CJS) powers MINE with robust pathfind-collect-pickup (digBlock fallback); `mineflayer-auto-eat` v5 (ESM-only, loaded via dynamic `import()`) handles survival eating with foodPoints priority and hazardous-food bans.
- **Memory Architecture & Resiliency**:
  - Sectioned Markdown store (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`) with Tier 1 local pattern aggregation (collapsing $\ge 3$ repeat events into `(and N similar recent events)`) and Tier 2 LLM consolidation via NVIDIA NIM $\rightarrow$ Mistral (with non-destructive deferral fallback).
  - **Restart-Safe Objectives**: `persistGoalAcrossRestarts` serializes goals to `/api/memory/goal` and `goal.json`.
  - **Zero-Loss Chunked Retry Queue**: `agent/memory/client.js` buffers memory events in an in-memory queue, draining in 50-item chunks every 15s when `memory-service` comes online.
  - **Offline Fallback**: `agent/brain-client/client.js` & `agent/decision/tree.js` gracefully fall back to local rule engine and dynamic rule cache when `brain-broker` is unreachable.
- **Society & Civilization Layer**:
  - Property claims, chest vending shops, democratic chief elections, IOU tracking and automated trade debt settlement, civic job boards, haunted geography place memories, and fidelity-decaying gossip.
- **Detailed Audit & Simulation Logger**:
  - **Per-Agent Activity Logs**: `logs/agents/<agentId>/` (`movement.log`, `combat.log`, `inventory.log`, `chat_and_social.log`, `cognition_and_decisions.log`, `senses_and_environment.log`).
  - **Universal World Timeline**: `logs/world/` (`global_timeline.log`, `civilization_events.log`).

---

## 2. Comprehensive Module & Function Catalog

### Core Agent (`agent/`)

#### 1. Configuration, Dockerfile & Entrypoint
- **[`agent/Dockerfile`](file:///e:/Projects/minecraft-community/agent/Dockerfile)**: Multi-stage Node 20 Alpine build for lean, resource-capped agent containers with `--max-old-space-size=400`.
- **[`agent/config.js`](file:///e:/Projects/minecraft-community/agent/config.js)**
  - `host`: Minecraft server host (`MC_HOST`, default `localhost` / `minecraft-server`).
  - `port`: Minecraft server port (`MC_PORT`, default `25565`).
  - `username`: Agent player name (`Agent_Alpha` through `Agent_Hotel`).
  - `version`: Minecraft version target (`1.20.4`).
  - `prefix`: In-game chat command prefix (`!`).
  - `statusPort`: HTTP agent status server port (`3010`-`3017`).
  - `viewerPort`: 3D POV stream port (`3020`-`3027`).
  - `personalitySeed`: Personality profile identifier (`PERSONALITY_SEED`, supports `random` or named archetypes).
  - `confidenceThreshold`: Escalation threshold score (`CONFIDENCE_THRESHOLD`, default `0.80`).
  - `brokerUrl`: Brain broker endpoint (`http://brain-broker:3001`).
  - `memoryServiceUrl`: Central memory service endpoint (`http://memory-service:3002`).
- **[`agent/index.js`](file:///e:/Projects/minecraft-community/agent/index.js)**
  - `persistGoalAcrossRestarts(goalManager)`: Wraps `setGoal`, `setPlan`, `clearPlan`, `markGoalCompleted` on `GoalManager` to automatically POST serialized snapshots (`goalManager.toSnapshot()`) to `/api/memory/goal` and restore on container startup.
  - `createAgent()`: Instantiates Mineflayer client, loads pathfinder, initializes perception, actuators, stats, persona, goals, social dialogue, event buffer, memory client with retry queue, and launches the 1-second main tick loop.
  - `statusServer`: Runs lightweight HTTP server on `:3010+` serving `/status`, `/health`, and `/personality` (supports live trait hot-reloading).
  - `announceToDashboard()`: Periodically registers agent name and status URL with the Civilization Dashboard (`:3003`).
  - `heapTimer`: Periodic memory watchdog sampling RSS/heap every 10s; logs `[HEAP]` summary every 60s and executes clean `process.exit(0)` when `heapUsed > 440MB` so Docker restarts a clean container without OOM corruption.
  - `curriculumTimer`: Checks inventory state every 2 minutes via `goalManager.nextTechObjective()` and updates active mission toward foundational survival milestones (wood $\rightarrow$ stone $\rightarrow$ smelting $\rightarrow$ iron $\rightarrow$ shield $\rightarrow$ bed).
  - `professionTimer`: Evaluates `agentState.actionTally` every 90s; when dominant action exceeds 40% across 40 samples, adopts and announces emergent specialization (Miner, Scout, Merchant, Diplomat, Farmer, Artisan, Builder, Guard).
  - `executeDecision(decision)`: Translates decision tree output into physical actions (`EAT`, `FLEE`, `FIGHT`, `SLEEP`, `MINE`, `CRAFT`, `SMELT`, `EQUIP`, `BUILD`, `TRADE`, `TALK`, `EXPLORE`, `WANDER`, `PLAN`, `HARVEST`, `FARM`, `COOK`, `CHEST`, `CONTRIBUTE`).
    - Handles hazard escape moves (`senses.hazardProximity()`), torch placement in dark underground areas ($Y < 55$, light $< 7$), and `memorial` placement on meaningful grave coordinates.
  - `events.on('witnessedDeath', { victim, raw })`: Appraises empathy and grief scaled by relationship affinity when Paper death broadcasts appear in chat.
  - `events.on('agentDeath', { position, cause })`: Throttled deterministic hazard lesson posting to `/api/ledger/lessons` (severity 0.9), traumatic rule penalization, amnesia, and haunted place memory generation (`/api/society/places`).
  - `events.on('blockBroken', { blockName, position })`: Automatically logs rare ore excavations to `/api/world/discoveries`.

---

#### 2. Brain Client (`agent/brain-client/`)
- **[`agent/brain-client/client.js`](file:///e:/Projects/minecraft-community/agent/brain-client/client.js)** — `BrainClient` class:
  - `constructor(brokerUrl)`: Initializes HTTP client pointing to `http://brain-broker:3001`.
  - `escalate(situationPayload)` / `escalateSituation(situationPayload)`: Transmits situation context to `http://brain-broker:3001/api/escalate`.
  - **Graceful Offline Fallback**: Returns fallback object adopting `topCandidate.name` or `WANDER` with zero-delta emotions if broker is unreachable.

---

#### 3. Cognitive & Emotion Architecture (`agent/cognition/`)
- **[`agent/cognition/persona.js`](file:///e:/Projects/minecraft-community/agent/cognition/persona.js)** — `DynamicPersona` class:
  - **Truly Procedural Multi-Dimensional Persona Generation (`PERSONALITY_SEED=random`)**:
    - Rolls 7 completely independent continuous traits in `[0.10, 0.95]`: `curiosity`, `sociability`, `greed`, `loyalty`, `caution`, `ambition`, `openness`.
    - Synthesizes emergent procedural titles from dominant/secondary trait pairings (e.g. *Charismatic Herald*, *Restless Guardian*, *Honorable Strategist*, *Audacious Tycoon*, *Reckless Pathfinder*).
    - Procedurally derives speaking style, favorite items, life mottos, and privacy preferences (`public` if openness $\ge 0.60$, `private` if openness $\le 0.35$, else `ask`).
  - **Archetype Templates**: Supports named archetypes (`friendly-explorer`, `cautious-builder`, `shrewd-trader`, `lone-survivalist`, `reckless-miner`, `zen-gatherer`, `quirky-tinkerer`).
  - `evolveFromExperience(eventType, impact)`: Mutes or amplifies traits in response to trauma (betrayals, scams, near-death) or triumph (cooperation, gifts).
  - `getPersonaPromptContext()`: Formats dynamic persona, traits, privacy preference, and free-will directives for LLM prompts.
  - `getScarSummary()`: Returns active behavioral scars and count.
  - `setPrivacyPreference(pref)`: Live hot-reload of privacy mode.
- **[`agent/cognition/emotions.js`](file:///e:/Projects/minecraft-community/agent/cognition/emotions.js)** — `EmotionalState` class:
  - `static forAgent(agentId)`: Singleton manager per bot.
  - `feel(emotion, intensity)`: Direct instantaneous emotion boost (`joy`, `distress`, `anger`, `fear`, `grief`, `pride`).
  - `appraise(eventType, ctx, traits)`: OCC-based cognitive appraisal engine calculating emotional deltas and mood shifts from events (`near_death`, `witnessed_death`, `goal_progress`, `betrayal`, `damage_taken`).
  - `getSummary()`: Returns current mood $[-1.0, 1.0]$, dominant feelings, and grieving flags.
- **[`agent/cognition/beliefs.js`](file:///e:/Projects/minecraft-community/agent/cognition/beliefs.js)** — `BeliefNetwork` class:
  - `static forAgent(agentId)`: Singleton manager per bot.
  - `update(key, statement, delta)`: Adds or modifies belief strength.
  - `noteMobGrudge(mobType, delta=0.25)`: Records grievances against hostile creature types.
  - `grudgeAgainst(mobType)`: Returns numeric grudge strength used by `DecisionTree` to bias `FIGHT` confidence.
  - `learnFrom(eventType, ctx)`: Adjusts foundational beliefs based on survival experiences.
- **[`agent/cognition/goals.js`](file:///e:/Projects/minecraft-community/agent/cognition/goals.js)** — `GoalManager` class:
  - `setGoal(description, details)`: Formulates an emergent short-term objective with 3-minute goal churn protection.
  - `setAspiration(aspiration)`: Establishes a life dream / long-term goal.
  - `markGoalCompleted(outcome)`: Logs goal completion with timestamp and status update.
  - `setPlan(steps, meta)`: Initializes multi-step plan array.
  - `advancePlan()`: Increments plan step index.
  - `failCurrentStep()`: Increments step failure counter; abandons plan after 2 failures.
  - `clearPlan(reason)`: Clears active plan queue.
  - `nextTechObjective(inventoryItemNames)`: Proposes sequential grounded progression milestones (wood $\rightarrow$ stone $\rightarrow$ smelting $\rightarrow$ iron $\rightarrow$ shield $\rightarrow$ bed).
  - `toSnapshot()` & `restoreFromSnapshot(snap)`: Full serialization and restoration of active goals and plans.
  - `getGoalContext()`: Returns active goal snapshot.
- **[`agent/cognition/reflection.js`](file:///e:/Projects/minecraft-community/agent/cognition/reflection.js)** — `ReflectionEngine` class:
  - `reflect(recentEvents, stats)`: Generates short 2-sentence reflective diary entries after milestones; seeds semantic memory retrieval with recent event actions, embedding the top long-term memory digest into the reflection prompt.
  - **Profile Isolation Guard**: `allowProfileWrite = false` strictly enforces that agent micro-reflections NEVER touch or overwrite `profile.md`.
  - **Privacy-Aware Cross-Agent Sharing**:
    - `public`: Automatically broadcasts lessons to civilization ledger via `POST /api/ledger/lessons`.
    - `private`: Preserves lesson only in private agent memory.
    - `ask`: Prompts in-game chat for consent (`"I learned something: ... — should I share it?"`), sharing to the shared ledger only upon affirmation (`confirmPendingLessonShare(true)`).

---

#### 4. Social, Factions & Dialogue (`agent/social/`)
- **[`agent/social/dialogue.js`](file:///e:/Projects/minecraft-community/agent/social/dialogue.js)** — `SocialDialogueEngine` class:
  - `processIncomingChat(sender, message, civContext)`: Handles conversational speech, performs per-pair semantic memory recall (`sharedHistoryWithSpeaker`), passes emotional states and grievances, and executes job actions (`claim`, `complete`, `post`). Supports private whispers.
  - **Emergent Gossip & Grudge Propagation**: Parses accusations/warnings in chat (theft, scam, lies); trusted speakers cause hearing bots to adjust trust/affinity against accused agents.
  - **Trade & Broadcast**: When executing successful barters, agents broadcast transaction summaries to public chat if trust $\ge 0.5$, notifying civilization of available market surplus.
- **[`agent/social/factions.js`](file:///e:/Projects/minecraft-community/agent/social/factions.js)** — `FactionAffiliationManager` class:
  - `restoreFromLedger(memoryServiceUrl)`: Restores joined faction memberships from the central ledger.
  - `considerAllianceWith(peerAgentId)`: Automatically graduates trusted trade partners into joint founded or recruited factions (max 4 members per faction).
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
  - `getNearbyHazards(maxDistance=4, count=8)`: Scans for lava, fire, magma blocks, and cacti.
  - `hazardProximity(maxDistance=3)`: Returns distance and block data for nearest lethal hazard.
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
  - Emits: `agentHurt`, `agentDeath`, `witnessedDeath` (via Paper death message regex parsing), `agentRespawn`, `underAttack`, `nearbyAttackSwing`, `incomingProjectile`, `agentOnFire` / `agentFireOut`, `playerChat`, `playerWhisper`, `playerJoined`, `playerLeft`, `itemCollected`, `blockBroken`, `blockPlaced`, `weatherChanged`, `timeTransition`.
  - **Item Metadata Resolution**: Resolves item IDs using `metadata[8]` / `metadata[7]` mapped through `bot.registry.items[id].name` with fallback to entity name.
  - **Mining Block Pre-Cache**: Caches block metadata on `diggingStarted` so `diggingCompleted` accurately identifies the mined block instead of post-break `air`.
  - Fire detection: 500ms interval polling `bot.entity.onFire` with debounce.
- **[`agent/perception/affordances.js`](file:///e:/Projects/minecraft-community/agent/perception/affordances.js)** — `AffordanceInspector` class:
  - `build(bot, senses, stats)`: Synchronously compiles verified tick capabilities (`craftable` with recipe ingredient resolution, `notCraftable` with missing ingredient reasons, `minable` by pickaxe tier, `harvestable`, `food`, `dangers`).

---

#### 6. Actuation & Skills Layer (`agent/actuation/`, `agent/skills/`)
- **[`agent/skills/farmer.js`](file:///e:/Projects/minecraft-community/agent/skills/farmer.js)** — `FarmerSkill` class:
  - `tillAndPlant(radius=12)`: Scans for grass/dirt blocks near water, equips hoe, tills soil into farmland, and sows seeds.
  - `harvestAndReplant(radius=16)`: Digs mature crops (wheat, carrots, potatoes, beetroots) and replants seeds.
  - `cookFood(radius=10)`: Smelts raw meat and potatoes in furnaces/smokers with available fuel.
- **[`agent/skills/builder.js`](file:///e:/Projects/minecraft-community/agent/skills/builder.js)** — `BuilderSkill` class:
  - `buildShelter(origin, width, length, height)`: Scans inventory for building blocks (planks, cobblestone, stone, dirt, wood, brick) and erects perimeter shelter walls with entrance.
  - **Failure Handling & Cooldown**: If `placedCount === 0`, marks the target site invalid in `invalidSites`, resets active building goals in `GoalManager`, and enforces a 60-second cooldown before shelter building can be re-triggered.
  - `getAvailableBuildingBlocks()`: Returns valid structural block items from inventory.
- **[`agent/skills/barter.js`](file:///e:/Projects/minecraft-community/agent/skills/barter.js)** — `BarterSkill` class:
  - `executeTrade(partner, giveItem, giveCount, wantItem, wantCount)`: Coordinates peer-to-peer item exchanges, navigates within trading distance, looks at partner, drops offer, monitors exchange, and announces auto-settled debts.
- **[`agent/actuation/movement.js`](file:///e:/Projects/minecraft-community/agent/actuation/movement.js)** — `MovementActuator` class:
  - `goto(x, y, z, range=1)`, `gotoBlock(x, y, z)`, `follow(entity, distance=2)`, `fleeFrom(entity, distance=16)` (null-guarded), `stop()`, `isMoving()`.
  - `wander(radius=15)`: Hazard-biased random walk steering away from lethal blocks (`_hazardWithin(3)`).
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

#### 7. Stats & Relationships (`agent/stats/`)
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
  - Compares evaluated confidence scores against threshold (`0.60`) to determine when LLM escalation is needed.
- **[`agent/decision/dynamicRules.js`](file:///e:/Projects/minecraft-community/agent/decision/dynamicRules.js)** — `DynamicRuleEngine` class:
  - `learnRule(situation, decision)`: Learns new dynamic rules from LLM escalations (initial confidence `0.72`).
  - `decayRules(maxIdleMs=1200000)`: Every 500 ticks, decays unreinforced rules by 10% and prunes rules whose confidence falls below `0.20`.
  - `reinforceRule(ruleId, outcomeSuccess)`: Sublinear reinforcement gain ($0.05 \times \max(0.1, 1 - \text{conf})$) on success; asymmetric penalty (-0.15) on failure.
  - Context gates: suppresses `EXPLORE`/`WANDER` when near hazards or low health; suppresses `TALK` when no real citizens are within conversational range.
  - `seedFromSharedLessons(memoryServiceUrl)`: Pulls public civilization lessons from ledger and seeds initial rules at `0.40` confidence.
  - `pollRuleAdjustments(agentId, memoryServiceUrl)` & `applyRuleAdjustment(adj)`: Ingests macro-reflection rule weight adjustments (+/- delta) from memory service.
- **[`agent/decision/escalate.js`](file:///e:/Projects/minecraft-community/agent/decision/escalate.js)** — `EscalationManager` class:
  - Formats rich situation context (inventory, equipment, position, biome, light, hostiles, goals, persona) and dispatches to `BrainClient` (supports `RESEARCH` task mode routing).
- **[`agent/decision/tree.js`](file:///e:/Projects/minecraft-community/agent/decision/tree.js)** — `DecisionTree` class:
  - Gathers static and dynamic rule evaluations, applies mastery boosts from accumulated learned rules and mob grudge biases, injects nearby place memories and world discoveries, and escalates when confidence $< 0.60$ or in stuck loops.
- **[`agent/decision/rules/`](file:///e:/Projects/minecraft-community/agent/decision/rules/)** — Specialized Rule Evaluators:
  - **`craft.js`**: Strict prerequisite ingredient validation ensuring all required items exist in inventory before returning confidence $\ge 0.9$. Integrates recipe cooldown registry (`setCraftCooldown`, `isCraftOnCooldown`).
  - **`eat.js`**: Evaluates hunger ($\le 60\%$) and health ($< 15$) to propose eating comfort, emergency, or desperation food.
  - **`explore.js`**: Proposes wandering/exploration based on curiosity and daytime conditions.
  - **`fight.js`**: Evaluates weapon readiness and hostile mob proximity within 8m.
  - **`flee.js`**: Evaluates mortal danger (health $\le 6$), hostile swarms (3+ enemies), and **Night-Awareness** (unarmored/unarmed agents prioritize `FLEE` and retreat to shelter during night cycle or light level $\le 7$).
  - **`mine.js`**: Ore value ranking (`diamond` > `iron` > `coal` > `stone`), enforces tool tier requirements (wooden for coal/stone, stone for iron/copper, iron for gold/diamond).
  - **`sleep.js`**: Proposes sleep when night falls and a bed is within range.
  - **`talk.js`**: Proposes social dialogue when other players/bots are nearby, respecting a 45s conversational cooldown and filtering non-citizen spectator bots.
  - **`trade.js`**: Proposes barter when inventory surplus exists and peers are in vicinity.
  - **`cooperate.js`**: Proposes `CONTRIBUTE` when the agent participates in an active shared community goal and holds $\ge 4$ of a required contribution item; base confidence `0.65` amplified by loyalty/sociability traits (capped at `0.95`).
  - **`farm.js`**: Three-tier agricultural evaluator: `HARVEST` mature crops nearby (`0.75+`, boosted when hungry, caution-weighted), then `COOK` raw food near a furnace/smoker with fuel in inventory (`0.72+`), else `FARM` till-and-plant when holding hoe + seeds during daytime (`0.60+`).

---

#### 9. Memory Client (`agent/memory/`)
- **[`agent/memory/buffer.js`](file:///e:/Projects/minecraft-community/agent/memory/buffer.js)** — `EventBuffer` class:
  - Rolling 20-event buffer that compacts and fires callbacks on overflow.
- **[`agent/memory/client.js`](file:///e:/Projects/minecraft-community/agent/memory/client.js)** — `MemoryClient` class:
  - `flushBuffer(events)`: Pushes events to local `pendingQueue` and attempts drain.
  - `drainQueue()`: Chunks backlog into max 50-event batches in a loop. On temporary failure, only the failing batch is re-queued to the head of the queue, preventing body payload overflows.
  - `queryMemories(query, section, limit)`: Proxies vector search queries to `GET /api/memory/query`.
- **[`agent/memory/societyClient.js`](file:///e:/Projects/minecraft-community/agent/memory/societyClient.js)** — `SocietyClient` class:
  - Helper client for `/api/society/` endpoints: `postGossip`, `faithContext`, `holdRite`, `claimChest`, `createShop`, `postJob`, `claimJob`, `resolveJob`, `declareCandidacy`, `voteFor`.

---

### Central Brain Broker Service (`broker/`)
- **[`broker/Dockerfile`](file:///e:/Projects/minecraft-community/broker/Dockerfile)**: Docker container build with `/health` check.
- **[`broker/config.js`](file:///e:/Projects/minecraft-community/broker/config.js)**: API keys and port configuration across 15+ providers.
- **[`broker/index.js`](file:///e:/Projects/minecraft-community/broker/index.js)**: Express REST server on port `3001` exposing `POST /api/escalate` and `GET /health`.
- **[`broker/router.js`](file:///e:/Projects/minecraft-community/broker/router.js)** — `ProviderRouter` class:
  - Supports task modes: `REASONING`, `CHAT`, `REFLEX`, `SOCIAL_CHAT`, `REFLECTION`, `RESEARCH`.
  - `_memoryQueryText(situation)`: Extracts rich semantic query text from situation names, reasons, hazard types, and goals.
  - **RESEARCH Task Mode**: Automatically executes `WebKnowledgeClient` query before LLM dispatch, injects real Minecraft wiki / mechanic knowledge into prompt context, and executes fallback provider cascade.
  - **Hazard Emergency Priority Routing**: Hazard-tagged escalations (`isHazard: true`) bypass the 5-minute task cooldown and route directly to top thinking models with emergency survival instructions in system prompts.
  - Records successes/failures with `RateLimiter` to operate the circuit breaker.
- **[`broker/rateLimiter.js`](file:///e:/Projects/minecraft-community/broker/rateLimiter.js)**: Provider cooldown manager + per-agent task rate limiter + **Circuit Breaker** (5 transient failures $\rightarrow$ 30m quarantine, 2 permanent strikes on 401/402/403/404/410 $\rightarrow$ 1h quarantine).
- **[`broker/cache/exactCache.js`](file:///e:/Projects/minecraft-community/broker/cache/exactCache.js)**: SHA-256 state hash cache with 300s TTL.
- **[`broker/cache/semanticCache.js`](file:///e:/Projects/minecraft-community/broker/cache/semanticCache.js)**: Cosine similarity vector cache ($\ge 0.88$).
- **[`broker/search/webSearch.js`](file:///e:/Projects/minecraft-community/broker/search/webSearch.js)** — `WebKnowledgeClient` class:
  - **3-Tier Knowledge Engine**: (1) Offline `minecraft-data` numeric grounding (food values, mob dimensions), (2) Curated tactical hazard and architectural blueprint database, (3) Live Minecraft Wiki Search API (`minecraft.wiki/api.php`) with tutorial namespace query biasing.
- **[`broker/providers/`](file:///e:/Projects/minecraft-community/broker/providers/)** — Individual LLM Drivers:
  - **`cloudflare.js`**: Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fp8-fast`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`).
  - **`mistral.js`**: Mistral AI API (`mistral-small-latest`).
  - **`nvidia.js`**: NVIDIA NIM API (`meta/llama-3.1-8b-instruct`, `meta/llama-3.1-70b-instruct`).
  - **`groq.js`**: Groq fast inference driver (`llama-3.1-8b-instant`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.6-27b`).
  - **`cerebras.js`**: Dynamic live model catalog discovery (`llama3.1-8b`, `llama-3.3-70b`, `gpt-oss-120b`).
  - **`cohere.js`**: Cohere API driver (`command-a-02-2025`, `command-r7b-12-2024`).
  - **`qwen.js`**: Alibaba DashScope International API (`qwen-flash`, `qwen-plus`, `qwen-turbo`).
  - **`huggingface.js`**: HuggingFace Inference Router (`meta-llama/Llama-3.1-8B-Instruct`, `deepseek-ai/DeepSeek-V3-0324`).
  - **`openrouter.js`**: OpenRouter free driver (`meta-llama/llama-3.3-70b-instruct:free`, `nvidia/nemotron-3.5-lightning:free`).
  - **`agnes.js`**: Agnes AI endpoint driver (`agnes-2.0-flash`).
  - **`llm7.js`**: LLM7 / Minimax endpoint driver (`minimax-m2.7`).
  - **`gemini.js`**: Google Gemini Flash API driver (`gemini-2.5-flash`).
  - **`githubModels.js`**: GitHub Models driver (`openai/gpt-4o-mini`).
  - **`literouter.js`**: LiteRouter driver (`deepseek-v3.2:free`).
  - **`tokenreply.js`**: TokenReply driver (`gemini-3.7-flash-default-free`).
  - **`pollinations.js`**: Pollinations anonymous lane driver.
  - **`siliconflow.js`**: SiliconFlow API driver (`Qwen/Qwen3-8B-Instruct`).
  - **`zhipu.js`**: Zhipu GLM driver (`glm-4-flash`).

---

### Central Memory Service (`memory-service/`)
- **[`memory-service/Dockerfile`](file:///e:/Projects/minecraft-community/memory-service/Dockerfile)**: Docker container build with `/health` check.
- **[`memory-service/config.js`](file:///e:/Projects/minecraft-community/memory-service/config.js)**: Memory store file paths, embedding provider configuration, and compaction schedules.
- **[`memory-service/index.js`](file:///e:/Projects/minecraft-community/memory-service/index.js)**: Express REST server on port `3002` with 50MB payload parsing limit. Exposes:
  - `GET /health`
  - `POST /api/memory/init`, `POST /api/memory/compact`, `POST /api/memory/consolidate`
  - `GET /api/memory/query`, `GET /api/memory/sections/:agentId/:section`
  - `GET /api/memory/goal`, `POST /api/memory/goal` (lossless goal persistence per agent)
  - `GET /api/world/discoveries`, `POST /api/world/discoveries` (spatial ore and field knowledge)
  - `GET /api/ledger`, `GET /api/ledger/lessons`, `GET /api/ledger/lessons/unshared`, `POST /api/ledger/lessons`
  - `GET /api/ledger/deaths`, `POST /api/ledger/deaths`
  - `GET /api/ledger/trades`, `POST /api/ledger/trades`
  - `GET /api/ledger/debts`, `POST /api/ledger/debts`, `POST /api/ledger/debts/settle`
  - `GET /api/ledger/factions`, `POST /api/ledger/factions`, `POST /api/ledger/factions/join`
  - `GET /api/ledger/territory`, `GET /api/ledger/territory/all`, `POST /api/ledger/territory/claim`
  - `GET /api/ledger/shared-goals`, `POST /api/ledger/shared-goals/propose`, `POST /api/ledger/shared-goals/join`, `POST /api/ledger/shared-goals/contribute`
  - `GET /api/ledger/chronicle`, `POST /api/ledger/chronicle`
  - `POST /api/rules/adjust`, `GET /api/rules/adjust/:agentId`
  - Society API: Full society routes mounted via `societyRoutes(app)`.
- **[`memory-service/society.js`](file:///e:/Projects/minecraft-community/memory-service/society.js)** — `SocietyStore` class:
  - `claimChest(agentId, x, y, z)`: Physical container ownership claims.
  - `createShop(agentId, x, y, z, item, unitPrice, unitCurrency)` & `getShops()`: Player-run chest vending shops.
  - `postJob(poster, title, description, currency, amount)`, `claimJob(jobId, worker)`, `completeJob(jobId, byWorker)`, `failJob(jobId, byPoster)`, `getOpenJobs()`: Civic job board.
  - `declareCandidacy(agentId)`, `voteFor(voterId, candidate)`, `getChief()`: Democratic elections.
  - `postGossip(fromAgent, aboutAgent, sentiment, fact, fidelity)` & `getRecentGossip()`: Gossip propagation with hop-decayed fidelity.
  - `calendar()`: 20-minute Minecraft day tracker.
  - `holdRite(tradition, riteType, hostId, attendees)` & `faithContext(agentId)`: Spiritual traditions and community rites.
  - `addPlaceMemory(agentId, x, y, z, sentiment, label)` & `getPlaceMemories(x, z, radius)`: Haunted geography and spatial sentiment.
  - `listIntel(seller, title, fact, priceItem, priceAmount)` & `buyIntel(intelId, buyerId)`.
- **[`memory-service/store/civilization/ledger.js`](file:///e:/Projects/minecraft-community/memory-service/store/civilization/ledger.js)** — `CivilizationLedger` class:
  - `recordTrade()`: Logs barter transactions and auto-settles matching open IOUs.
  - `addDebt(creditorId, debtorId, item, count, reason)`, `settleDebt(debtId, settledBy)`, `getOpenDebts(agentId)`.
  - `createFaction(name, founderId, charter)`, `joinFaction(factionId, agentId)`, `getFactions(memberOf)`.
  - `claimTerritory()`, `getTerritoryClaims()`.
  - `createSharedGoal()`, `contributeToSharedGoal()`.
  - `addChronicleEntry()`, `getChronicle()`.
  - `recordLesson()`, `recordDeath()`.
- **[`memory-service/sections/compactor.js`](file:///e:/Projects/minecraft-community/memory-service/sections/compactor.js)** — `MemoryCompactor` class:
  - `compactEventsList()`: Tier 1 local pattern aggregation ($N \ge 3$ repeat events collapsed into `(and N similar recent events)`).
  - `consolidateSectionFile()`: Tier 2 LLM consolidation via NVIDIA NIM $\rightarrow$ Mistral; defers non-destructively if providers are unavailable.
- **[`memory-service/embeddings/client.js`](file:///e:/Projects/minecraft-community/memory-service/embeddings/client.js)** — `EmbeddingClient` class:
  - Supports **Ollama (`nomic-embed-text`)**, **Gemini (`text-embedding-004`)**, and **Local N-Gram Fallback** with L2 vector normalization.
  - In-memory 2000-entry SHA-1 LRU vector cache.
- **[`memory-service/store/vectorStore.js`](file:///e:/Projects/minecraft-community/memory-service/store/vectorStore.js)**: Memory vector store with periodic disk snapshotting to `vectorIndex.snapshot.json`.
- **[`memory-service/sections/schema.js`](file:///e:/Projects/minecraft-community/memory-service/sections/schema.js)**: Sectioned markdown manager (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`).
- **[`memory-service/router.js`](file:///e:/Projects/minecraft-community/memory-service/router.js)**: Zero-LLM event router for memory entries.
- **[`memory-service/scheduler.js`](file:///e:/Projects/minecraft-community/memory-service/scheduler.js)**: Background compaction sweep scheduler.
- **[`memory-service/reflection/engine.js`](file:///e:/Projects/minecraft-community/memory-service/reflection/engine.js)** — `GenerativeReflectionEngine` class:
  - **Periodic Macro-Reflection Architecture**: Sole authorized writer to `profile.md` (tagged with `source: 'macro-reflection'`), synthesizing worldview and high-level insights across history, skills, and relationships.
  - **Prose-to-Weight Feedback Loop**: Runs structured extraction pass converting prose realizations into numeric rule adjustments (`POST /api/rules/adjust`).

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
  - `ledger.js`: Civilization ledger & chronicle feed proxy (exposing trades, debts, shared goals, factions, deaths, chronicle).
  - `timeline.js`: Historical timeline scrubber route (`GET /api/timeline?agentId=&from=&to=`).
- **[`dashboard/client/`](file:///e:/Projects/minecraft-community/dashboard/client/)**:
  - `index.html`: Responsive multi-view dashboard (Overview, 3D World View, Agents with Scar Badges, Decisions, Chronicle Lore Feed, Costs & Limits).
  - `styles.css`: Cyberpunk visual design system, glassmorphism panels, stat meters, confidence rings, and scrubber controls.
  - `app.js`: Real-time WebSocket telemetry + Timeline Replay scrubber (step, seek, play/pause historical states) + Chronicle feed. On the Decisions page, every event renders a task-intent badge — 💬 CHAT / 🗺️ PLAN / 🧠 REASON (LLM-sourced) vs ⚙️ TREE (local rule, $0) — with interactive ALL/CHAT/STRATEGY filter buttons, live per-category counts, and Provider Cost & Circuit Breaker monitoring cards.
  - `civilization.html`: Complete single-page overview interface.

---

### Shared Utilities (`shared/`)
- **[`shared/detailedLogger.js`](file:///e:/Projects/minecraft-community/shared/detailedLogger.js)** — `DetailedAuditLogger` class:
  - Logs granular streams to `logs/agents/<agentId>/` (`movement.log`, `combat.log`, `inventory.log`, `chat_and_social.log`, `cognition_and_decisions.log`, `senses_and_environment.log`) and `logs/world/` (`global_timeline.log`, `civilization_events.log`).
- **[`shared/logger.js`](file:///e:/Projects/minecraft-community/shared/logger.js)**: Standardized formatted console logging with timestamps and tags.
- **[`shared/constants.js`](file:///e:/Projects/minecraft-community/shared/constants.js)**: Action enum and `SCARCE_RESOURCES` tier (`emerald`, `diamond`, `ancient_debris`, `netherite_scrap`, `gold_ingot`, `iron_ingot`) with scarcity weights and base values.
