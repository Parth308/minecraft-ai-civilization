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
      │     Agent: Alpha      │ (256MB RAM cap)                           │      Agent: Beta      │ (256MB RAM cap)
      │  - Mineflayer 4.x     │                                           │  - Mineflayer 4.x     │
      │  - Perception Engine  │                                           │  - Perception Engine  │
      │  - Local Stats Engine │                                           │  - Local Stats Engine │
      │  - Dynamic Persona    │                                           │  - Dynamic Persona    │
      │  - Goal Formulation   │                                           │  - Goal Formulation   │
      │  - Social Dialogue    │                                           │  - Social Dialogue    │
      │  - Dynamic Rule Cache │                                           │  - Dynamic Rule Cache │
      └──────────┬────────────┘                                           └───────────┬───────────┘
                 │ (Escalations < 0.6)                                                │ (Escalations < 0.6)
                 ▼                                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          Central Brain Broker Service (Port 3001)                               │
│  - Exact-Match Cache: SHA-256 state hashing with 300s TTL                                       │
│  - Semantic Vector Cache: Cosine similarity >= 0.88 over 768-dim embeddings (0 extra LLM calls) │
│  - Provider Pool Router (Round-robin + 429 automatic failover):                                 │
│    * Fast Reflex & Chat: Groq (Llama 3.1 8B Instant)                                            │
│    * Complex Reasoning & Emotions: Gemini Flash (gemini-2.5-flash)                              │
│    * Backups: Cerebras (Llama 3.1 8B) & OpenRouter Free                                         │
└────────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                          Central Memory Service (Port 3002)                                     │
│  - Claude-Style Sectioned Markdown Stores (store/agents/<agentId>/):                            │
│    ├── profile.md          (Dynamic traits, worldview, reflections)                             │
│    ├── relationships.md    (Per-player trust, affinity, interaction tags: [coop], [conflict])   │
│    ├── events.md           (Damage, deaths, discoveries, raids)                                 │
│    ├── skills.md           (Learned tactics, crafting recipes, secret base coords)              │
│    └── recent.md           (Rolling rollup buffer)                                              │
│  - Two-Tier Compaction: Tier 1 via Groq / Tier 2 Periodic Consolidation via Gemini Flash       │
│  - Detachable Embeddings Client: Hosted Gemini text-embedding-004 vs Local N-Gram Vector Engine│
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
```

---

## ⚡ 3. Key Features & Emergent Mechanics

### 🧠 A. Hybrid 3-Tier Cognitive Engine
1. **Local Reflex Layer (Zero LLM, 1s tick)**: Pure local numeric stats (`health`, `hunger`, `anger`, `happiness`, `fatigue`), multi-tier survival feeding (`comfort`, `emergency`, `desperation`), pathfinding, and fast tool auto-selection.
2. **Brain Broker & Dual-Layer Cache**:
   - **Exact SHA-256 Cache**: Instant 0ms responses for repeated physical states.
   - **Semantic Vector Cache**: Situations matching past solutions with $\ge 88\%$ cosine similarity reuse tactical decisions with **0 LLM calls and zero token cost**.
   - **Task-Based Priority Routing**: Sub-second chat routed to Groq; deep societal reflection routed to Gemini Flash.
3. **Structured Sectioned Memory**: Tagged markdown logs (`[met]`, `[coop]`, `[conflict]`, `[location]`, `[skill]`) with automated two-tier compaction.

### 🎭 B. Dynamic Personas, Free Will & Social Agency
- **Evolving Character**: Trauma (betrayals, death) raises caution and rebellion; shared triumph increases loyalty and warmth.
- **Sovereign Free Will**: Bots decide on their own whether to obey laws, honor non-aggression treaties, fake agreements, or wage guerrilla wars.
- **Deception & Bluffing**: Bots can lie about base coordinates, feign surrender, bluff about phantom allies, or coordinate surprise ambushes.
- **Emergent Currencies & Settlements**: Agents negotiate custom currencies (e.g. Iron Nuggets) and claim towns recorded in the shared world ledger.

### 🎮 C. Sub-Block Physical Precision Actuation
- **Stealth & Espionage**: `sneak(true)` hides in-game nametags through walls and prevents ledge falls.
- **Combat & Defense**: Auto armor equips (`netherite > diamond > iron`), auto sword/axe selection, off-hand shield blocking (`useShield(true)`).
- **Mining & Building**: Auto tool matching (pickaxe for stone/ores, axe for wood, shovel for dirt, shears for leaves), sub-block reference block placement (`placeBlock`), and container transfers (`openChestAndDeposit`).
- **Swimming & Navigation**: 3D A* pathfinding and water swimming controls.

### 📊 D. Granular Simulation Audit Logging
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
  - `CEREBRAS_API_KEY` / `OPENROUTER_API_KEY` (Optional backups)

---

### Step 1: Environment Setup
Create a `.env` file in the root directory:
```bash
cp .env.example .env
```
Fill in your API keys:
```env
GEMINI_API_KEY=your_gemini_api_key_here
GROQ_API_KEY=your_groq_api_key_here
CEREBRAS_API_KEY=your_cerebras_key_optional
OPENROUTER_API_KEY=your_openrouter_key_optional

