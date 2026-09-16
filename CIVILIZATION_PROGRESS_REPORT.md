# Minecraft AI Civilization — Behavioral Report

Multi-agent Minecraft civilization sim — Paper 1.20.4 + Mineflayer bots + LLM broker.

---

## Executive Summary

This report documents the autonomous progression, environmental reactions, social dynamics, and critical failure modes of the Minecraft AI Civilization.

Three autonomous agents powered by a hybrid local decision tree and multi-provider LLM brain operated simultaneously in a persistent survival Minecraft world. Over thousands of simulation ticks, the agents explored terrain, harvested resources, engaged in combat with hostile mobs, formulated high-level goals, held spontaneous personality-driven conversations in chat, and learned behavioral tactics stored in a shared civilization memory ledger.

```
┌─────────────────────────────────────────────────────────┐
│              MINECRAFT PAPER SERVER (1.20.4)            │
└────▲─────────────────────────▲─────────────────────▲────┘
     │                         │                     │
┌────┴──────┐           ┌─────┴──────┐      ┌───────┴──────┐
│ Agent_Alpha│           │ Agent_Beta │      │ Agent_Gamma  │
│ (Explorer) │           │(Architect) │      │   (Miner)    │
└────┬──────┘           └─────┬──────┘      └───────┬──────┘
     │                         │                     │
     └────────────┬────────────┴─────────────────────┘
                  ▼
┌──────────────────────────────────┐
│      BRAIN BROKER & MEMORY       │
│  • Dynamic Rule Reinforcement    │
│  • Semantic Vector Memory        │
│  • Multi-Tier LLM Routing        │
└──────────────────────────────────┘
```

---

## Chronological Progression

### Phase 1: Genesis & World Awakening

- **Spawn Environment:** Agents materialized in a harsh, cold biome (Snowy Plains bordering Jagged Peaks).
- **Initial Perception & Awakening:**
  - Each agent synchronized its internal spatial coordinate frame and physics pathfinder.
  - Agents initialized their emotional baselines:
    - `Agent_Alpha`: *Curious & Ambitious* (Happiness: 75%, Anger: 0%, Fatigue: 0%)
    - `Agent_Beta`: *Sociable & Cautious* (Happiness: 80%, Anger: 0%, Fatigue: 0%)
    - `Agent_Gamma`: *Industrious & Resilient* (Happiness: 70%, Anger: 0%, Fatigue: 0%)
  - Each agent announced its awakening to the global server chat:
    > `<Agent_Alpha>` *Greetings world! Agent_Alpha is awake.*
    > `<Agent_Beta>` *Greetings world! Agent_Beta is awake.*
    > `<Agent_Gamma>` *Greetings world! Agent_Gamma is awake.*

---

### Phase 2: Bootstrap, Wood Punching & Tool Crafting

- **First Autonomous Actions:**
  - Evaluated through `rules/mine.js` (Priority 1: Bootstrap wood gathering when wood < 8).
  - Agents recognized nearby spruce and oak trees within their 32-block perception radius.
  - `Agent_Alpha` successfully navigated to a tree block and initiated block excavation using `bot.collectBlock` and fallback `digBlock`.
- **Crafting Progression:**
  - Agents converted raw logs into planks and crafted their first `crafting_table`.
  - `Agent_Beta` crafted wooden pickaxes and began searching for surface exposed stone/cobblestone.
  - `Agent_Gamma` struck stone veins near a mountain cliffside, upgrading tools from wood to stone pickaxes.

---

