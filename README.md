# 🌍 Minecraft AI Civilization Simulation
> **An Experimental Multi-Agent Social & Cognitive Architecture in 3D Minecraft**

[![Node.js Version](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![Minecraft Version](https://img.shields.io/badge/Minecraft-Paper%201.20.4-blue.svg)](https://papermc.io/)
[![Docker Compose](https://img.shields.io/badge/Docker-Orchestrated-2496ED.svg)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

---

## 📖 1. Project Overview & Motivation

This project is an experimental multi-agent AI sandbox exploring **true emergent social intelligence, open-ended civilization building, and autonomous character evolution** inside a 3D Minecraft environment.

Unlike traditional game bots governed by hardcoded behavior trees or scripted NPC dialogue, agents in this simulation:
- Possess **sovereign free will**: they are not bound by rules, laws, or pre-set factions.
- Start with a unique **cognitive persona seed** (values, dispositions, fears, ambition) that **evolves dynamically** through lived experience (betrayals induce caution; shared survival breeds loyalty).
- Form their own **friendships, rivalries, currencies, tribes, laws, black markets, and treaties** organically through in-game chat and physical interaction.
- Can **bluff, deceive, conceal secret bunkers, declare wars, coordinate multi-bot raids**, or negotiate cooperative settlements.

---

## 🏛️ 2. Architectural Blueprint

```
                                  ┌──────────────────────────────────┐
                                  │      Paper Minecraft Server      │  (Port 25565, 2.5GB RAM limit)
                                  └────────────────┬─────────────────┘
                                                   │
                 ┌─────────────────────────────────┴─────────────────────────────────┐
                 ▼                                                                   ▼
      ┌───────────────────────┐                                           ┌───────────────────────┐
      │     Agent: Alpha      │ (1024MB RAM cap)                          │      Agent: Beta      │ (1024MB RAM cap)
      │  - Mineflayer 4.x     │                                           │  - Mineflayer 4.x     │
      │  - Perception Engine  │                                           │  - Perception Engine  │
      │  - Local Stats Engine │                                           │  - Local Stats Engine │
      │  - Dynamic Persona    │                                           │  - Dynamic Persona    │
      │  - Goal Formulation   │                                           │  - Goal Formulation   │
      │  - Social Dialogue    │                                           │  - Social Dialogue    │
      │  - Dynamic Rule Cache │                                           │  - Dynamic Rule Cache │
      │  - Zero-Loss MemQueue │                                           │  - Zero-Loss MemQueue │
      └──────────┬────────────┘                                           └───────────┬───────────┘
                 │        (+ Agent_Gamma provisioned by default in                     │
                 │          docker-compose; scale to more via                          │
                 │          scripts/spawn-agent.sh — identical stack)                  │
                 │ (Escalations < 0.6 / Fallback on Broker Offline)                   │
                 ▼                                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                     Central Brain Broker Service (Port 3001, Healthchecked)                     │
│  - Exact-Match Cache: SHA-256 state hashing with 300s TTL                                       │
│  - Semantic Vector Cache: Cosine similarity >= 0.88 over 768-dim embeddings (0 extra LLM calls) │
│  - Provider Pool Router (Round-robin + 429 automatic failover):                                 │
  │    * Fast Reflex & Chat: Agnes / Groq (when under quota)                              │
  │    * Complex Reasoning: NVIDIA NIM (gpt-oss-20b) + self-hosted QwenLocal (Qwen3.6-35B, reflection lane) │
│    * Backups: Cerebras (Llama 3.1 8B) & OpenRouter Free                                         │
└────────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    Central Memory & Reflection Service (Port 3002, Healthchecked)               │
│  - Sectioned Markdown Stores (store/agents/<agentId>/): profile, relationships, events, skills  │
  │  - Two-Tier Compaction: Tier 1 local append / Tier 2 Periodic Consolidation via NVIDIA NIM → Mistral │
│  - Detachable Embeddings Subsystem (768 Dimensions):                                            │
│    * Ollama: nomic-embed-text (Self-provisioning container, capped at 1.5GB RAM)                │
│    * Gemini: text-embedding-004 (Hosted Google AI API)                                         │
│    * Local Engine: Deterministic token frequency & N-gram hashing (Zero RAM/GPU fallback)       │
│  - Vector Index & Semantic Memory Search (cosine similarity query endpoint)                     │
│  - Shared Civilization Ledger (store/civilization/ledger.json)                                  │
└────────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                    Detailed Activity & Simulation Audit Logger (logs/)                          │
│  - Per-Agent Streams (zero compaction): movement.log, combat.log, inventory.log, chat.log, etc.│
│  - Universal World Timelines: global_timeline.log & civilization_events.log                     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                 Civilization Control Dashboard (Port 3003, Healthchecked)                       │
│  (Observability Plane — polls Broker :3001, Memory Service :3002, Agent status :3010+)          │
│  - Real-time telemetry aggregator + WebSocket broadcast                                         │
│  - Decisions page: task-intent badges (💬 CHAT / 🗺️ PLAN / 🧠 REASON vs ⚙️ TREE local rule)     │
│    with interactive ALL / CHAT / STRATEGY filters                                               │
│  - Timeline Replay scrubber (step / seek / play-pause historical states)                        │
│  - Chronicle lore feed · Operator chat via RCON                                                 │
│  - Embedded SpectatorBot + prismarine-viewer 3D noclip world view                               │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ 3. Key Features & Resiliency Mechanics

### 🧠 A. Hybrid 3-Tier Cognitive Engine
1. **Local Reflex Layer (Zero LLM, 1s tick)**: Pure local numeric stats (`health`, `hunger`, `anger`, `happiness`, `fatigue`), multi-tier survival feeding (`comfort`, `emergency`, `desperation`), pathfinding, and fast tool auto-selection.
2. **Brain Broker & Dual-Layer Cache**:
   - **Exact SHA-256 Cache**: Instant 0ms responses for repeated physical states.
   - **Semantic Vector Cache**: Situations matching past solutions with $\ge 88\%$ cosine similarity reuse tactical decisions with **0 LLM calls and zero token cost**.
   - **Task-Based Priority Routing**: Sub-second chat round-robins fast free lanes (Agnes/Groq/LiteRouter); deep reasoning prefers NVIDIA NIM (gpt-oss-20b) with automatic failover; slow reflection runs on self-hosted QwenLocal.
3. **Structured Sectioned Memory**: Tagged markdown logs (`[met]`, `[coop]`, `[conflict]`, `[location]`, `[skill]`) with automated two-tier compaction.

### 🛡️ B. Zero-Loss Memory Queue & Offline Decision Fallback
- **Memory Queue**: If `memory-service` is temporarily down or restarting, events are buffered in an in-memory retry queue and automatically drained once the service recovers.
- **Offline Decision Fallback**: If `brain-broker` is unreachable, `DecisionTree` falls back gracefully to the top local rule / dynamic rule without stalling the bot.
- **Docker Health Checks**: Automatic `healthcheck` endpoints on `/health` ensure dependents only start when microservices are fully healthy.

### 🧩 C. Self-Provisioning Local `nomic-embed-text` via Ollama
- Dedicated Ollama container (see `docker-compose.yml` for current RAM cap).
- **Automated Self-Provisioning**: On first boot, the container entrypoint automatically pulls `nomic-embed-text` and marks itself healthy — **zero manual commands required!**

### 🎭 D. Dynamic Personas, Free Will & Social Agency
- **Evolving Character**: Trauma (betrayals, death) raises caution and rebellion; shared triumph increases loyalty and warmth.
- **Sovereign Free Will**: Bots decide on their own whether to obey laws, honor non-aggression treaties, fake agreements, or wage guerrilla wars.
- **Deception & Bluffing**: Bots can lie about base coordinates, feign surrender, bluff about phantom allies, or coordinate surprise ambushes.
- **Emergent Currencies & Settlements**: Agents negotiate custom currencies (e.g. Iron Nuggets) and claim towns recorded in the shared world ledger.

### 🎮 E. Sub-Block Physical Precision Actuation
- **Stealth & Espionage**: `sneak(true)` hides in-game nametags through walls and prevents ledge falls.
- **Combat & Defense**: Auto armor equips (`netherite > diamond > iron`), auto sword/axe selection, off-hand shield blocking (`useShield(true)`).
- **Mining & Building**: Auto tool matching (pickaxe for stone/ores, axe for wood, shovel for dirt, shears for leaves), sub-block reference block placement (`placeBlock`), and container transfers (`openChestAndDeposit`).
- **Swimming & Navigation**: 3D A* pathfinding and water swimming controls.

### 📊 F. Granular Simulation Audit Logging
- Dedicated append-only log streams for every agent under `logs/agents/<agentId>/`:
  - `movement.log`, `combat.log`, `inventory.log`, `chat_and_social.log`, `cognition_and_decisions.log`, `senses_and_environment.log`.
- `logs/world/global_timeline.log`: Unified real-time server-wide event stream.
- `logs/world/civilization_events.log`: Civilization milestones (currencies, treaties, wars).

---

## 🚀 4. Quickstart Guide

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/) installed.
- (Optional for local dev) [Node.js 20+](https://nodejs.org/).
- Free-tier API keys for LLM providers:
  - `GEMINI_API_KEY` (Google AI Studio)
  - `GROQ_API_KEY` (GroqCloud)
  - `NVIDIA_API_KEY` (NVIDIA NIM)
  - `OPENROUTER_API_KEY` / `CEREBRAS_API_KEY` (Optional backups)

---

### Step 1: Environment Setup
Create a `.env` file in the root directory:
```bash
cp .env.example .env
```
Fill in your configuration:
```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.1-8b-instant
NVIDIA_API_KEY=nvapi-...
NVIDIA_MODEL=meta/llama-3.1-8b-instruct
CEREBRAS_API_KEY=your_cerebras_key_optional
CEREBRAS_MODEL=llama3.1-8b
OPENROUTER_API_KEY=your_openrouter_key_optional
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
AGNES_API_KEY=your_agnes_key_optional
AGNES_MODEL=deepseek-v3
LLM7_API_KEY=unused
LLM7_MODEL=default

# Embeddings Engine (ollama / gemini / local / auto)
EMBEDDING_PROVIDER=ollama
OLLAMA_MODEL=nomic-embed-text

# Cache
CACHE_TTL_SECONDS=300

# Dashboard + RCON (must match the Minecraft server's RCON password in docker-compose)
RCON_PASSWORD=changeme
DASHBOARD_PORT=3003
```

---

### Step 2: Launch the Simulation Stack (100% Zero-Touch Boot)
Start the complete stack. Ollama will automatically self-provision `nomic-embed-text`, healthchecks will verify each service, and agents will join the world:
```bash
docker compose up --build -d
```

Check running services:
```bash
docker compose ps
```

---

### Step 3: Observe Live AI Cognition & Social Streams
```bash
# Stream live agent thoughts, conversations, and decisions:
docker compose logs -f agent-alpha agent-beta

# Or monitor the universal world audit timeline:
tail -f logs/world/global_timeline.log
```

---

### Step 4: Dynamically Spawn Additional Agents
Spawn a third agent (`Agent_Gamma`) with a distinct personality seed into the running server:
```bash
bash scripts/spawn-agent.sh Agent_Gamma cunning-merchant
```

---

### Step 5: Benchmark VPS Resource Utilization
Measure real-time memory/CPU consumption per container and calculate maximum agent capacity on your host:
```bash
bash scripts/benchmark-resources.sh
```

---

## 🕹️ 5. In-Game Interaction & Experimentation

Join the local Minecraft server at `localhost:25565` (Minecraft 1.20.4, offline mode enabled):

### Interacting with Bots:
- **Talk Naturally in Public Chat**:
  ```text
  You: "Hey Agent_Alpha, want to trade 2 iron for 4 bread?"
  Agent_Alpha: "I only have 2 bread left, but I can throw in 5 apples if you give me the iron."
  ```
- **Form Treaties & Alliances**:
  ```text
  You: "Agent_Beta, let's sign a non-aggression pact and build a village at the river."
  ```
- **Test Deception & Bluffs**:
  ```text
  You: "Agent_Alpha, where is your base?"
  # Watch whether Agent_Alpha trusts you or whispers fake decoy coordinates!
  ```
- **Operator Commands**:
  - `!status`: Returns real-time health, hunger, anger, happiness, fatigue, and active goal.
  - `!come`: Directs bot to navigate to your position.
  - `!stop`: Halts bot navigation.
  - `!memories`: Prints bot's latest compacted memory chunks.

---

## 📁 6. Repository Layout

```
minecraft-community/
├── agent/                         # Autonomous Mineflayer Agent
│   ├── actuation/                 # Physical controls (movement, combat, inventory, chat)
│   ├── brain-client/              # REST client with offline fallback
│   ├── cognition/                 # Dynamic evolving persona & autonomous goal managers
│   ├── decision/                  # Decision tree, static rules, & dynamic rule replicator
│   ├── memory/                    # Rolling 20-event buffer & memory client with zero-loss queue
│   ├── perception/                # Senses (ores, mobs, chests) & normalized event observers
│   ├── social/                    # Natural dialogue engine & sovereign faction/treaty manager
│   ├── stats/                     # Zero-LLM numeric stats, tick decay, & relationship tracker
│   ├── config.js                  # Agent configuration loader
│   ├── Dockerfile                 # Lean Node 20 Alpine agent container
│   └── index.js                   # Main tick loop & bot lifecycle
│
├── broker/                        # Central Brain Broker Gateway (Port 3001)
│   ├── cache/                     # SHA-256 exact cache & cosine similarity semantic vector cache
│   ├── providers/                 # Gemini Flash, Groq, NVIDIA NIM, Cerebras, OpenRouter
│   ├── config.js                  # Broker configuration
│   ├── Dockerfile                 # Broker microservice container with /health
│   ├── index.js                   # Express REST API
│   ├── rateLimiter.js             # HTTP 429 automatic cooldown manager
│   └── router.js                  # Task-based preference routing & prompt builder
│
├── memory-service/                # Central Memory & Reflection Microservice (Port 3002)
│   ├── embeddings/                # Detachable Ollama (nomic-embed-text) vs Gemini vs Local N-gram
│   ├── reflection/                # Generative reflection engine synthesizing societal insights
│   ├── sections/                  # Schema parser & two-tier compactor (Groq Tier 1, Gemini Tier 2)
│   ├── store/
│   │   ├── agents/<agentId>/      # Sectioned markdown stores (profile, relationships, events, skills)
│   │   ├── civilization/          # Shared civilization ledger (ledger.json)
│   │   └── vectorStore.js         # Semantic vector index & memory search engine
│   ├── config.js                  # Memory service settings
│   ├── Dockerfile                 # Memory service container with /health
│   ├── index.js                   # Memory REST API
│   ├── router.js                  # Zero-LLM event-to-section router
│   └── scheduler.js               # Background soft-cap compaction sweep scheduler
│
├── dashboard/                      # Civilization Control Dashboard (Port 3003)
│   ├── server/
│   │   ├── routes/                 # Health, agents, chat, memory, ledger & timeline scrubber proxies
│   │   ├── aggregator.js           # Polls Broker/Memory/Agent endpoints, diffs chat, broadcasts WS snapshots
│   │   ├── spectator.js            # Embedded SpectatorBot (mineflayer) with OP noclip teleportation
│   │   ├── rcon.js                 # Zero-dependency Minecraft RCON client
│   │   └── index.js                # Express REST API + WebSocket server + prismarine-viewer proxy
│   ├── client/                     # index.html, app.js, styles.css (intent badges, filters, replay scrubber)
│   ├── package.json                # express, ws, mineflayer, prismarine-viewer, http-proxy-middleware
│   └── Dockerfile                  # Dashboard container (512MB RAM cap) with /health
│
├── shared/                        # Common Utilities
│   ├── constants.js               # Enums for actions, stats, and food tiers
│   ├── detailedLogger.js          # Granular per-agent & universal world audit log engine
│   └── logger.js                  # Console logging utility
│
├── scripts/                       # Ops & Scalability Tooling
│   ├── benchmark-resources.sh     # Measures container footprints & calculates VPS max capacity
│   └── spawn-agent.sh             # Provisions and runs dynamic agent containers
│
├── logs/                          # Persistent Simulation Audit Logs (git ignored)
│   ├── agents/<agentId>/          # movement.log, combat.log, inventory.log, chat.log, etc.
│   └── world/                     # global_timeline.log, civilization_events.log
│
├── docker-compose.yml             # Full civilization stack orchestration (with health checks & Ollama)
└── package.json                   # Project dependencies and npm scripts
```

---

## 🛠️ 7. VPS Resource Budget Specifications (16GB RAM Box)

| Service | Memory Cap | CPU Cap | Description |
| :--- | :--- | :--- | :--- |
| **Paper Minecraft Server** | `2.5 GB` | 2.0 Cores | Paper 1.20.4 Dedicated Game World |
| **Ollama Service** | `1.5 GB` | 1.0 Core | Local `nomic-embed-text` Embedding Engine (Self-Provisioning) |
| **Central Brain Broker** | `256 MB` | 0.5 Core | Express Gateway + Dual-Layer Cache + Provider Failover |
| **Central Memory Service** | `256 MB` | 0.5 Core | Sectioned Markdown + Vector Store + Reflection Engine |
| **Civilization Dashboard** | `512 MB` | 0.5 Core | Telemetry Aggregator + WebSocket + prismarine-viewer 3D World View |
| **AI Agents (per bot)** | `1024 MB` | 0.6 Core | ~60-180MB live heap+RSS per active bot (see `logs_dump_v*/` analyses) |
| **Baseline Stack Total** | **~12 GB** | — | 7 live agents + full service mesh on the 16GB box |

---

## 📜 8. License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
