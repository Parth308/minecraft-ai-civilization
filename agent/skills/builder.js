const Vec3 = require('vec3');
const logger = require('../../shared/logger');
const detailedLogger = require('../../shared/detailedLogger');

class BuilderSkill {
  constructor(bot, inventoryActuator, movementActuator, goalManager = null, memoryServiceUrl = process.env.MEMORY_SERVICE_URL || 'http://localhost:3002') {
    this.bot = bot;
    this.inventory = inventoryActuator;
    this.movement = movementActuator;
    this.goalManager = goalManager || bot.goalManager || null;
    this.memoryServiceUrl = memoryServiceUrl;
    this.cooldownUntil = 0;
    this.invalidSites = new Set();
  }

  get agentId() {
    return this.bot.username || 'UnknownAgent';
  }

  getAvailableBuildingBlocks() {
    if (!this.bot.inventory) return [];
    return this.bot.inventory.items().filter(i => 
      i.name.includes('planks') ||
      i.name.includes('cobblestone') ||
      i.name.includes('stone') ||
      i.name.includes('dirt') ||
      i.name.includes('wood') ||
      i.name.includes('brick')
    );
  }

  async checkTerritoryAt(x, y, z) {
    try {
      const res = await fetch(`${this.memoryServiceUrl}/api/ledger/territory?x=${x}&y=${y}&z=${z}`);
      if (res.ok) return await res.json();
    } catch (_) {}
    return { claimed: false, claim: null };
  }

