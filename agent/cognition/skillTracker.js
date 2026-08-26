const logger = require('../../shared/logger');

const SKILLS = {
  mining: { xp: 0, level: 1, title: 'Novice Miner' },
  crafting: { xp: 0, level: 1, title: 'Apprentice Crafter' },
  farming: { xp: 0, level: 1, title: 'Budding Farmer' },
  trading: { xp: 0, level: 1, title: 'Novice Trader' },
  building: { xp: 0, level: 1, title: 'Apprentice Builder' },
  fighting: { xp: 0, level: 1, title: 'Novice Fighter' },
  exploring: { xp: 0, level: 1, title: 'Curious Wanderer' },
  social: { xp: 0, level: 1, title: 'Friendly Stranger' },
  cooking: { xp: 0, level: 1, title: 'Amateur Cook' },
  fishing: { xp: 0, level: 1, title: 'Patient Fisher' },
};

const TITLES = {
  mining: [1, 'Novice Miner', 5, 'Apprentice Miner', 15, 'Journeyman Miner', 30, 'Expert Miner', 50, 'Master Miner', 80, 'Legendary Miner'],
  crafting: [1, 'Apprentice Crafter', 5, 'Journeyman Crafter', 15, 'Expert Crafter', 30, 'Master Crafter', 50, 'Grand Artisan', 80, 'Legendary Crafter'],
  farming: [1, 'Budding Farmer', 5, 'Apprentice Farmer', 15, 'Journeyman Farmer', 30, 'Expert Farmer', 50, 'Master Farmer', 80, 'Legendary Farmer'],
  trading: [1, 'Novice Trader', 5, 'Apprentice Trader', 15, 'Journeyman Trader', 30, 'Expert Trader', 50, 'Master Merchant', 80, 'Legendary Trader'],
  building: [1, 'Apprentice Builder', 5, 'Journeyman Builder', 15, 'Expert Builder', 30, 'Master Builder', 50, 'Architect', 80, 'Legendary Builder'],
  fighting: [1, 'Novice Fighter', 5, 'Apprentice Warrior', 15, 'Journeyman Warrior', 30, 'Expert Warrior', 50, 'Master Warrior', 80, 'Legendary Champion'],
  exploring: [1, 'Curious Wanderer', 5, 'Scout', 15, 'Pathfinder', 30, 'Explorer', 50, 'Master Explorer', 80, 'Legendary Explorer'],
  social: [1, 'Friendly Stranger', 5, 'Acquaintance', 15, 'Diplomat', 30, 'Emissary', 50, 'Ambassador', 80, 'Legendary Orator'],
  cooking: [1, 'Amateur Cook', 5, 'Apprentice Chef', 15, 'Journeyman Chef', 30, 'Expert Chef', 50, 'Master Chef', 80, 'Legendary Chef'],
  fishing: [1, 'Patient Fisher', 5, 'Apprentice Angler', 15, 'Journeyman Angler', 30, 'Expert Angler', 50, 'Master Angler', 80, 'Legendary Angler'],
};

const XP_PER_ACTION = {
  mine_block: 5, mine_ore: 10, mine_diamond: 25,
  craft_item: 3, craft_tool: 8, craft_advanced: 15,
  farm_plant: 4, farm_harvest: 6,
  trade_complete: 8, trade_large: 15,
  build_place: 3, build_structure: 20,
  fight_mob: 10, fight_boss: 30,
  explore_new_chunk: 12, explore_cave: 15,
  social_chat: 2, social_negotiate: 10,
  cook_food: 4, fish_catch: 5,
};

class SkillTracker {
  constructor(agentId) {
    this.agentId = agentId;
    this.skills = JSON.parse(JSON.stringify(SKILLS));
    this.actionTally = {};
    this.totalXpEarned = 0;
  }

  awardXp(skillName, amount) {
    if (!this.skills[skillName]) return;
    const oldLevel = this.skills[skillName].level;
    this.skills[skillName].xp += amount;
    this.totalXpEarned += amount;
    this.skills[skillName].level = this.calculateLevel(this.skills[skillName].xp);
    this.skills[skillName].title = this.getTitleForLevel(skillName, this.skills[skillName].level);

    if (this.skills[skillName].level > oldLevel) {
      logger.info('SkillTracker', `[LEVEL UP] ${this.agentId} ${skillName} reached level ${this.skills[skillName].level} — "${this.skills[skillName].title}"`);
      return { leveled: true, skill: skillName, newLevel: this.skills[skillName].level, title: this.skills[skillName].title };
    }
    return { leveled: false };
  }

  calculateLevel(xp) {
    let level = 1;
    let xpNeeded = 0;
    while (level < 100) {
      xpNeeded += Math.floor(20 * Math.pow(1.4, level - 1));
      if (xp < xpNeeded) break;
      level++;
    }
    return level;
  }

  getTitleForLevel(skillName, level) {
    const titleMap = TITLES[skillName] || [];
    let bestTitle = titleMap[1] || skillName;
    for (let i = 0; i < titleMap.length; i += 2) {
      if (level >= titleMap[i]) bestTitle = titleMap[i + 1];
    }
    return bestTitle;
  }

  recordAction(actionType) {
    this.actionTally[actionType] = (this.actionTally[actionType] || 0) + 1;

    const xpMap = {
      'MINE': () => {
        this.awardXp('mining', XP_PER_ACTION.mine_block);
      },
      'CRAFT': () => {
        this.awardXp('crafting', XP_PER_ACTION.craft_item);
      },
      'FARM': () => {
        this.awardXp('farming', XP_PER_ACTION.farm_plant);
      },
      'TRADE': () => {
        this.awardXp('trading', XP_PER_ACTION.trade_complete);
      },
      'BUILD': () => {
        this.awardXp('building', XP_PER_ACTION.build_place);
      },
      'FIGHT': () => {
        this.awardXp('fighting', XP_PER_ACTION.fight_mob);
      },
      'EXPLORE': () => {
        this.awardXp('exploring', XP_PER_ACTION.explore_new_chunk);
      },
      'TALK': () => {
        this.awardXp('social', XP_PER_ACTION.social_chat);
      },
    };

    if (xpMap[actionType]) xpMap[actionType]();
  }

  getDominantSkill() {
    let best = null;
    for (const [name, data] of Object.entries(this.skills)) {
      if (!best || data.xp > best.xp) best = { name, ...data };
    }
    return best;
  }

  getSummary() {
    const summary = {};
    for (const [name, data] of Object.entries(this.skills)) {
      summary[name] = { level: data.level, xp: data.xp, title: data.title };
    }
    return summary;
  }

  toContext() {
    const dominant = this.getDominantSkill();
    return {
      dominantSkill: dominant.name,
      dominantTitle: dominant.title,
      dominantLevel: dominant.level,
      totalXp: this.totalXpEarned,
      skills: this.getSummary()
    };
  }
}

module.exports = SkillTracker;
module.exports.SKILLS = SKILLS;
module.exports.TITLES = TITLES;
