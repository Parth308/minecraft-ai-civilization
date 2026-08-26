const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../../shared/logger');

const SECTIONS = ['profile', 'relationships', 'events', 'skills', 'recent'];

function getAgentDirectory(agentId) {
  const dir = path.join(config.baseStorePath, agentId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSectionFilePath(agentId, sectionName) {
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
  getAgentDirectory,
  getSectionFilePath,
  initializeAgentMemoryFiles,
  parseSectionFile,
  writeSectionFile
};