  async findUnclaimedBuildSite(preferredPos, searchRadius = 60) {
    // Check preferred position first
    const initCheck = await this.checkTerritoryAt(preferredPos.x, preferredPos.y, preferredPos.z);
    if (!initCheck.claimed || initCheck.claim?.agentId === this.agentId) {
      return preferredPos;
    }

    logger.info('Builder', `Preferred site at (${preferredPos.x}, ${preferredPos.z}) is claimed by ${initCheck.claim.agentId}. Searching for non-overlapping boundary...`);
    
    // Spiral offset search outward
    for (let rad = 30; rad <= searchRadius; rad += 25) {
      const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, Math.PI / 4, (5 * Math.PI) / 4];
      for (const angle of angles) {
        const cx = Math.round(preferredPos.x + Math.cos(angle) * rad);
        const cz = Math.round(preferredPos.z + Math.sin(angle) * rad);
        const check = await this.checkTerritoryAt(cx, preferredPos.y, cz);
        if (!check.claimed || check.claim?.agentId === this.agentId) {
          logger.info('Builder', `Discovered unclaimed territory plot at (${cx}, ${preferredPos.y}, ${cz})`);
          return new Vec3(cx, preferredPos.y, cz);
        }
      }
    }
    return preferredPos.offset(40, 0, 40);
  }

  async buildShelter(origin = null, width = 3, length = 3, height = 2) {    if (Date.now() < this.cooldownUntil) {
      const remainingSec = Math.ceil((this.cooldownUntil - Date.now()) / 1000);
      logger.debug('Builder', `Shelter construction is on cooldown for another ${remainingSec}s.`);
      return false;
    }

    const buildBlocks = this.getAvailableBuildingBlocks();
    if (buildBlocks.length === 0) {
      logger.warn('Builder', 'No building blocks available in inventory to build shelter.');
      this.cooldownUntil = Date.now() + 30000;
      return false;
    }

    let rawPos = origin || this.bot.entity.position.floored().offset(2, 0, 2);
    // Surface-seek: cave walls are not building sites. Climb the column for
    // the first open-air cell with solid ground before placing anything.
    let surfaced = null;
    for (let dy = 0; dy <= 30; dy++) {
      const probe = rawPos.offset(0, dy, 0);
      const cell = this.bot.blockAt(probe);
      const floor = this.bot.blockAt(probe.offset(0, -1, 0));
      if (cell && cell.name === 'air' && floor && floor.name !== 'air' && (cell.skyLight ?? 0) > 0) {
        surfaced = probe;
        break;
      }
    }
    if (!surfaced) {
      this.cooldownUntil = Date.now() + 60000;
      logger.warn('Builder', `No surface site above ${rawPos} (30-block scan). Cooling down.`);
      return false;
    }
    rawPos = surfaced;
    // Find unclaimed territory to prevent overlapping structures
    const startPos = await this.findUnclaimedBuildSite(rawPos);
    const siteKey = `${startPos.x},${startPos.y},${startPos.z}`;

    if (this.invalidSites.has(siteKey)) {
      logger.warn('Builder', `Skipping invalid build site at ${startPos} and applying cooldown.`);
      this.cooldownUntil = Date.now() + 60000;
      return false;
    }

    logger.info('Builder', `Starting autonomous shelter construction at ${startPos} (${width}x${length}x${height})...`);
    detailedLogger.logCognition(this.agentId, 'Initiated Autonomous Shelter Construction', { origin: startPos, dimensions: { width, length, height } });

    let placedCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < length; z++) {
          // Build only the perimeter walls (leave interior empty, leave 1 door block open on front wall)
          const isPerimeter = (x === 0 || x === width - 1 || z === 0 || z === length - 1);
          const isDoor = (x === Math.floor(width / 2) && z === 0 && (y === 0 || y === 1));

          if (isPerimeter && !isDoor) {
            const targetPos = startPos.offset(x, y, z);
            const currentBlock = this.bot.blockAt(targetPos);

            if (currentBlock && currentBlock.name === 'air') {
              const groundBelow = this.bot.blockAt(targetPos.offset(0, -1, 0));
              const primaryBlock = this.getAvailableBuildingBlocks()[0];

              if (!primaryBlock) break;

              if (groundBelow && groundBelow.name !== 'air') {
                try {
                  await this.movement.goto(targetPos.x, targetPos.y, targetPos.z, 2);
                  await this.inventory.placeBlock(primaryBlock.name, groundBelow, new Vec3(0, 1, 0));
                  placedCount++;
                } catch (e) {
                  // continue
                }
              }
            }
          }
        }
      }
    }

    if (placedCount === 0) {
      this.invalidSites.add(siteKey);
      this.cooldownUntil = Date.now() + 60000;
      logger.warn('Builder', `Shelter construction failed (0 blocks placed at ${startPos}). Marked site invalid and set 60s cooldown.`);
      
      // Clear active build goal if currently set
      const gm = this.goalManager || this.bot.goalManager;
      if (gm && gm.currentGoal) {
        const desc = (gm.currentGoal.description || '').toLowerCase();
        if (desc.includes('shelter') || desc.includes('build')) {
          gm.setGoal('Explore surroundings and seek suitable building ground', { previousFailedSite: siteKey });
        }
      }
      return false;
    }

    logger.info('Builder', `Shelter construction complete. Placed ${placedCount} structural blocks.`);
    detailedLogger.logInventory(this.agentId, 'Completed Structure Build', { blocksPlaced: placedCount });

    // Register territory claim in central civilization ledger
    try {
      await fetch(`${this.memoryServiceUrl}/api/ledger/territory/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: this.agentId,
          origin: { x: startPos.x, y: startPos.y, z: startPos.z },
          radius: 20,
          structureType: 'shelter'
        })
      });
      // Three shelters by one settler starts reading as a hamlet — the
      // ledger dedups by name, so repeat posts are harmless no-ops.
      const claimsRes = await fetch(`${this.memoryServiceUrl}/api/ledger/territory/all`);
      if (claimsRes.ok) {
        const myClaims = ((await claimsRes.json()).claims || []).filter(c => c.agentId === this.agentId);
        if (myClaims.length >= 3) {
          const short = String(this.agentId).replace(/^Agent_/, '');
          await fetch(`${this.memoryServiceUrl}/api/ledger/settlement`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${short}'s Hamlet`,
              claimedBy: this.agentId,
              center: { x: startPos.x, y: startPos.y, z: startPos.z },
              radius: 50
            })
          });
        }
      }
    } catch (claimErr) {
      logger.debug('Builder', `Failed to register territory claim: ${claimErr.message}`);
    }

    return true;
  }

  housePlan() {
    const cells = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 7; x++) {
        for (let z = 0; z < 5; z++) {
          const perimeter = x === 0 || x === 6 || z === 0 || z === 4;
          const divider = x === 3 && z !== 0;
          const frontDoor = x === 3 && z === 0 && y < 2;
          const roomDoor = x === 3 && z === 2 && y < 2;
          if ((perimeter && !frontDoor) || (divider && !roomDoor)) cells.push({ dx: x, dy: y, dz: z });
        }
      }
    }
    return cells;
  }

  hallPlan() {
    const cells = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 9; x++) {
        for (let z = 0; z < 5; z++) {
          const perimeter = x === 0 || x === 8 || z === 0 || z === 4;
          const stall = (x === 2 || x === 4 || x === 6) && z !== 0;
          const door = x === 4 && z === 0 && y < 2;
          if ((perimeter && !door) || stall) cells.push({ dx: x, dy: y, dz: z });
        }
      }
    }
    return cells;
  }

  async buildBlueprint(origin = null, name = 'house') {
    if (Date.now() < this.cooldownUntil) return false;
    const cells = name === 'trading_hall' ? this.hallPlan() : this.housePlan();

    const buildBlocks = this.getAvailableBuildingBlocks();
    if (buildBlocks.length === 0) {
      this.cooldownUntil = Date.now() + 30000;
      return false;
    }

    let rawPos = origin || this.bot.entity.position.floored().offset(4, 0, 4);
    let surfaced = null;
    for (let dy = 0; dy <= 30; dy++) {
      const probe = rawPos.offset(0, dy, 0);
      const cell = this.bot.blockAt(probe);
      const floor = this.bot.blockAt(probe.offset(0, -1, 0));
      if (cell && cell.name === 'air' && floor && floor.name !== 'air' && (cell.skyLight ?? 0) > 0) {
        surfaced = probe;
        break;
      }
    }
    if (!surfaced) {
      this.cooldownUntil = Date.now() + 60000;
      return false;
    }
    const startPos = await this.findUnclaimedBuildSite(surfaced);
    const siteKey = `${startPos.x},${startPos.y},${startPos.z}`;
    if (this.invalidSites.has(siteKey)) {
      this.cooldownUntil = Date.now() + 60000;
      return false;
    }

    logger.info('Builder', `Starting blueprint '${name}' at ${startPos} (${cells.length} cells)...`);
    let placedCount = 0;
    for (const cell of cells) {
      const targetPos = startPos.offset(cell.dx, cell.dy, cell.dz);
      const currentBlock = this.bot.blockAt(targetPos);
      if (!currentBlock || currentBlock.name !== 'air') continue;
      const groundBelow = this.bot.blockAt(targetPos.offset(0, -1, 0));
      const primaryBlock = this.getAvailableBuildingBlocks()[0];
      if (!primaryBlock || !groundBelow || groundBelow.name === 'air') continue;
      try {
        await this.movement.goto(targetPos.x, targetPos.y, targetPos.z, 2);
        await this.inventory.placeBlock(primaryBlock.name, groundBelow, new Vec3(0, 1, 0));
        placedCount++;
      } catch (_) {}
      if (placedCount >= 6) break;
    }

    if (placedCount > 0) {
      const torches = (this.bot.inventory?.items() || []).find(i => i.name === 'torch');
      if (torches) {
        for (const spot of [{ dx: 1, dz: 2 }, { dx: 5, dz: 2 }]) {
          try {
            const p = startPos.offset(spot.dx, 1, spot.dz);
            const ground = this.bot.blockAt(p.offset(0, -1, 0));
            if (this.bot.blockAt(p)?.name === 'air' && ground && ground.name !== 'air') {
              await this.inventory.placeBlock('torch', ground, new Vec3(0, 1, 0));
            }
          } catch (_) {}
        }
      }
    }

    if (placedCount === 0) {
      this.invalidSites.add(siteKey);
      this.cooldownUntil = Date.now() + 60000;
      return false;
    }

    logger.info('Builder', `Blueprint '${name}' complete. Placed ${placedCount} blocks.`);
    try {
      await fetch(`${this.memoryServiceUrl}/api/ledger/territory/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: this.agentId,
          origin: { x: startPos.x, y: startPos.y, z: startPos.z },
          radius: 25,
          structureType: name
        })
      });
    } catch (_) {}
    let remaining = 0;
    for (const cell of cells) {
      const targetPos = startPos.offset(cell.dx, cell.dy, cell.dz);
      const cur = this.bot.blockAt(targetPos);
      if (cur && cur.name === 'air') remaining++;
    }
    return remaining === 0 ? true : 'partial';
  }
}

module.exports = BuilderSkill;

