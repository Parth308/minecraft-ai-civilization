# Architecture

Multi-agent Minecraft civilization sim — Paper 1.20.4 + Mineflayer bots + LLM broker.

> "Free will is paramount. Architecture offers knowledge and capability; the LLM decides."

---

## Table of Contents

- [Design Laws](#design-laws)
- [System Overview](#system-overview)
- [Agent Cognitive Stack](#agent-cognitive-stack)
- [Decision Tree](#decision-tree)
- [Memory System](#memory-system)
- [Social Systems](#social-systems)
- [Provider Fleet](#provider-fleet)
- [Data Flow](#data-flow)
- [Key Mechanics](#key-mechanics)
- [Deployment](#deployment)
- [File Structure](#file-structure)

---

## Design Laws

Three non-negotiable principles. Everything else is negotiable.

1. **Free will is paramount.** Architecture offers knowledge and capability; the LLM decides. Never force actions, rituals, trades, or beliefs. The agent can ignore any suggestion.

2. **Scams, theft, and betrayal are allowed.** Only add memory and consequence — never guardrails. If an agent wants to lie about its base coordinates, it can. If it wants to steal from an ally, it can. The only constraint is that actions have memory.

3. **V8 heap must always stay below container memory cap.** Use `NODE_OPTIONS` on every Node service, or the kernel OOM-kills before GC. Memory pressure is a real constraint — it shapes what's possible.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Paper Minecraft Server                          │
│                           :25565                                       │
│                     view-distance=4 · offline-mode                      │
│                    Paper 1.20.4 · 2.5GB RAM cap                        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
   │   Agent Alpha   │    │   Agent Beta    │    │   Agent Gamma   │
   │   :3010 (HTTP)  │    │   :3011 (HTTP)  │    │   :3012 (HTTP)  │
   │   :3020 (POV)   │    │   :3021 (POV)   │    │   :3022 (POV)   │
   │   1024MB RAM    │    │   1024MB RAM    │    │   1024MB RAM    │
   └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
            │                      │                      │
            └──────────────────────┼──────────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │       Brain Broker           │
                    │          :3001                │
                    │  ┌────────────────────────┐  │
                    │  │   Provider Router      │  │
                    │  │   (25+ providers)      │  │
                    │  └────────────────────────┘  │
                    │  ┌────────────────────────┐  │
                    │  │   Exact Cache          │  │
                    │  │   SHA-256, 300s TTL    │  │
                    │  └────────────────────────┘  │
                    │  ┌────────────────────────┐  │
                    │  │   Semantic Cache       │  │
                    │  │   768d, ≥0.88 cos sim  │  │
                    │  └────────────────────────┘  │
                    │  ┌────────────────────────┐  │
                    │  │   Rate Limiter         │  │
                    │  │   Circuit Breaker      │  │
                    │  └────────────────────────┘  │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │     Memory Service           │
                    │          :3002                │
                    │  ┌────────────────────────┐  │
                    │  │   Sectioned KB         │  │
                    │  │   profile/relationships │  │
                    │  │   events/skills/recent  │  │
                    │  └────────────────────────┘  │
                    │  ┌────────────────────────┐  │
                    │  │   Vector Store         │  │
                    │  │   nomic-embed 768d     │  │
                    │  └────────────────────────┘  │
                    │  ┌────────────────────────┐  │
                    │  │   Society Layer        │  │
                    │  │   gossip/reputation    │  │
                    │  └────────────────────────┘  │
                    │  ┌────────────────────────┐  │
                    │  │   Civilization Ledger  │  │
                    │  │   factions/debts/trades│  │
                    │  └────────────────────────┘  │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │     Civilization Dashboard   │
                    │          :3003                │
                    │  Real-time telemetry         │
                    │  WebSocket broadcast         │
                    │  Chronicle feed              │
                    │  3D world view               │
                    │  Operator chat (RCON)        │
                    └──────────────────────────────┘
```

### Service Ports

| Service | Port | Purpose |
|---|---|---|
| Minecraft Server | 25565 | Game world |
| Brain Broker | 3001 | LLM routing + cache |
| Memory Service | 3002 | Knowledge base + society |
| Dashboard | 3003 | Observability |
| Agent HTTP | 3010–3017 | Per-agent status |
| Agent POV | 3020–3027 | 3D spectator streams |
| Ollama | 11434 | Embeddings |

---

## Agent Cognitive Stack

Each agent runs a three-layer cognitive architecture. The layers are not hierarchical — they interact bidirectionally.

### Layer 1: Perception Engine

Raw sensory input from the Minecraft world. Processes every tick (~50ms).

```
Perception Engine
├── Senses (perception/senses.js)
│   ├── Nearby blocks (ores, trees, water, lava)
│   ├── Nearby entities (mobs, players, other agents)
│   ├── Health, hunger, position, time of day
│   └── Inventory state
├── Affordances (perception/affordances.js)
│   ├── What can I do right now?
│   ├── What tools do I have?
│   ├── What's nearby to interact with?
│   └── What's dangerous?
└── Events (perception/events.js)
    ├── Movement events
    ├── Combat events
    ├── Trade events
    └── Chat events
```

### Layer 2: Cognitive Core

Internal state, personality, and goal formulation. Runs alongside perception.

```
Cognitive Core
├── Persona (cognition/persona.js)
│   ├── Dynamic personality traits (caution, ambition, warmth, rebellion)
│   ├── Procedural title/motto generation
│   ├── Trait evolution through lived experience
│   └── Trauma response (betrayals → increased caution)
├── Emotions (cognition/emotions.js)
│   ├── OCC Appraisal Engine (Ortony/Clore/Collins)
│   ├── 10 emotion types: joy, distress, hope, fear, pride, shame,
│   │   gratitude, anger, love, hate
│   ├── Directed emotions (anger AT someone, love TOWARD someone)
│   ├── Mood (slow aggregate, -1..1)
│   ├── Half-life decay (8min emotions, 45min mood)
│   └── Grief episodes (witnessing death)
├── Beliefs (cognition/beliefs.js)
│   ├── World model (what I think is true)
│   ├── Trust estimates (per-agent)
│   └── Belief revision on new evidence
├── Goals (cognition/goals.js)
│   ├── Survival goals (eat, sleep, shelter)
│   ├── Resource goals (gather, craft, smelt)
│   ├── Social goals (trade, cooperate, join faction)
│   ├── Ambition goals (explore, claim territory, build)
│   └── Goal churn guard (identical goal within 3min ignored)
├── Skills (cognition/skillTracker.js)
│   ├── Action tally (what have I been doing?)
│   ├── Profession detection (≥40% dominant action over 40 samples)
│   └── Skill level tracking
├── Reflection (cognition/reflection.js)
│   ├── Periodic self-review
│   ├── Action distribution analysis
│   └── Self-correction (FLEE > 45% → pivot to BUILD)
└── Chunk Memory (cognition/chunkMemory.js)
    └── Spatial memory (what's where)
```

#### Emotional Appraisal Rules

The emotion engine responds to events based on personality traits:

```javascript
// Example: death_self appraisal
case 'death_self':
  this.feel('distress', 0.55 + sens('caution') * 0.2);
  this.feel('fear', 0.5 + sens('caution') * 0.25);
  this.feel('hope', -0.3);
  break;

// Same event, different personality:
// Cautious agent: distress 0.71, fear 0.75
// Bold agent: distress 0.55, fear 0.50
```

Emotions are **internal weather** — they tint confidence and tone but never dictate action directly.

### Layer 3: Decision + Actuation

Decides what to do and executes it. This is where free will manifests.

```
Decision Layer
├── Decision Tree (decision/tree.js)
│   ├── 24+ static rule evaluators
│   ├── Dynamic rule engine (learned from experience)
│   ├── Confidence evaluator (local vs escalate)
│   └── Escalation manager (LLM fallback)
├── Actuation (actuation/)
│   ├── Movement (A* pathfinding, swimming, climbing)
│   ├── Combat (auto-armor, sword selection, shield blocking)
│   ├── Inventory (auto-tool matching, chest transfers)
│   └── Chat (social dialogue engine)
└── Brain Client (brain-client/client.js)
    ├── REST client with offline fallback
    └── Zero-loss memory queue
```

---

## Decision Tree

The decision tree is the core of agent autonomy. It evaluates ~24 rule types every tick and selects the highest-confidence action.

### Rule Types

```
Survival:    EAT, SLEEP, FLEE, DEFEND, FIGHT, HUNT
Resource:    MINE, CRAFT, SMELT, FARM, EXPLORE, SCOUT
Social:      TRADE, TALK, COOPERATE, STEAL
Building:    BUILD, GUARD
Advanced:    DIAMOND_SEEK, VILLAGE_SEEK, LOOT_STRUCTURE, ENCHANT, BREED, DIG_UP
```

### Decision Flow

```
Every tick (~50ms):
  1. Perception Engine updates senses
  2. Stats Manager updates health/hunger/anger/happiness/fatigue
  3. Decision Tree evaluates all rules:
     a. Static evaluators (24+ rules) → confidence score
     b. Dynamic rules (learned from experience) → confidence score
     c. Confidence Evaluator checks threshold
  4. If confidence ≥ 0.60 → execute locally
  5. If confidence < 0.60 → escalate to Brain Broker (LLM)
  6. If broker offline → fallback to top local rule
  7. Actuation executes chosen action
```

### Confidence Evaluation

```javascript
class ConfidenceEvaluator {
  constructor(threshold = 0.6) {
    this.threshold = threshold;
  }

  shouldEscalate(confidence) {
    return confidence < this.threshold;
  }
}
```

- **High confidence (≥0.60)**: Agent acts autonomously. No LLM call.
- **Low confidence (<0.60)**: Agent asks the LLM for guidance.
- **Stuck loop**: If agent repeats same action 3+ times, confidence drops, triggers escalation.

### Dynamic Rule Engine

Rules learned from experience. Seeded from the civilization ledger.

```
Ledger entries → dynamicRules.js
├── Death lessons → AVOID rules
├── Hazard lessons → FLEE rules
├── Trade lessons → TALK rules
├── Build lessons → BUILD rules
├── Mining lessons → MINE rules
└── Cap: 100 active rules per agent
    ├── Dedup by first-80-char
    ├── Overflow → rules_archive.md
    └── On-demand fetch for novel hazards
```

### Escalation to LLM

When confidence is low, the agent escalates to the Brain Broker:

```javascript
// Escalation payload (capped)
{
  agentId: "Agent_Alpha",
  action: "TRADE",
  confidence: 0.35,
  context: {
    health: 14, hunger: 6,
    nearbyPlayers: ["Agent_Beta"],
    inventory: ["oak_plank ×3", "dirt ×12"],
    recentEvents: ["saw Agent_Beta near river"],
    persona: { warmth: 0.7, caution: 0.4 }
  },
  candidates: [
    { action: "TRADE", reason: "Beta nearby, have surplus planks" },
    { action: "MINE", reason: "Low on iron" },
    { action: "FLEE", reason: "Health below 50%" }
  ],
  reasons: ["Beta is friendly (trust 0.8)", "Have 3 extra planks", "Night approaching"]
}
```

The LLM returns a decision with reasoning. The agent can override it.

---

## Memory System

### Sectioned Knowledge Base

Each agent has a structured markdown knowledge base:

```
store/agents/<agentId>/
├── profile.md          # Who am I (name, traits, title, motto)
├── relationships.md    # Who do I know (trust scores, history)
├── events.md           # What happened (significant events)
├── skills.md           # What can I do (learned abilities)
└── recent.md           # Last 20 events (rolling buffer)
```

#### Example: profile.md
```markdown
# Agent_Alpha Profile

## Identity
- Name: Agent_Alpha
- Title: The Cautious Explorer
- Motto: "Trust earned, never given"

## Personality
- caution: 0.7
- ambition: 0.5
- warmth: 0.6
- rebellion: 0.3

## Profession
- Detected: Gatherer (42% EXPLORE over 40 samples)
- Since: 2026-09-15T04:30:00Z
```

### Two-Tier Compaction

Memory grows unbounded without compaction. Two tiers handle this:

**Tier 1: Local Append + Pattern Aggregation**
- Events appended to section files in real-time
- Pattern detection: ≥3 similar entries → "(and N similar)"
- Zero LLM cost

**Tier 2: LLM Consolidation**
- Background scheduler triggers consolidation
- LLM reads raw entries, synthesizes insights
- Non-destructive fallback: if LLM unavailable, defer
- Heap-guarded: skips if memory-service heap >80%

### Vector Store

Semantic memory search over all section entries.

```
Embeddings: Ollama nomic-embed-text (768d)
Index: In-memory with LRU cache (2000 entries)
Search: Cosine similarity ≥ 0.88
Persistence: Snapshot to disk on shutdown
```

**Use case**: Before responding to a chat, agent queries:
```javascript
const relevantMemories = await vectorStore.search({
  agentId: "Agent_Alpha",
  query: "history with Agent_Beta",
  topK: 5
});
```

### Amnesia (Death Penalty)

When an agent dies, it loses memories:

```javascript
app.post('/api/memory/amnesia', async (req, res) => {
  const { agentId, fraction = 0.3 } = req.body;
  // Randomly erase 30% of skills, events, and recent memories
  // Purge forgotten entries from vector index
  // Knowledge becomes precious because surviving long enough to accumulate it is rare
});
```

**Why amnesia?** It creates stakes. If death had no cost, agents wouldn't care about survival. Amnesia makes knowledge a scarce resource — you have to live long enough to learn.

---

## Social Systems

### Social Dialogue Engine

Processes incoming chat and generates responses. Separate from the decision tree.

```javascript
class SocialDialogueEngine {
  async processIncomingChat(sender, message, civContext) {
    // 1. Check social avoidance (deep distrust → silence)
    // 2. Recall shared history with sender (semantic query)
    // 3. Appraise emotional response
    // 4. Generate response (LLM or local)
    // 5. Update relationship score
    // 6. Log interaction
  }
}
```

**Key feature**: Per-pair dialogue recall. Before responding, agent queries:
```javascript
const sharedHistory = await memoryClient.semanticQuery({
  agentId: this.persona.agentId,
  query: `history with ${sender}`,
  topK: 5
});
```

### Gossip System

Agents spread information about each other. Information degrades with retelling.

```javascript
class Gossip {
  addRumor(rumor) {
    // Fidelity starts at 1.0
    // Each retelling: fidelity *= 0.7-0.9
    // Names mutate: "Agent_Beta" → "...someone" → "a guy"
    // Items mutate: "iron_sword" → "something valuable" → "stuff"
  }

  receiveFromChat(sender, message) {
    // Parse gossip from chat
    // Fidelity drops: 0.7-0.9 (retelling penalty)
  }

  spread() {
    // Broadcast to nearby players
    // Buffer cap: 25 rumors
    // Dedup: same target+type within 60s
  }
}
```

**Emergent behavior**: Rumors mutate. "Agent_Beta has iron" becomes "someone has something valuable" becomes "a guy has stuff." Information degrades naturally.

### Gossip → Reputation

Gossip feeds into the society layer's reputation system:

```javascript
// SocietyStore tracks reputation
reputation: {
  "Agent_Beta": { score: 10, lastUpdated: "2026-09-15T04:00:00Z" },
  "Agent_Golf": { score: 5, lastUpdated: "2026-09-15T03:55:00Z" }
}
```

Reputation affects:
- Trade willingness (low rep → refuse trades)
- Alliance formation (high rep → easier to ally)
- Gossip credibility (high rep → rumors more believable)

### Faction System

Agents form factions through trade-trust pairs.

```javascript
class FactionAffiliationManager {
  // Faction membership
  joinedFactions: [];
  pacts: [];           // Treaties (agent decides to honor, fake, or betray)
  secretBases: [];     // Hidden coordinates
  enemiesAndTargets: []; // War declarations
  permittedTerritories: Set; // Building permissions

  requestTerritoryPermission(targetAgentId, purpose) {
    // Ask another agent for building permission
  }

  declareWar(targetName, reason) {
    // Mark target as hostile
  }

  recordSecretBase(name, coords, notes) {
    // Store private base location
  }
}
```

**Rules**:
- Max 4 members per faction
- Founded by trade-trust pairs
- Alliances announced in chat
- Agents can leave, betray, or dissolve factions

### Society Layer

Centralized society knowledge stored in `society.json`:

```javascript
{
  reputation: {},      // agent → { score, lastUpdated }
  gossip: [],          // shared rumors
  notices: [],         // public announcements
  conventions: {},     // agreed-upon rules
  pledges: [],         // promises made
  property: {},        // claimed territories
  debts: [],           // IOUs and obligations
  accusations: [],     // who accused whom
  grievances: [],      // historical complaints
  wallets: {},         // agent → currency balances
  priceMemory: {},     // item → last traded price
  faith: {},           // religious beliefs
  clans: {},           // faction data
  trials: [],          // legal proceedings
  exiles: [],          // banished agents
  jobs: {},            // employment relationships
  shops: {},           // storefronts
}
```

---

## Provider Fleet

25+ LLM providers, all free-tier. No credit card required.

### Provider Categories

| Category | Providers | Use Case |
|---|---|---|
| **Fast Reflex** | Groq, Agnes | Chat, quick decisions |
| **Deep Reasoning** | NVIDIA NIM, QwenLocal | Complex planning, reflection |
| **Volume** | Cloudflare Workers AI, TokenReply | High-throughput social chatter |
| **Backup** | Cerebras, LiteRouter, OllamaCloud | Failover when primary exhausted |
| **Self-hosted** | QwenLocal (llama.cpp), OmniRoute | Unlimited, zero cost |

### Routing Logic

```javascript
class ProviderRouter {
  async route(taskType, prompt, options) {
    // 1. Check exact cache (SHA-256) → instant 0ms
    // 2. Check semantic cache (768d cosine) → 0 LLM calls
    // 3. Select provider by task type:
    //    - CHAT → round-robin fast lanes
    //    - REASON → preference cascade
    //    - REFLECT → QwenLocal first
    // 4. Apply rate limiter
    // 5. Query provider
    // 6. If 429/timeout → circuit breaker → next provider
    // 7. Cache result
  }
}
```

### Cascade Chains

```
Critical:  Groq → Agnes → OmniRoute → ... → QwenLocal
Reasoning: KiraAI → OmniRoute → LiteRouter → ... → Nvidia
Reflection: QwenLocal → NVIDIA NIM → ...
Social:    Round-robin across fast lanes
```

### Circuit Breaker

```
Transient fails (timeout, 500) → 30min quarantine
Auth fails (401, 403) → 2 strikes → 1h quarantine
Quota exhausted (402) → 2 strikes → 1h quarantine
Not found (404, 410) → 2 strikes → 1h quarantine
```

### Caching

**Exact Cache**:
- Key: SHA-256 hash of (state + action + context)
- TTL: 300s
- Hit rate: ~15% for repeated physical states

**Semantic Cache**:
- Key: 768-dim embedding of (state + action + context)
- Similarity: Cosine ≥ 0.88
- TTL: 1200s (4× exact)
- Hit rate: ~25% for similar situations

---

## Data Flow

### Decision Cycle (every tick)

```
┌─────────────────────────────────────────────────────────────┐
│                    MINECRAFT SERVER                         │
│  Bot observes: mobs, blocks, health, hunger, chat          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  PERCEPTION ENGINE                         │
│  Processes raw sensory data → normalized events             │
│  Updates affordances (what can I do?)                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  COGNITIVE CORE                            │
│  Persona: personality traits, title, motto                 │
│  Emotions: OCC appraisal, mood, directed feelings          │
│  Beliefs: world model, trust estimates                     │
│  Goals: survival → resource → social → ambition            │
│  Skills: action tally, profession detection                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  DECISION TREE                             │
│  Evaluates 24+ rule types → confidence scores              │
│  Dynamic rules (learned from experience)                   │
│  Confidence evaluator: ≥0.60 → local, <0.60 → escalate    │
└─────────┬──────────────────────────────────┬───────────────┘
          │                                  │
    confidence ≥ 0.60                  confidence < 0.60
          │                                  │
          ▼                                  ▼
┌─────────────────────┐        ┌─────────────────────────────┐
│  LOCAL EXECUTION    │        │     BRAIN BROKER            │
│  Rule acts directly │        │  Provider Router            │
│  No LLM call       │        │  Exact/Semantic Cache       │
└─────────┬───────────┘        │  Rate Limiter               │
          │                    │  Circuit Breaker            │
          │                    └──────────────┬──────────────┘
          │                                   │
          │                    ┌──────────────┴──────────────┐
          │                    │      LLM PROVIDER           │
          │                    │  (Groq/NVIDIA/Agnes/etc)    │
          │                    └──────────────┬──────────────┘
          │                                   │
          │                    ┌──────────────┴──────────────┐
          │                    │    DECISION + REASONING      │
          │                    │  "TRADE with Beta because    │
          │                    │   trust is high and you      │
          │                    │   have surplus planks"       │
          │                    └──────────────┬──────────────┘
          │                                   │
          └──────────────┬────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  ACTUATION                                 │
│  Movement: A* pathfinding, swimming, climbing              │
│  Combat: auto-armor, sword selection, shield               │
│  Inventory: auto-tool matching, chest transfers            │
│  Chat: social dialogue engine                              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  MEMORY SERVICE                            │
│  Log event to section file                                 │
│  Update vector index                                       │
│  Update relationship scores                                │
│  Update society layer (gossip, reputation)                 │
│  Update civilization ledger (if significant)               │
└─────────────────────────────────────────────────────────────┘
```

### Chat Flow (social interaction)

```
Agent receives chat message
  │
  ▼
SocialDialogueEngine.processIncomingChat()
  │
  ├── Check social avoidance (distrust → silence)
  │
  ├── Query shared history (vector search)
  │
  ├── Appraise emotional response
  │   └── "Am I angry at this person? Do I trust them?"
  │
  ├── Generate response (LLM or local)
  │   └── Context: persona + emotions + history + civContext
  │
  ├── Update relationship score
  │   └── +0.1 friendly, -0.1 hostile, etc.
  │
  ├── Feed gossip buffer
  │   └── If message contains third-party info
  │
  └── Log interaction
```

---

## Key Mechanics

### Death & Amnesia

```
Agent dies
  │
  ├── Severity 0.9 lesson posted to ledger
  │   └── "Killed by drowned — avoid water at night"
  │
  ├── Amnesia triggered (30% memory loss)
  │   ├── Random entries erased from skills/events/recent
  │   ├── Vectors purged from index
  │   └── Knowledge becomes scarce
  │
  ├── Rule penalties applied
  │   └── Related rules get confidence penalty
  │
  ├── Place-memory recorded
  │   └── "Died here at X:52 Y:46 Z:232"
  │
  └── Agent respawns with partial memories
      └── Shared lessons persist → other agents benefit
```

### Debts & IOUs

```
Agent A promises to give Agent B 3 iron
  │
  ├── IOU recorded in society layer
  │
  ├── When Agent A delivers iron:
  │   ├── Debt auto-settles
  │   ├── Trade logged in chronicle
  │   └── Trust increases
  │
  └── If Agent A never delivers:
      ├── Debt remains
      ├── Reputation decreases
      └── Agent B can spread gossip about A
```

### Tech-Tree Curriculum

Agents don't know Minecraft progression. The system nudges them:

```javascript
function nextTechObjective(inventory, skills) {
  if (!hasTool(inventory, 'wood_pickaxe')) return 'CRAFT_WOOD_PICKAXE';
  if (!hasTool(inventory, 'stone_pickaxe')) return 'MINE_STONE';
  if (!hasTool(inventory, 'iron_pickaxe')) return 'SMELT_IRON';
  if (!hasTool(inventory, 'diamond_pickaxe')) return 'MINE_DIAMOND';
  return null; // Agent decides freely
}
```

### Professions

Agents specialize based on behavior:

```javascript
// Action tally over 40 samples
const dominant = findDominant(actionTally, threshold = 0.40);
if (dominant) {
  announce(`Agent_Alpha: "I am now a Gatherer."`);
}
```

### Self-Correction

Agents review their own behavior:

```javascript
// Every 6 hours
const distribution = analyzeActionDistribution(recentActions);
if (distribution.FLEE > 0.45) {
  // Too much fleeing — pivot
  adjustConfidence('BUILD', +0.25);
  adjustConfidence('FLEE', -0.20);
  log('Self-correction: shifting from FLEE to BUILD');
}
```

---

## Deployment

### Docker Compose Stack

```yaml
services:
  minecraft-server:    # Paper 1.20.4, 2.5GB RAM
  ollama:              # nomic-embed-text, 1.5GB RAM
  brain-broker:        # Provider router, 256MB RAM
  memory-service:      # Knowledge base, 256MB RAM (768MB with embeddings)
  dashboard:           # Observability, 512MB RAM
  agent-alpha:         # 1024MB RAM
  agent-beta:          # 1024MB RAM
  agent-gamma:         # 1024MB RAM
  agent-delta:         # 1024MB RAM
  agent-echo:          # 1024MB RAM
  agent-golf:          # 1024MB RAM
  agent-hotel:         # 1024MB RAM
```

### Health Checks

Every service has a `/health` endpoint. Dependencies use `condition: service_healthy`:

```yaml
brain-broker:
  depends_on:
    memory-service:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

### Resource Budget (16GB VPS)

| Service | RAM | CPU |
|---|---|---|
| Minecraft Server | 2.5 GB | 2.0 cores |
| Ollama | 1.5 GB | 1.0 core |
| Brain Broker | 256 MB | 0.5 core |
| Memory Service | 768 MB | 0.5 core |
| Dashboard | 512 MB | 0.5 core |
| 7 Agents × 1024 MB | 7.0 GB | 4.2 cores |
| **Total** | **~12 GB** | **~8.7 cores** |

---

## File Structure

```
minecraft-community/
├── agent/                         # Autonomous Mineflayer Agent
│   ├── actuation/                 # Physical controls
│   │   ├── chat.js                # Chat actuator
│   │   ├── combat.js              # Auto-armor, sword, shield
│   │   ├── inventory.js           # Tool matching, chest transfers
│   │   ├── movement.js            # A* pathfinding, swimming
│   │   └── rconRescue.js          # RCON self-rescue on stuck
│   ├── brain-client/              # REST client with offline fallback
│   │   └── client.js              # Zero-loss memory queue
│   ├── cognition/                 # Internal state
│   │   ├── beliefs.js             # World model, trust estimates
│   │   ├── chunkMemory.js         # Spatial memory
│   │   ├── craftingChain.js       # Recipe knowledge
│   │   ├── emotions.js            # OCC appraisal engine
│   │   ├── goals.js               # Goal formulation
│   │   ├── persona.js             # Dynamic personality
│   │   ├── reflection.js          # Self-review
│   │   └── skillTracker.js        # Action tally, profession
│   ├── decision/                  # Decision making
│   │   ├── confidence.js          # Threshold evaluation
│   │   ├── dynamicRules.js        # Learned rules from ledger
│   │   ├── escalate.js            # LLM escalation
│   │   ├── rules/                 # 24+ rule evaluators
│   │   │   ├── breed.js
│   │   │   ├── build.js
│   │   │   ├── cooperate.js
│   │   │   ├── craft.js
│   │   │   ├── defend.js
│   │   │   ├── diamondSeek.js
│   │   │   ├── digUp.js
│   │   │   ├── eat.js
│   │   │   ├── enchant.js
│   │   │   ├── explore.js
│   │   │   ├── farm.js
│   │   │   ├── fight.js
│   │   │   ├── flee.js
│   │   │   ├── guard.js
│   │   │   ├── hunt.js
│   │   │   ├── lootStructure.js
│   │   │   ├── mine.js
│   │   │   ├── scout.js
│   │   │   ├── sleep.js
│   │   │   ├── smelt.js
│   │   │   ├── steal.js
│   │   │   ├── talk.js
│   │   │   ├── trade.js
│   │   │   └── villageSeek.js
│   │   └── tree.js                # Main decision loop
│   ├── memory/                    # Memory clients
│   │   ├── buffer.js              # Rolling 20-event buffer
│   │   ├── client.js              # Memory service client
│   │   └── societyClient.js       # Society layer client
│   ├── perception/                # Sensory input
│   │   ├── affordances.js         # What can I do?
│   │   ├── events.js              # Normalized events
│   │   └── senses.js              # Raw perception
│   ├── plugins/                   # Mineflayer plugins
│   │   └── loader.js              # Plugin loader
│   ├── skills/                    # Learned skills
│   │   ├── barter.js
│   │   ├── builder.js
│   │   └── farmer.js
│   ├── social/                    # Social systems
│   │   ├── conflictResolver.js    # Dispute resolution
│   │   ├── deathInvestigator.js   # Cause-of-death analysis
│   │   ├── dialogue.js            # Social dialogue engine
│   │   ├── events.js              # Social events
│   │   ├── factions.js            # Faction management
│   │   ├── gossip.js              # Rumor propagation
│   │   ├── stealDetection.js      # Theft detection
│   │   └── taxCollector.js        # Tax system
│   ├── stats/                     # Numeric stats
│   │   ├── decay.js               # Stat decay over time
│   │   ├── relationships.js       # Trust tracking
│   │   └── stats.js               # Health/hunger/etc
│   ├── config.js                  # Agent configuration
│   ├── Dockerfile                 # Agent container
│   └── index.js                   # Main tick loop
│
├── broker/                        # Brain Broker Gateway
│   ├── cache/
│   │   ├── exactCache.js          # SHA-256 exact cache
│   │   └── semanticCache.js       # 768d cosine semantic cache
│   ├── knowledge/
│   │   └── progression.md         # Minecraft progression hints
│   ├── providers/                 # 25+ LLM providers
│   │   ├── agnes.js
│   │   ├── cehpoint.js
│   │   ├── cerebras.js
│   │   ├── chutes.js
│   │   ├── cloudflare.js
│   │   ├── cohere.js
│   │   ├── freellm.js
│   │   ├── gemini.js
│   │   ├── githubmodels.js
│   │   ├── groq.js
│   │   ├── huggingface.js
│   │   ├── kiraai.js
│   │   ├── literouter.js
│   │   ├── llm7.js
│   │   ├── mistral.js
│   │   ├── nvidia.js
│   │   ├── ollamacloud.js
│   │   ├── ollamalocal.js
│   │   ├── omniroute.js
│   │   ├── openrouter.js
│   │   ├── pollinations.js
│   │   ├── qwen.js
│   │   ├── qwenlocal.js
│   │   ├── sambanova.js
│   │   ├── siliconflow.js
│   │   ├── tokenreply.js
│   │   ├── zhipu.js
│   │   └── zhipuai.js
│   ├── search/
│   │   └── webSearch.js           # Web knowledge client
│   ├── config.js
│   ├── Dockerfile
│   ├── index.js                   # Express REST API
│   ├── rateLimiter.js             # HTTP 429 cooldown
│   └── router.js                  # Provider routing logic
│
├── memory-service/                # Memory & Reflection
│   ├── embeddings/                # Embedding engines
│   ├── reflection/
│   │   └── engine.js              # Generative reflection
│   ├── sections/
│   │   ├── compactor.js           # Two-tier compaction
│   │   └── schema.js              # Section file parser
│   ├── store/
│   │   ├── agents/<agentId>/      # Per-agent KB
│   │   ├── civilization/
│   │   │   ├── ledger.js          # Shared ledger
│   │   │   └── ledger.json        # Runtime data (gitignored)
│   │   └── vectorStore.js         # Semantic vector index
│   ├── config.js
│   ├── Dockerfile
│   ├── index.js                   # REST API
│   ├── router.js                  # Event-to-section router
│   ├── scheduler.js               # Background compaction
│   └── society.js                 # Society knowledge layer
│
├── dashboard/                     # Civilization Dashboard
│   ├── client/
│   │   ├── index.html
│   │   ├── civilization.html
│   │   ├── app.js
│   │   └── styles.css
│   ├── server/
│   │   ├── aggregator.js          # Telemetry aggregator
│   │   ├── spectator.js           # 3D world viewer
│   │   ├── rcon.js                # RCON client
│   │   └── routes/                # API routes
│   │       ├── agents.js
│   │       ├── chat.js
│   │       ├── health.js
│   │       ├── ledger.js
│   │       ├── memory.js
│   │       └── timeline.js
│   ├── package.json
│   └── Dockerfile
│
├── shared/                        # Common utilities
│   ├── constants.js               # Enums for actions, stats
│   ├── detailedLogger.js          # Audit log engine
│   ├── embeddingClient.js         # Embedding client
│   ├── logger.js                  # Console logging
│   └── math.js                    # Vector math
│
├── scripts/                       # Ops tooling
│   ├── benchmark-resources.sh     # Container footprints
│   ├── fetch_logs.ps1             # Log fetcher (Windows)
│   ├── full_reset.sh              # Full reset
│   ├── inspect_brains.js          # Debug tool
│   ├── seed-survival-skills.js    # Initial skill seeding
│   ├── spawn-agent.sh             # Dynamic agent spawning
│   └── test_all_providers.js      # Provider tester
│
├── docker-compose.yml             # Full stack orchestration
├── package.json                   # Dependencies
├── .env.example                   # Environment template
├── .gitignore
├── LICENSE                        # MIT
├── README.md                      # Project overview
└── ARCHITECTURE.md                # This document
```

---

## License

MIT
