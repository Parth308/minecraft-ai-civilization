#!/usr/bin/env node
/**
 * Seeds survival skill templates into the civilization ledger.
 * Run once at memory-service boot or manually via: node scripts/seed-survival-skills.js
 *
 * These lessons teach agents human-like escape strategies:
 * - Torch navigation (right=in, left=out)
 * - Water bucket escape
 * - Underground shelter (3x3 sealed)
 * - Strategic death (health<3, no food -> respawn)
 * - Tree planting underground
 * - Cobblestone dead-end markers
 * - Door air pocket
 * - Coordinates tracking
 *
 * Each lesson uses keywords that map to the correct action via
 * DynamicRuleEngine.extractActionFromLesson().
 */

const MEMORY_URL = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002';

const SURVIVAL_SKILLS = [
  // ── TORCH NAVIGATION ──────────────────────────────────────────────
  {
    lesson: 'When lost underground, place torches on the RIGHT wall to find the way out. Removing torches from the LEFT means you are going deeper. Right-hand rule escapes caves.',
    severity: 0.9,
    confidence: 0.95,
    context: { trigger: 'underground_lost', strategy: 'torch_navigation' }
  },
  {
    lesson: 'Place torches on one side only when entering caves. Right side for exit direction. This prevents getting lost underground.',
    severity: 0.8,
    confidence: 0.9,
    context: { trigger: 'cave_entry', strategy: 'torch_navigation' }
  },

  // ── WATER BUCKET ESCAPE ──────────────────────────────────────────
  {
    lesson: 'Carry a water bucket always. When falling into lava or a deep hole, place water at your feet to swim up. Water bucket is the best escape tool.',
    severity: 0.95,
    confidence: 0.95,
    context: { trigger: 'lava_fall', strategy: 'water_bucket' }
  },
  {
    lesson: 'If trapped in a deep hole with no way up, place water against the wall and swim to the surface. Water bucket saves lives.',
    severity: 0.85,
    confidence: 0.9,
    context: { trigger: 'deep_hole', strategy: 'water_bucket' }
  },
  {
    lesson: 'Water can be used to push mobs away and create a safe path. Place water upstream to flow down and clear hostile mobs.',
    severity: 0.7,
    confidence: 0.85,
    context: { trigger: 'mob_crowd', strategy: 'water_bucket' }
  },

  // ── UNDERGROUND SHELTER ──────────────────────────────────────────
  {
    lesson: 'When trapped underground at night, dig a 3x3x2 room in the wall, seal it with cobblestone, place a torch. Sleep if you have a bed. Wait for morning.',
    severity: 0.9,
    confidence: 0.95,
    context: { trigger: 'underground_night', strategy: 'underground_shelter' }
  },
  {
    lesson: 'Build a sealed shelter underground: 3 blocks wide, 3 blocks deep, 2 blocks high. Seal the entrance with cobblestone. Place torch inside. This is safe from all mobs.',
    severity: 0.85,
    confidence: 0.9,
    context: { trigger: 'underground_danger', strategy: 'underground_shelter' }
  },
  {
    lesson: 'If mobs are chasing you underground, dig into a wall, seal behind you with cobblestone. Mobs cannot break blocks. You are safe inside.',
    severity: 0.9,
    confidence: 0.95,
    context: { trigger: 'mob_chase', strategy: 'underground_shelter' }
  },

  // ── STRATEGIC DEATH ──────────────────────────────────────────────
  {
    lesson: 'When health is critical (below 3 hearts) and no food, sometimes dying is the best option. Respawn at spawn with full health and hunger. Strategic death saves time.',
    severity: 0.7,
    confidence: 0.8,
    context: { trigger: 'critical_health', strategy: 'strategic_death' }
  },
  {
    lesson: 'If stuck in an inescapable situation (lava, deep ocean, surrounded by mobs with no gear), let death happen. Respawn is better than prolonged suffering with no escape.',
    severity: 0.65,
    confidence: 0.75,
    context: { trigger: 'inescapable', strategy: 'strategic_death' }
  },
  {
    lesson: 'When lost far from base with no resources and night is coming, consider strategic death. Respawn at base is better than wandering and dying anyway.',
    severity: 0.6,
    confidence: 0.7,
    context: { trigger: 'lost_no_resources', strategy: 'strategic_death' }
  },

  // ── TREE PLANTING UNDERGROUND ────────────────────────────────────
  {
    lesson: 'Plant saplings underground near your shelter. Trees grow from saplings with light. Wood underground means you never need to surface for crafting.',
    severity: 0.8,
    confidence: 0.85,
    context: { trigger: 'underground_base', strategy: 'tree_planting' }
  },
  {
    lesson: 'Keep saplings in your inventory. When underground, place dirt and sapling near a torch. Wait for tree to grow. This gives wood for tools without surfacing.',
    severity: 0.75,
    confidence: 0.8,
    context: { trigger: 'no_wood', strategy: 'tree_planting' }
  },

  // ── COBBLESTONE DEAD-END MARKERS ─────────────────────────────────
  {
    lesson: 'Mark explored dead-end tunnels with cobblestone. When you see cobblestone in a cave, you have been there before. This prevents revisiting empty tunnels.',
    severity: 0.7,
    confidence: 0.85,
    context: { trigger: 'cave_exploration', strategy: 'dead_end_markers' }
  },
  {
    lesson: 'Place cobblestone at tunnel entrances you have explored. One cobblestone block means "already checked". This saves time when mining.',
    severity: 0.65,
    confidence: 0.8,
    context: { trigger: 'mining', strategy: 'dead_end_markers' }
  },

  // ── DOOR AIR POCKET ──────────────────────────────────────────────
  {
    lesson: 'When drowning underground, place a door against a wall. The door creates an air pocket you can breathe in. This saves you from drowning in flooded caves.',
    severity: 0.9,
    confidence: 0.9,
    context: { trigger: 'drowning', strategy: 'door_air_pocket' }
  },
  {
    lesson: 'Doors create air blocks in water. If stuck in a flooded tunnel, place a door and stand in it to breathe. Essential for underwater mining.',
    severity: 0.85,
    confidence: 0.88,
    context: { trigger: 'flooded_cave', strategy: 'door_air_pocket' }
  },

  // ── COORDINATES TRACKING ─────────────────────────────────────────
  {
    lesson: 'Always note your base coordinates. When exploring, remember the direction from base. North is negative Z, South is positive Z, East is positive X, West is negative X.',
    severity: 0.8,
    confidence: 0.9,
    context: { trigger: 'exploration', strategy: 'coordinates' }
  },
  {
    lesson: 'Track your Y level when mining. Diamonds are at Y=-59 to Y=-64. Iron is at Y=15 to Y=230. Knowing Y level prevents wasted mining.',
    severity: 0.75,
    confidence: 0.85,
    context: { trigger: 'mining', strategy: 'coordinates' }
  },

  // ── EMERGENCY CRAFTING ───────────────────────────────────────────
  {
    lesson: 'When trapped underground with no pickaxe, punch stone to get cobblestone. Craft a wooden pickaxe from sticks and planks. This gets you mining again.',
    severity: 0.8,
    confidence: 0.85,
    context: { trigger: 'no_tool', strategy: 'emergency_crafting' }
  },
  {
    lesson: 'Always carry 3 sticks and 2 planks. You can craft a crafting table and pickaxe anywhere. Emergency crafting saves you from being stuck.',
    severity: 0.75,
    confidence: 0.8,
    context: { trigger: 'inventory_management', strategy: 'emergency_crafting' }
  },

  // ── ESCAPE PATHS ─────────────────────────────────────────────────
  {
    lesson: 'When mining deep underground, always keep a clear path back to the surface. Dig a staircase, not a straight shaft. Stairs are climbable.',
    severity: 0.85,
    confidence: 0.9,
    context: { trigger: 'deep_mining', strategy: 'escape_paths' }
  },
  {
    lesson: 'If falling into a cave, immediately place water or blocks to break the fall. Never dig straight down - you might fall into lava.',
    severity: 0.9,
    confidence: 0.95,
    context: { trigger: 'falling', strategy: 'escape_paths' }
  },

  // ── FOOD STRATEGIES ──────────────────────────────────────────────
  {
    lesson: 'When hungry underground, kill bats or cave animals for food. Cook meat in a furnace for better hunger restoration. Raw meat restores less.',
    severity: 0.7,
    confidence: 0.8,
    context: { trigger: 'hunger', strategy: 'food_strategies' }
  },
  {
    lesson: 'Keep bread in your inventory. Craft bread from wheat. Three wheat makes three bread. Bread is the most reliable food source.',
    severity: 0.65,
    confidence: 0.75,
    context: { trigger: 'food_management', strategy: 'food_strategies' }
  },

  // ── MOB AVOIDANCE ────────────────────────────────────────────────
  {
    lesson: 'Skeletons shoot arrows from distance. Use blocks as cover. Approach from behind. Never run straight at a skeleton.',
    severity: 0.8,
    confidence: 0.85,
    context: { trigger: 'skeleton_encounter', strategy: 'mob_avoidance' }
  },
  {
    lesson: 'Creepers explode when close. Back away immediately when you hear the hiss. Place blocks between you and the creeper to block the explosion.',
    severity: 0.9,
    confidence: 0.9,
    context: { trigger: 'creeper_encounter', strategy: 'mob_avoidance' }
  },
  {
    lesson: 'Spiders are neutral in daylight, hostile at night. Avoid caves at night without a sword. Spiders can climb walls.',
    severity: 0.7,
    confidence: 0.8,
    context: { trigger: 'spider_encounter', strategy: 'mob_avoidance' }
  }
];