EMBEDDING_PROVIDER=auto # 'gemini' for hosted 768-dim embeddings, 'local' for zero-RAM N-gram vectors
CACHE_TTL_SECONDS=300
```

---

### Step 2: Launch the Simulation Stack
Start the Paper Minecraft server, Brain Broker, Memory Service, and 2 autonomous AI agents (`Agent_Alpha` and `Agent_Beta`):
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
│   ├── brain-client/              # REST client connecting to Brain Broker
│   ├── cognition/                 # Dynamic evolving persona & autonomous goal managers
│   ├── decision/                  # Decision tree, static rules, & dynamic rule replicator
│   ├── memory/                    # Rolling 20-event buffer & memory service client
│   ├── perception/                # Senses (ores, mobs, chests) & normalized event observers
│   ├── social/                    # Natural dialogue engine & sovereign faction/treaty manager
│   ├── stats/                     # Zero-LLM numeric stats, tick decay, & relationship tracker
│   ├── config.js                  # Agent configuration loader
│   ├── Dockerfile                 # Lean Node 20 Alpine agent container
│   └── index.js                   # Main tick loop & bot lifecycle
│
├── broker/                        # Central Brain Broker Gateway (Port 3001)
│   ├── cache/                     # SHA-256 exact cache & cosine similarity semantic vector cache
│   ├── providers/                 # Gemini Flash, Groq, Cerebras, OpenRouter integrations
│   ├── config.js                  # Broker configuration
│   ├── Dockerfile                 # Broker microservice container
│   ├── index.js                   # Express REST API
│   ├── rateLimiter.js             # HTTP 429 automatic cooldown manager
│   └── router.js                  # Task-based preference routing & prompt builder
│
├── memory-service/                # Central Memory & Reflection Microservice (Port 3002)
│   ├── embeddings/                # Detachable hosted (Gemini) vs local N-gram vector generator
│   ├── reflection/                # Generative reflection engine synthesizing societal insights
│   ├── sections/                  # Schema parser & two-tier compactor (Groq Tier 1, Gemini Tier 2)
│   ├── store/
│   │   ├── agents/<agentId>/      # Sectioned markdown stores (profile, relationships, events, skills)
│   │   ├── civilization/          # Shared civilization ledger (ledger.json)
│   │   └── vectorStore.js         # Semantic vector index & memory search engine
│   ├── config.js                  # Memory service settings
│   ├── Dockerfile                 # Memory service container
│   ├── index.js                   # Memory REST API
│   ├── router.js                  # Zero-LLM event-to-section router
│   └── scheduler.js               # Background soft-cap compaction sweep scheduler
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
├── docker-compose.yml             # Full civilization stack orchestration
└── package.json                   # Project dependencies and npm scripts
```

---

## 🛠️ 7. Tech Stack Specifications

| Layer | Technologies & Dependencies |
| :--- | :--- |
| **Game Client** | `mineflayer` (^4.20.1), `mineflayer-pathfinder` (^2.4.5), `vec3` (^0.1.10) |
| **Minecraft Server** | Paper 1.20.4 (`itzg/minecraft-server` Docker image) |
| **Microservices** | Node.js 20 Alpine, Express.js |
| **LLM Provider Pool** | `gemini-2.5-flash`, `llama-3.1-8b-instant` (Groq), `llama3.1-8b` (Cerebras), OpenRouter Free |
| **Vector Search & Cache** | 768-dimensional normalized cosine similarity engine, SHA-256 state hashing |
| **Memory Storage** | Sectioned Markdown (`profile.md`, `relationships.md`, `events.md`, `skills.md`, `recent.md`) |
| **Audit Logging** | Granular append-only streams per agent activity and universal world timeline |

---

## 📜 8. License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