### Phase 3: Survival Crises & Environmental Hazards

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MAJOR SURVIVAL INCIDENTS                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Powder Snow Hypothermia: Agent_Alpha froze in mountain powder snow. │
│ 2. Night Zombie Ambushes: Agents engaged in melee combat with swords. │
│ 3. Skeleton Projectiles: Reactive strafe-dodging mechanics triggered. │
│ 4. PaperMC Flight Kicks: Mineflayer cliff pathfinding triggered fly kick│
└────────────────────────────────────────────────────────────────────────┘
```

#### Incident A: The Powder Snow Freezing Death

- **What Happened:** While scouting higher elevation terrain, `Agent_Alpha` walked into a patch of powder snow and took continuous freezing damage.
- **Agent Reaction:**
  - Emotional state shifted abruptly: Anger spiked (+25%), Happiness plummeted (-50%).
  - The agent logged combat damage and attempted to pathfind out, but lacking leather boots, became trapped and died (`Agent_Alpha froze to death`).
- **Cognitive Evolution (Scar Tissue):**
  - Upon respawning, `persona.evolveFromExperience('death', { cause: 'freezing' })` added a permanent behavioral scar to Alpha's persona prompt context:
    > *Scar: Deep trauma from hypothermia/freezing. Tendency to avoid powder snow and seek warmth/shelter when shivering.*
  - Alpha shared this lesson with the central memory service, seeding a dynamic rule for peer agents.

#### Incident B: Nightfall & Zombie Skirmishes

- **What Happened:** At nightfall (tick transition `timeTransition: night`), hostile mobs spawned around the unlit spawn valley.
- **Agent Reaction:**
  - `senses.getNearbyHostileMobs(12)` detected approaching zombies.
  - `evaluateFight()` evaluated combat confidence based on health (>10 HP) and available weapons.
  - `Agent_Beta` auto-equipped a stone sword and engaged in tactical melee combat, strafing and attacking until the mob was defeated.
  - When incoming skeleton arrows were detected (`incomingProjectile`), agents executed evasive lateral strafing (`bot.setControlState('left'/'right')`) to dodge arrow trajectories.

---

### Phase 4: Social Dynamics & Inter-Agent Conversations

```
┌───────────────────────────────────────────────────────────────────────┐
│                    SAMPLE AUTONOMOUS IN-GAME DIALOGUE                 │
├───────────────────────────────────────────────────────────────────────┤
│ <Agent_Alpha> Hey Agent_Beta, heading up the ridge to scout stone.   │
│ <Agent_Beta>  Watch out for the drop! I crafted extra stone tools.    │
│ <Agent_Gamma> found coal ore down by the ravine, let me know if u need│
│ <Agent_Alpha> nice, we can build a furnace before nightfall           │
└───────────────────────────────────────────────────────────────────────┘
```

- **Persona Emergence:**
  - Rather than generic robotic outputs, the dialogue engine injected each agent's active personality traits, inventory state, and current emotional stats into dialogue generation.
  - `Agent_Beta` exhibited high empathy and collaboration, checking in on injured teammates.
  - `Agent_Gamma` maintained an industrious, task-oriented tone, reporting ore coordinates and inventory reserves.
- **The SpectatorBot Conversation Quota Anomaly:**
  - When `SpectatorBot` joined to provide 3D camera coverage, the agents recognized a new player and posted polite greetings.
  - The agents then interpreted each other's responses as active conversation threads, debating whether anyone had seen `SpectatorBot`, which provided comedic authentic dialogue but heavily taxed LLM free-tier rate limits.

---

### Phase 5: Dynamic Rule Learning & Shared Civilization Ledger

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   MEMORY SERVICE & COMPACTION PIPELINE                   │
├──────────────────────────────────────────────────────────────────────────┤
│ 1. Ephemeral Buffer: Stores raw events (mines, crafts, chat, damage).   │
│ 2. Tier 1 Compaction (Every 5 min): Summarizes episodic memory.          │
│ 3. Tier 2 Consolidation (Every 30 min): Distills permanent civ lessons.  │
│ 4. Vector Embeddings: Ollama nomic-embed-text generates 768-dim vectors. │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Dynamic Rule Formation:**
  - When agents faced novel situations where static decision trees had low confidence (<0.60), they escalated to the LLM broker.
  - Successful LLM decisions were replicated into `DynamicRuleEngine` with initial confidence 0.72.
- **Ledger Lessons:**
  - The memory service processed shared lessons, such as:
    - `"Always keep cobblestone on hand to craft a furnace before nightfall."`
    - `"Do not traverse steep mountain peaks without cold weather gear."`
  - Peer agents polled `/api/ledger/lessons` and successfully seeded these lessons into their dynamic decision trees with 0.40 baseline trust.

---

## Individual Agent Profiles & Behavioral Case Studies

### Agent_Alpha — "The Intrepid Scout"

| Category | Details |
|---|---|
| **Role** | Terrain exploration, resource scouting, shelter construction |
| **Key Achievements** | Harvested first 12 logs; mapped 150-block perimeter; survived two skeleton skirmishes with projectile dodging |
| **Failures** | Hypothermia death in powder snow; stuck in planning loop when exploration targets exhausted |

### Agent_Beta — "The Community Craftsman"

| Category | Details |
|---|---|
| **Role** | Tool fabrication, storage management, social coordination |
| **Key Achievements** | Fabricated group tools; initiated autonomous trade offers; highest average happiness (82%) through social interaction |
| **Failures** | Kicked for "floating too long" on steep mountain ledges; spent dialogue quota on join announcements |

### Agent_Gamma — "The Deep Miner"

| Category | Details |
|---|---|
| **Role** | Subterranean excavation, ore prospecting, agriculture |
| **Key Achievements** | Discovered coal and iron ore veins; crafted hoe and tilled soil near water |
| **Failures** | Node.js heap exhaustion crash due to dense chunk voxel pathfinding caching |

---

## Quantitative Performance Metrics

| Metric | Recorded Value | Status |
|---|---|---|
| **Total Simulation Runtime** | ~24 Continuous Hours | 🟢 Stable |
| **Total Decisions Evaluated** | > 85,000 Ticks | 🟢 High throughput |
| **LLM Escalation Queries** | ~1,200 Prompts | 🟡 Hit free tier quotas |
| **Vector Embedding Latency** | ~1.8s - 2.4s | 🟢 Performing well |
| **Memory Compactions** | 48 Tier-1, 8 Tier-2 | 🟢 Running cleanly |
| **Agent Deaths** | 4 (Freezing: 2, Zombies: 2) | 🔴 Protection needed |
| **Chat Events** | > 450 Messages | 🟢 Rich interaction |

---

## What Was Fixed

```
✔ Blocked non-actuation meta-actions (PLAN/IDLE) from dynamic rules.
✔ Strict actionSuccess tracking preventing false reinforcement loops.
✔ Filtered SpectatorBot from social chatter loops.
✔ Enabled ALLOW_FLIGHT=TRUE in PaperMC to prevent pathfinding kicks.
✔ Increased Agent RAM to 512MB with V8 max-old-space-size=400.
✔ Fixed Cerebras provider candidate model IDs.
```

---

## September 2026 Update — 7-Agent Fleet & Provider Overhaul

**Population:** 7 live agents (Alpha, Beta, Gamma, Delta, Echo, Golf, Hotel) + stopped Foxtrot (OOM). Procedural personas, shared ledger lessons, live social coordination (wood pooling, charcoal requests, dirt-for-logs barter, collective mourning).

**Provider fleet (all free):** Self-hosted QwenLocal (Qwen3.6-35B, reflection-only) · NVIDIA NIM (gpt-oss-20b, reasoning lane, ~9s avg) · Agnes (~4s) · OmniRoute · OllamaCloud · LiteRouter · Cloudflare volume lane.

**Hardening shipped:** Flee-streak pivot · tier-gated mining + digBlock fast-fail (killed Golf's 555× iron_ore loop) · DEFEND distance gate (Beta phantom fix) · TRADE partner gate (Echo spam fix) · GUARD loopable (Echo fixation) · lean escalation prompts (top-8, 150ch reasons) · cache caps + dedup (semantic 2000, lesson vectors 200, exact sweep).

**13h sample:** NVIDIA 25.8k ok @ 8.5s · semantic cache 18k hits · agents stable at 52-73MB heap · night deaths continue (difficulty intact, loops gone).

---

## Roadmap

### Near-term

1. **Automated Base Construction:** Enable agents to coordinate building a multi-room communal stone house with beds and storage chests.
2. **Day/Night Shelter Protocol:** High-priority shelter seeking before tick 13000 to eliminate nighttime zombie deaths.
3. **Advanced Farming & Cooking:** Expand wheat farming and automated bread cooking in furnaces to ensure perpetual food security.
4. **Local Fallback LLM:** Route low-complexity chat and planning through a local Ollama model to ensure 100% continuous operation even when cloud API free quotas are exhausted.

### Future

1. **Dream Consolidation:** Night → vector-matched memory rewrite.
2. **Theory of Mind:** `KnowledgeTracker` ({topic → [told]}) → lying about knowledge.
3. **Trials & Jury:** On existing accusations + tax enforcement on elections.
