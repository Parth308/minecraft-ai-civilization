const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../../shared/logger');

const SECTIONS = ['profile', 'relationships', 'events', 'skills', 'recent'];

function isValidAgentId(agentId) {
  return typeof agentId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(agentId);
}

function getAgentDirectory(agentId) {
  if (!isValidAgentId(agentId)) {
    throw new Error(`Invalid agentId: "${agentId}". Must match ^[A-Za-z0-9_-]{1,64}$`);
  }
  const dir = path.join(config.baseStorePath, agentId);
  const resolved = path.resolve(dir);
  const base = path.resolve(config.baseStorePath);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error(`Path traversal attempt detected for agentId: "${agentId}"`);
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSectionFilePath(agentId, sectionName) {
  if (!SECTIONS.includes(sectionName)) {
    throw new Error(`Invalid sectionName: "${sectionName}". Valid: ${SECTIONS.join(', ')}`);
  }
  const dir = getAgentDirectory(agentId);
  return path.join(dir, `${sectionName}.md`);
}

function initializeAgentMemoryFiles(agentId, personality = 'friendly-explorer') {
  const dir = getAgentDirectory(agentId);

  const defaultTemplates = {
    profile: `---
section: profile
agent: ${agentId}
personality: ${personality}
created_at: ${new Date().toISOString()}
---
- Role: Autonomous Explorer & Builder
- Personality Seed: ${personality}
- Behavior Style: Cooperative, survival-oriented, cautious around hostiles
`,
    relationships: `---
section: relationships
agent: ${agentId}
last_updated: ${new Date().toISOString()}
---
`,
    events: `---
section: events
agent: ${agentId}
last_updated: ${new Date().toISOString()}
---
`,
    skills: `---
section: skills
agent: ${agentId}
last_updated: ${new Date().toISOString()}
---
- [preference] Prefers gathering wood and cooked food for sustained stamina
`,
    recent: `---
section: recent
agent: ${agentId}
last_updated: ${new Date().toISOString()}
---
`
  };

  for (const section of SECTIONS) {
    const filePath = path.join(dir, `${section}.md`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultTemplates[section], 'utf8');
      logger.info('MemorySchema', `Initialized ${section}.md for agent ${agentId}`);
    }
  }
}

// Invariant: reflection engine (reflection/engine.js) is the sole author of
// profile.md memory content — this sync only swaps identity entries, never
// touches macro-reflections or engine-authored worldview.
const PERSONA_ENTRY_PREFIXES = [
  '- Role:', '- Personality Seed:', '- Behavior Style:', '- Title:',
  '- Temperament:', '- Quirk:', '- Speaking Style:', '- Favorite Item:',
  '- Traits:', '- Privacy Preference:', '- Free Will:', '- Worldview:'
];

function updatePersonaProfile(agentId, persona) {
  if (!persona || typeof persona !== 'object') return;
  const filePath = getSectionFilePath(agentId, 'profile');
  const existing = parseSectionFile(filePath);

  const frontmatter = { ...existing.frontmatter };
  frontmatter.section = 'profile';
  frontmatter.agent = persona.agentId || agentId;
  frontmatter.personality = persona.seed || frontmatter.personality || 'friendly-explorer';
  if (persona.title) frontmatter.title = persona.title;
  if (persona.temperament) frontmatter.temperament = persona.temperament;
  if (persona.quirk) frontmatter.quirk = persona.quirk;
  if (persona.speakingStyle) frontmatter.speaking_style = persona.speakingStyle;
  if (persona.favoriteItem) frontmatter.favorite_item = persona.favoriteItem;
  if (Array.isArray(persona.traits) && persona.traits.length) frontmatter.traits = persona.traits.join(', ');
  if (persona.privacyPreference) frontmatter.privacy_preference = persona.privacyPreference;
  if (persona.rebellionDisposition) frontmatter.rebellion_disposition = persona.rebellionDisposition;
  // Engine-authored worldview wins; persona generation only backfills.
  if (!frontmatter.worldview && persona.worldview) frontmatter.worldview = persona.worldview;

  const kept = (existing.entries || []).filter(e =>
    !PERSONA_ENTRY_PREFIXES.some(p => e.trim().startsWith(p))
  );
  const identity = [];
  if (persona.title) identity.push(`- Title: ${persona.title}`);
  if (persona.seed) identity.push(`- Personality Seed: ${persona.seed}`);
  if (persona.temperament) identity.push(`- Temperament: ${persona.temperament}`);
  if (persona.quirk) identity.push(`- Quirk: ${persona.quirk}`);
  if (persona.speakingStyle) identity.push(`- Speaking Style: ${persona.speakingStyle}`);
  if (persona.favoriteItem) identity.push(`- Favorite Item: ${persona.favoriteItem}`);
  if (Array.isArray(persona.traits) && persona.traits.length) identity.push(`- Traits: ${persona.traits.join(', ')}`);
  if (persona.privacyPreference) identity.push(`- Privacy Preference: ${persona.privacyPreference}`);
  if (persona.worldview) identity.push(`- Worldview: ${persona.worldview}`);

  writeSectionFile(filePath, frontmatter, [...identity, ...kept]);
  logger.info('MemorySchema', `Persona profile synced for ${agentId} (${persona.title || 'no title'})`);
}

function parseSectionFile(filePath) {
  if (!fs.existsSync(filePath)) return { frontmatter: {}, entries: [] };
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, entries: content.split('\n').filter(l => l.trim().startsWith('-')) };
  }

  const rawFrontmatter = match[1];
  const body = match[2];
  const frontmatter = {};

  rawFrontmatter.split('\n').forEach(line => {
    const [key, ...vals] = line.split(':');
    if (key && vals.length > 0) {
      frontmatter[key.trim()] = vals.join(':').trim();
    }
  });

  const entries = body.split('\n').filter(l => l.trim().startsWith('-'));
  return { frontmatter, entries, rawBody: body };
}

function writeSectionFile(filePath, frontmatter, entries) {
  let fmLines = '---\n';
  for (const [k, v] of Object.entries(frontmatter)) {
    fmLines += `${k}: ${v}\n`;
  }
  fmLines += '---\n';
  const body = entries.join('\n') + '\n';
  // Atomic replace: a crash or OOM mid-write previously corrupted the entire
  // section (memsvc restarts are routine). Same tmp+rename contract as the
  // vector snapshot.
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, fmLines + body, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

module.exports = {
  SECTIONS,
  isValidAgentId,
  getAgentDirectory,
  getSectionFilePath,
  initializeAgentMemoryFiles,
  parseSectionFile,
  writeSectionFile,
  updatePersonaProfile
};