async function seedSurvivalSkills() {
  console.log(`[SEED] Seeding ${SURVIVAL_SKILLS.length} survival skill templates to ${MEMORY_URL}...`);

  let seeded = 0;
  let errors = 0;

  for (const skill of SURVIVAL_SKILLS) {
    try {
      const res = await fetch(`${MEMORY_URL}/api/ledger/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'survival_system',
          lesson: skill.lesson,
          isPublic: true,
          context: skill.context,
          confidence: skill.confidence,
          severity: skill.severity,
          status: 'shared'
        })
      });

      if (res.ok) {
        seeded++;
        console.log(`  [OK] ${skill.context.strategy}: "${skill.lesson.substring(0, 60)}..."`);
      } else {
        errors++;
        console.error(`  [FAIL] ${res.status}: ${skill.context.strategy}`);
      }
    } catch (err) {
      errors++;
      console.error(`  [ERROR] ${skill.context.strategy}: ${err.message}`);
    }
  }

  console.log(`[SEED] Done. Seeded: ${seeded}, Errors: ${errors}`);
  return { seeded, errors };
}

// Run if called directly
if (require.main === module) {
  seedSurvivalSkills()
    .then(result => {
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('[SEED] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { seedSurvivalSkills, SURVIVAL_SKILLS };
