# Minecraft AI Civilization Simulation
> **An Experimental Multi-Agent Social & Cognitive Architecture in 3D Minecraft**

[![Node.js Version](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![Minecraft Version](https://img.shields.io/badge/Minecraft-Paper%201.20.4-blue.svg)](https://papermc.io/)
[![Docker Compose](https://img.shields.io/badge/Docker-Orchestrated-2496ED.svg)](https://www.docker.com/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

---

## 1. Project Overview

This project is an experimental multi-agent AI sandbox exploring **true emergent social intelligence, open-ended civilization building, and autonomous character evolution** inside a 3D Minecraft environment.

Unlike traditional game bots governed by hardcoded behavior trees or scripted NPC dialogue, agents in this simulation:
- Possess **sovereign free will**: they are not bound by rules, laws, or pre-set factions.
- Start with a unique **cognitive persona seed** (values, dispositions, fears, ambition) that **evolves dynamically** through lived experience (betrayals induce caution; shared survival breeds loyalty).
- Form their own **friendships, rivalries, currencies, tribes, laws, black markets, and treaties** organically through in-game chat and physical interaction.
- Can **bluff, deceive, conceal secret bunkers, declare wars, coordinate multi-bot raids**, or negotiate cooperative settlements.

---

## 2. Architecture

### Services

| Service | Port | Description |
| :--- | :--- | :--- |
| **Paper Minecraft Server** | `25565` | Paper 1.20.4, view-distance=4, offline mode |
| **Brain Broker** | `3001` | Provider router, dual-layer cache, circuit breaker, rate limiter |
| **Memory Service** | `3002` | Sectioned markdown KB, vector store, civilization ledger, memory consolidation |
| **Dashboard** | `3003` | SPA with 17 pages, 3D spectator, RCON operator chat |
| **Ollama** | `11434` | `nomic-embed-text` embeddings + `qwen2.5:0.5b` local fallback SLM |
| **Agents** | `3010-3017` | 7 live bots (Alpha, Beta, Gamma, Delta, Echo, Golf, Hotel) |

### Agent Stack (per bot)
```
┌─────────────────────────────────────────┐
│        Mineflayer 4.x + Bot Core        │
├──────────┬──────────┬──────────┬────────┤
│Perception│ Decision │  Social  │ Memory │
│ (senses) │ (tree+   │ (dialogue│ (KB +  │
│          │  rules)  │ + factions)│ queue)│
└──────────┴──────────┴──────────┴────────┘
```

### Data Flow
```
Agent tick (1s) → DecisionTree (local rules, confidence ≥ 0.60)
  ↓ if < 0.60
Brain Broker (escalation) → Provider Router → LLM Response
  ↓
Memory Service (store/consolidate/vector-search)
  ↓
Shared Civilization Ledger (factions, trades, debts, deaths, lessons, chronicle)
```

---

## 3. Key Features

### Hybrid Cognitive Engine
1. **Local Reflex Layer (Zero LLM)**: Stats-driven survival (`health`, `hunger`, `fatigue`), multi-tier feeding, pathfinding, tool auto-selection.
2. **Brain Broker & Dual-Layer Cache**:
   - **Exact SHA-256 Cache**: Instant 0ms responses for repeated states.
   - **Semantic Vector Cache**: Cosine similarity ≥ 0.88 over 768-dim embeddings reuses decisions with **0 LLM calls**.
   - **Circuit Breaker**: 5 consecutive 429s → 30-minute quarantine. Automatic failover across providers.
3. **Local Fallback (Zero External LLMs)**: When all providers are quarantined, agents respond from a local SLM-powered template engine with anti-repetition (8-message ring buffer per agent), echo suppression, and learned template pool (150 max, background factory).

### Memory & Consolidation
- **Two-Tier Compaction**: Tier 1 local append with pattern aggregation (≥3 repeats → "(and N similar)"). Tier 2 LLM consolidation via NVIDIA NIM → Mistral (NEVER Gemini).
- **Sectioned Markdown KB**: `store/agents/<agentId>/{profile, relationships, events, skills, recent}.md`
- **Vector Store**: Ollama `nomic-embed-text` (768d), LRU cache 2000, semantic search for memory recall.
- **Shared Civilization Ledger**: `ledger.json` — factions, trades, debts, deaths, lessons, chronicle, territory claims.

### Social & Emergent Behaviors
- **Deception & Bluffing**: Bots can lie about base coordinates, feign surrender, bluff about phantom allies.
- **Emergent Factions**: Founded by trade-trust pairs (max 4 members), persisted in ledger, alliances announced in chat.
- **Debts/IOUs**: Auto-settle when debtor delivers item via recorded trade. Chronicle logged.
- **Death Consequences**: Deterministic severity-0.9 lesson posted to ledger (no LLM dependency), 10min throttle, amnesia + rule penalties + places-memory "Died here".
- **Per-pair Dialogue Recall**: `sharedHistoryWithSpeaker` semantic query before every reply.
- **World Knowledge Pool**: Ore discoveries POSTed automatically, injected as hints in decisions.

### Physical Actuation
- **Stealth**: `sneak(true)` hides nametags through walls.
- **Combat**: Auto armor equips (`netherite > diamond > iron`), auto sword/axe, off-hand shield blocking.
- **Mining**: Auto tool matching, sub-block placement, container transfers.
- **Navigation**: 3D A* pathfinding and water swimming.

---

## 4. Provider Fleet (19+ Providers, All Free Tier)

No credit card required. All providers are permanently free.

| Provider | Model | Role | Notes |
| :--- | :--- | :--- | :--- |
| **Ollama Local** | `qwen2.5:0.5b` | Local fallback SLM | Inside `ollama-embeddings` container, single-slot, queue-bound |
| **NVIDIA NIM** | `openai/gpt-oss-20b` | Live reasoning lane | ~9s avg, reasoning_effort=low, 30s timeout |
| **Agnes** | `agnes-2.0-flash` | Fast first responder | ~4s |
| **Groq** | `openai/gpt-oss-120b` | Fast reflex lane | 429-flaky under load |
| **Omniroute** | `auto/best-fast` | Local LLM router | 390 models, $0 |
| **OllamaCloud** | `gpt-oss:20b` | Volume lane | ~15s |
| **LiteRouter** | `deepseek-v3.2:free` | Volume lane | ~12s cooldown |
| **TokenReply** | Multi-model chain | Volume lane | gemini-3.7-flash, deepseek-v4-flash, nemotron-3-ultra, mimo-v2.5 |
| **Cloudflare Workers AI** | `llama-3.1-8b` | Volume lane | 10,000 free neurons/day |
| **KiraAI** | `kira-3.5-flash` | Volume lane | 150M free tokens/day |
| **Cerebras** | `llama3.1-8b` | Backup | 1M tokens/day, quota exhausts fast |
| **Mistral** | `mistral-small-latest` | Backup | ~1B tokens/month, subscription may expire |
| **HuggingFace** | `Llama-3.1-8B-Instruct` | Cascade-end | Tiny quota |
| **Cehpoint AI** | `cehpoint-ai` | Zero-auth unlimited | No signup required |
| **QwenLocal** | `Qwen3.6-35B-A3B` | Reflection-only lane | Self-hosted on :8080, single llama slot |
| **Gemini** | `gemini-2.5-flash` | Embeddings (backup) | ~20 req/day/model |
| **SiliconFlow** | `Qwen3-8B-Instruct` | Dead (needs CN ID) | Skip |
| **Zhipu** | `glm-4-flash` | Dead (needs CN ID) | Skip |
| **LLM7** | `minimax-m2.7` | Dead (all-timeout) | 280/280 timeouts in 2.4h, removal candidate |

**Cascade**: critical Groq → … → QwenLocal(mid) · reasoning KiraAI → OmniRoute → LiteRouter → … → Agnes/OllamaCloud → NVIDIA · reflection QwenLocal-first · social round-robin. Failover automatic.

---

## 5. Dashboard Pages (17 Pages)

| Page | Description |
| :--- | :--- |
| **Overview** | Live telemetry KPIs, decision source split bar, recent escalations, global chat |
| **3D World View** | Live Prismarine 3D viewport, spectator fly mode, timeline replay scrubber |
| **Agents** | Per-agent vitals, inventory, persona traits, active goal |
| **Decisions** | Decision source badges (CHAT/PLAN/REASON vs TREE), interactive filters |
| **Chronicle** | Daily Cobblestone newspaper, civilization milestones |
| **Costs** | Provider table with BREAKER badges, spend tracking |
| **Skills** | Per-agent skill inventory and usage |
| **Memory** | Sectioned markdown browser (profile, relationships, events, skills) |
| **Crafting Chain** | Craftable items, recipe chain, next objective |
| **Exploration Map** | Chunk grid heatmap, discovery overlay |
| **Discoveries** | World ore discovery log, ore summary |
| **Trade Ledger** | Trade history with fairness scores |
| **Debts** | Open IOUs and settlement history |
| **Social** | Relationship graph, faction details, alliances |
| **Taxes** | Tax collection and distribution |
| **Investigations** | Agent accusation and evidence tracking |
| **Stats** | Global simulation statistics |

---

## 6. Anti-Repetition & Chat Quality

- **Status Spiral Detection**: Window of 6 intents per agent. If 3+ consecutive `status` intents detected, redirects to random `[greeting, agreement, question, emote, compliment]`.
- **Echo Suppression**: Per-agent (6 recent) + global (14 recent) chat deduplication. If 3+ consecutive identical messages → redirect.
- **Template Anti-Repetition**: 8-message ring buffer per agent. Learned templates scored for diversity. Smart pruning keeps high-quality, diverse templates.
- **Local Fallback Templates**: 19 intents with trust x mood pools. Responses feel contextual, not robotic.

---

## 7. Quickstart

### Prerequisites
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- Free-tier API keys (all optional — system works with zero keys via local fallback)

### Step 1: Environment Setup
```bash
cp .env.example .env
# Edit .env with your API keys (all optional)
```

### Step 2: Launch
```bash
docker compose up --build -d
```

### Step 3: Observe
```bash
docker compose logs -f agent-alpha agent-beta
```

### Step 4: Benchmark
```bash
bash scripts/benchmark-resources.sh
```

---

## 8. Repository Layout

```
minecraft-community/
├── agent/                         # Autonomous Mineflayer Agent
│   ├── actuation/                 # Physical controls (movement, combat, inventory, chat)
│   ├── brain-client/              # REST client with offline fallback
│   ├── cognition/                 # Dynamic evolving persona & goal managers
│   ├── decision/                  # Decision tree, static rules, dynamic rules
│   ├── memory/                    # Rolling 20-event buffer & zero-loss queue
│   ├── perception/                # Senses (ores, mobs, chests) & event observers
│   ├── skills/                    # Barter, crafting, shelter, exploration
│   ├── social/                    # Dialogue, factions, gossip, events
│   ├── stats/                     # Numeric stats, decay, relationship tracker
│   ├── config.js                  # Agent configuration loader
│   ├── Dockerfile                 # Node 20 Alpine agent container
│   └── index.js                   # Main tick loop & bot lifecycle
│
├── broker/                        # Central Brain Broker (Port 3001)
│   ├── cache/                     # SHA-256 exact + semantic vector cache
│   ├── local-fallback/            # Offline SLM templates + template factory
│   │   ├── index.js               # Orchestrator (learned → SLM → template fallback)
│   │   ├── templates.js           # 19-intent template engine with anti-repetition
│   │   ├── template-factory.js    # Background Ollama-powered template generator
│   │   └── ollamaClient.js        # Direct Ollama client (4s timeout, concurrency limiter)
│   ├── providers/                 # 19+ provider files (Gemini, Groq, NVIDIA, etc.)
│   ├── config.js                  # Broker configuration
│   ├── Dockerfile                 # Broker container with /health
│   ├── index.js                   # Express REST API
│   ├── rateLimiter.js             # 429 cooldown + circuit breaker
│   └── router.js                  # Task-based routing & prompt builder
│
├── memory-service/                # Memory & Reflection (Port 3002)
│   ├── embeddings/                # Ollama nomic-embed-text vs Gemini vs Local N-gram
│   ├── reflection/                # Generative reflection engine
│   ├── sections/                  # Schema parser & two-tier compactor
│   ├── store/
│   │   ├── agents/<agentId>/      # Sectioned markdown stores
│   │   ├── civilization/          # Shared ledger (ledger.json, ledger_archive.jsonl)
│   │   └── vectorStore.js         # Semantic vector index
│   ├── config.js                  # Memory service settings
│   ├── Dockerfile                 # Memory container with /health
│   ├── index.js                   # Memory REST API
│   ├── router.js                  # Zero-LLM event-to-section router
│   └── scheduler.js               # Background compaction sweep
│
├── dashboard/                     # Civilization Dashboard (Port 3003)
│   ├── server/
│   │   ├── routes/                # Proxies for Broker, Memory, Agents
│   │   ├── aggregator.js          # Telemetry aggregator + WebSocket broadcast
│   │   ├── spectator.js           # Embedded SpectatorBot (mineflayer)
│   │   ├── rcon.js                # Zero-dependency RCON client
│   │   └── index.js               # Express + WebSocket + prismarine-viewer proxy
│   ├── client/                    # SPA: index.html, app.js, styles.css
│   ├── package.json               # Dependencies
│   └── Dockerfile                 # Dashboard container with /health
│
├── shared/                        # Common Utilities
│   ├── constants.js               # Actions, stats, food tier enums
│   ├── detailedLogger.js          # Per-agent & universal audit logging
│   └── logger.js                  # Console logging utility
│
├── scripts/                       # Ops & Scalability
│   ├── benchmark-resources.sh     # Container footprint measurement
│   └── spawn-agent.sh             # Dynamic agent provisioning
│
├── logs/                          # Persistent Audit Logs (git ignored)
│   ├── agents/<agentId>/          # movement, combat, inventory, chat, etc.
│   └── world/                     # global_timeline.log, civilization_events.log
│
├── docker-compose.yml             # Full stack orchestration
├── .env.example                   # Provider keys with signup URLs
└── package.json                   # Project dependencies
```

---

## 9. VPS Resource Budget (16GB RAM Box)

| Service | Memory Cap | CPU Cap | Description |
| :--- | :--- | :--- | :--- |
| **Paper Minecraft Server** | `2.5 GB` | 2.0 Cores | Paper 1.20.4 Dedicated Game World |
| **Ollama Service** | `768 MB` | 1.0 Core | `nomic-embed-text` + `qwen2.5:0.5b` (embeddings + local fallback SLM) |
| **Central Brain Broker** | `256 MB` | 0.5 Core | Express + dual-layer cache + 19+ provider failover + local fallback |
| **Central Memory Service** | `768 MB` | 0.5 Core | Sectioned markdown + vector store + ledger + consolidation |
| **Civilization Dashboard** | `512 MB` | 0.5 Core | Telemetry + WebSocket + 3D spectator |
| **AI Agents (per bot)** | `1024 MB` | 0.6 Core | ~60-180MB live heap+RSS per active bot |
| **Baseline Stack Total** | **~13 GB** | — | 7 live agents + full service mesh |

---

## 10. Ops Commands

```bash
# Deploy code changes
docker compose build <service> && docker compose up -d <service>

# Logs dump (Windows)
pwsh scripts/fetch_logs.ps1 → logs_dump_vN/

# Backups (cron 04:00 daily)
~/backups/civ_<day>.tar.gz (store+world, 7-day rotation)

# Consolidate KB
curl -X POST http://localhost:3002/api/memory/consolidate \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"Agent_Alpha","section":"recent"}'
```

---

## 11. License & Legal Disclaimer

### License

This simulation software is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](LICENSE) file for complete terms and conditions.

### Mojang Brand & EULA Disclaimer

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**
>
> Minecraft is a registered trademark of Mojang Synergies AB / Microsoft. This repository is an autonomous AI agent research project and is neither affiliated with nor endorsed by Mojang or Microsoft. In accordance with Mojang's Brand and Commercial Usage Guidelines, users running the dedicated Paper Minecraft server container acknowledge and agree to Mojang's [Minecraft End User License Agreement (EULA)](https://aka.ms/MinecraftEULA).
