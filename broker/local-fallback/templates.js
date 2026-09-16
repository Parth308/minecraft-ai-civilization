'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../shared/logger');

const LEARNED_FILE = path.join(__dirname, 'learned-templates.json');
const MAX_LEARNED = 200;
const ANTI_REPEAT_WINDOW = 8;

const INTENT_PATTERNS = [
  { intent: 'greeting',   patterns: /^(hi|hey|hello|yo|sup|greetings|howdy|what'?s up|wassup|heya|hiya)/i },
  { intent: 'farewell',   patterns: /^(bye|goodbye|see ya|later|cya|gotta go|brb|gtg|night|adios)/i },
  { intent: 'yes',        patterns: /^(yes|yeah|yep|yup|sure|ok|okay|alright|aye|affirmative|deal|agreed|sounds good|let'?s go)/i },
  { intent: 'no',         patterns: /^(no|nah|nope|no way|pass|not really|negative|nay)/i },
  { intent: 'thanks',     patterns: /^(thanks|thx|ty|appreciate|cheers|nice|cool|sweet|awesome)/i },
  { intent: 'taunt',      patterns: /(stupid|idiot|noob|trash|terrible|worst|lame|suck|weak|pathetic)/i },
  { intent: 'compliment',  patterns: /(nice work|good job|great|impressive|well done|pro|based|respect|you rule|props)/i },
  { intent: 'help',       patterns: /(help|need|stuck|lost|where|how|can you|could you)/i },
  { intent: 'question',   patterns: /\?$/ },
  { intent: 'threat',     patterns: /(kill|destroy|raid|attack|fight|war|burn)/i },
  { intent: 'trade_offer', patterns: /(trade|swap|exchange|give|offer|sell|buy|deal)/i },
  { intent: 'accusation', patterns: /(stole|steal|thief|took my|where.*iron|where.*diamond)/i },
  { intent: 'gossip',     patterns: /(heard|rumor|apparently|they say|people say)/i },
  { intent: 'location',   patterns: /(where are you|your base|coordinates|coords|where.*live|hideout)/i },
  { intent: 'status',     patterns: /(how are you|you ok|how goes|how goes it|what'?s up with you|you good)/i },
  { intent: 'agreement',  patterns: /(let'?s go|we should|together|team up|join|collab)/i },
  { intent: 'refusal',    patterns: /(no way|not happening|forget it|never|not a chance|over my dead)/i },
  { intent: 'emote',      patterns: /(lol|haha|lmao|rofl|xd|bruh|oof|ugh)/i },
];

const ANTI_REPEAT = new Map();

function getTrustTier(trust) {
  if (trust < 30) return 'distrust';
  if (trust < 60) return 'neutral';
  return 'trusted';
}

function getMoodBucket(mood) {
  if (mood > 0.2) return 'happy';
  if (mood < -0.2) return 'angry';
  return 'neutral';
}

const TEMPLATES = {
  greeting: {
    trusted: {
      happy: ["yo {name}! good to see ya", "oh hey {name}! perfect timing", "{name}! been a minute, what you up to?", "yooo {name}! what's the move?", "hey {name}! been looking for you", "{name}! was just thinking about you"],
      neutral: ["hey {name}", "oh hey {name}", "yo {name}, what's up", "hey {name}, good to see ya", "{name}! sup", "hey {name}, been a while"],
      angry: ["...hey {name}", "oh. it's you {name}.", "hm? oh hey", "what do you need {name}"],
    },
    neutral: {
      happy: ["hey!", "yo! what's good", "oh hey, nice to see ya", "hiya!"],
      neutral: ["hey", "yo", "sup", "oh hey", "hi", "hey there"],
      angry: ["what", "yeah what do you want", "...hey", "hm?"],
    },
    distrust: {
      happy: ["oh hey... what's up", "hey. you need something?"],
      neutral: ["...what", "yeah?", "hm? oh hey", "you want something?"],
      angry: ["what do you want", "...", "leave me alone"],
    },
  },
  farewell: {
    trusted: { happy: ["see ya! stay safe", "catch ya later!", "later, don't get killed", "peace out {name}!"], neutral: ["later", "see ya", "catch ya later", "gotta go, peace"], angry: ["finally. bye", "whatever. later"] },
    neutral: { happy: ["see ya!", "later!", "bye!"], neutral: ["bye", "later", "see ya", "cya", "peace"], angry: ["bye", "whatever"] },
    distrust: { happy: ["uh... bye", "ok then. later"], neutral: ["bye", "later"], angry: ["good riddance", "finally"] },
  },
  yes: {
    trusted:  { happy: ["deal!", "let's do it!", "awesome, I'm in", "yes!", "absolutely!"], neutral: ["sure thing", "yep", "ok", "alright", "sounds good", "got it"], angry: ["fine. whatever", "sure i guess"] },
    neutral:  { happy: ["sure!", "yep!", "let's go"], neutral: ["sure", "yep", "ok", "alright", "yeah", "cool"], angry: ["...fine", "i guess"] },
    distrust: { happy: ["...sure", "ok i guess"], neutral: ["sure", "ok", "fine"], angry: ["...whatever", "fine"] },
  },
  no: {
    trusted:  { happy: ["nah not feeling it", "maybe later", "pass for now", "not today"], neutral: ["nah", "nope", "not right now", "pass", "skip"], angry: ["no. absolutely not", "hell no", "not a chance"] },
    neutral:  { happy: ["nah sorry", "maybe later"], neutral: ["nah", "nope", "pass", "no", "not really"], angry: ["no way", "not happening", "forget it"] },
    distrust: { happy: ["nah", "not really"], neutral: ["no", "nah", "pass"], angry: ["no.", "not a chance", "absolutely not"] },
  },
  thanks: {
    trusted:  { happy: ["anytime!", "of course!", "you got it!", "no problem!"], neutral: ["np", "sure", "no worries", "anytime"], angry: ["...whatever", "yeah ok"] },
    neutral:  { happy: ["np!", "no problem!", "sure thing"], neutral: ["np", "sure", "no worries", "yw"], angry: ["whatever", "ok"] },
    distrust: { happy: ["...sure", "ok"], neutral: ["np", "sure"], angry: ["hm", "whatever"] },
  },
  taunt: {
    trusted:  { happy: ["lol ok tough guy", "says you haha", "bro what"], neutral: ["excuse me?", "wow rude", "ok then"], angry: ["watch it", "say that again", "you want problems?"] },
    neutral:  { happy: ["lol nice try", "haha ok"], neutral: ["rude", "ok wow", "harsh", "low blow"], angry: ["say that again. i dare you", "watch your mouth", "you wanna go?"] },
    distrust: { happy: ["ok tough guy", "sure buddy"], neutral: ["wow", "ok then", "rude"], angry: ["careful", "keep talking", "you'll regret that"] },
  },
  compliment: {
    trusted:  { happy: ["aww thanks!", "right back at ya!", "heh, appreciate that", "you're not bad yourself"], neutral: ["thanks", "appreciate it", "not bad yourself", "heh thanks"], angry: ["...thanks i guess", "hm. ok"] },
    neutral:  { happy: ["thanks!", "appreciate that!", "you too!"], neutral: ["thanks", "appreciate it", "cool", "heh"], angry: ["...ok thanks"] },
    distrust: { happy: ["oh uh thanks", "...thanks"], neutral: ["thanks", "ok"], angry: ["hm", "...whatever"] },
  },
  help: {
    trusted:  { happy: ["on my way!", "sure what do you need?", "what's up, need help?", "coming!", "what do you need?"], neutral: ["what do you need?", "sure, what's up?", "how can I help?"], angry: ["...what do you need", "fine, what is it"] },
    neutral:  { happy: ["sure what's up?", "need help?"], neutral: ["what do you need?", "sure", "what's up?"], angry: ["what", "what do you want"] },
    distrust: { happy: ["...what do you need?", "sure I guess"], neutral: ["what?", "what do you need"], angry: ["no", "figure it out yourself"] },
  },
  question: {
    trusted:  { happy: ["good question!", "hmm I think so?", "oh yeah definitely"], neutral: ["hmm", "good question", "not sure actually", "let me think"], angry: ["idk look it up", "how should I know"] },
    neutral:  { happy: ["hmm let me think", "good question"], neutral: ["hmm", "not sure", "maybe?", "idk", "good question"], angry: ["idk", "google it"] },
    distrust: { happy: ["um I think so?", "...maybe"], neutral: ["idk", "not sure", "maybe"], angry: ["how should I know", "figure it out"] },
  },
  threat: {
    trusted:  { happy: ["lol you wouldn't", "try me"], neutral: ["whoa calm down", "let's not do that"], angry: ["you want war? you got it", "bring it"] },
    neutral:  { happy: ["ok tough guy", "sure buddy"], neutral: ["back off", "don't try me", "let's keep it civil"], angry: ["you want problems? you got em", "say that again"] },
    distrust: { happy: ["try it", "sure buddy"], neutral: ["stay away from me", "don't test me"], angry: ["you're done", "stay away"] },
  },
  trade_offer: {
    trusted:  { happy: ["sure! what you got?", "let's trade!", "deal! what are we swapping?"], neutral: ["what's your offer?", "depends what you got", "maybe, what do you have?"], angry: ["not interested", "no trades right now"] },
    neutral:  { happy: ["sure what you got?", "maybe! what's the deal?"], neutral: ["what's the offer?", "depends", "maybe"], angry: ["not right now", "pass"] },
    distrust: { happy: ["...what's the catch?", "sure I guess"], neutral: ["what do you want?", "maybe"], angry: ["no thanks", "not interested"] },
  },
  accusation: {
    trusted:  { happy: ["what?? no way!", "bro I would never!", "you're joking right?"], neutral: ["I didn't do that", "that wasn't me", "what are you talking about?"], angry: ["how dare you!", "prove it", "I didn't steal anything!"] },
    neutral:  { happy: ["wait what? no!", "I didn't do that"], neutral: ["wasn't me", "I didn't steal anything", "that's not true"], angry: ["prove it or shut up", "don't accuse me", "I did NOT"] },
    distrust: { happy: ["what? no...", "that's crazy"], neutral: ["prove it", "wasn't me", "I don't know what you're talking about"], angry: ["you got no proof", "shut up", "I didn't do anything"] },
  },
  gossip: {
    trusted:  { happy: ["omg really?!", "no way tell me more!", "spill the tea!"], neutral: ["hmm interesting", "oh really?", "is that so?"], angry: ["who said that?", "don't believe everything you hear"] },
    neutral:  { happy: ["oh really?", "no way!", "interesting..."], neutral: ["hmm", "oh?", "is that so?"], angry: ["whatever", "don't care"] },
    distrust: { happy: ["oh?", "...really"], neutral: ["hmm", "ok"], angry: ["don't care", "whatever"] },
  },
  location: {
    trusted:  { happy: ["come find me! I'm near the river", "follow the torches!", "head to the big oak"], neutral: ["I'm around", "not too far from base", "exploring nearby"], angry: ["none of your business", "why do you want to know?"] },
    neutral:  { happy: ["I'm around somewhere", "near the forest"], neutral: ["exploring", "around", "not sure where exactly"], angry: ["why?", "none of your business"] },
    distrust: { happy: ["um... somewhere safe", "haha good question"], neutral: ["not telling", "around", "why do you ask?"], angry: ["NONE of your business", "you'll never find me"] },
  },
  status: {
    trusted:  { happy: ["great! been productive today", "doing good, just found iron!", "living the dream"], neutral: ["hanging in there", "not bad", "surviving"], angry: ["could be better", "not great honestly", "ugh long day"] },
    neutral:  { happy: ["doing good!", "can't complain", "pretty good"], neutral: ["alright", "not bad", "hanging in there"], angry: ["not great", "been better", "could be worse"] },
    distrust: { happy: ["fine", "ok"], neutral: ["alright", "fine", "why?"], angry: ["none of your business", "why do you care"] },
  },
  agreement: {
    trusted:  { happy: ["let's do it!", "I'm in!", "count me in!", "let's go!"], neutral: ["sure", "ok", "sounds like a plan"], angry: ["...fine", "sure whatever"] },
    neutral:  { happy: ["sure let's go!", "I'm in!", "count me in!"], neutral: ["sure", "ok", "maybe"], angry: ["...I guess", "fine"] },
    distrust: { happy: ["...sure I guess", "ok"], neutral: ["maybe", "depends"], angry: ["no", "not happening"] },
  },
  emote: {
    trusted:  { happy: ["haha yeah", "lol", "bruh", "based"], neutral: ["lol", "haha", "bruh", "oof"], angry: ["bruh", "ugh", "oof"] },
    neutral:  { happy: ["lol", "haha", "nice"], neutral: ["lol", "haha", "oof", "bruh"], angry: ["ugh", "bruh"] },
    distrust: { happy: ["heh", "lol"], neutral: ["hm", "ok", "lol"], angry: ["ugh", "..."] },
  },
  refusal: {
    trusted:  { happy: ["no way jose", "hard pass", "not happening"], neutral: ["nah", "nope", "not happening"], angry: ["ABSOLUTELY NOT", "over my dead body", "NEVER"] },
    neutral:  { happy: ["no way", "hard pass"], neutral: ["nah", "nope", "pass", "not happening"], angry: ["NO", "forget it", "not a chance"] },
    distrust: { happy: ["nah", "no way"], neutral: ["no", "pass", "not happening"], angry: ["absolutely NOT", "over my dead body"] },
  },
};

const CATCH_ALL = {
  trusted: { happy: ["hm let me think about that", "interesting...", "oh?", "tell me more"], neutral: ["hm", "oh", "interesting", "ok", "I see"], angry: ["hm.", "ok.", "...whatever"] },
  neutral: { happy: ["hm?", "oh interesting", "huh"], neutral: ["hm", "ok", "oh", "...", "I see"], angry: ["hm", "ok", "..."] },
  distrust: { happy: ["hm?", "...ok", "interesting"], neutral: ["hm", "ok", "...", "what"], angry: ["...", "hm", "ok"] },
};

const ECHO_HISTORY = new Map();
const ECHO_WINDOW = 6;
const GLOBAL_ECHO = [];
const GLOBAL_ECHO_WINDOW = 14;

function _recentHeard(agentId) {
  if (!ECHO_HISTORY.has(agentId)) ECHO_HISTORY.set(agentId, []);
  return ECHO_HISTORY.get(agentId);
}

function recordHeard(agentId, message) {
  if (!agentId || !message) return;
  const ring = _recentHeard(agentId);
  ring.push(message.toLowerCase().slice(0, 80));
  if (ring.length > ECHO_WINDOW) ring.shift();
}

function _recordGlobalEcho(response) {
  GLOBAL_ECHO.push(response.toLowerCase().slice(0, 80));
  if (GLOBAL_ECHO.length > GLOBAL_ECHO_WINDOW) GLOBAL_ECHO.shift();
}

function _isEcho(agentId, response) {
  if (!response) return false;
  const lower = response.toLowerCase();
  const heard = agentId ? _recentHeard(agentId) : [];
  if (heard.some(h => lower.includes(h) || h.includes(lower))) return true;
  if (GLOBAL_ECHO.some(h => lower.includes(h) || h.includes(lower))) return true;
  return false;
}

function classifyIntent(message) {
  if (!message || typeof message !== 'string') return 'status';
  const trimmed = message.trim();
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.test(trimmed)) return intent;
  }
  return 'status';
}

function _recentResponses(agentId) {
  if (!ANTI_REPEAT.has(agentId)) ANTI_REPEAT.set(agentId, []);
  return ANTI_REPEAT.get(agentId);
}

function _recordResponse(agentId, response) {
  const ring = _recentResponses(agentId);
  ring.push(response);
  if (ring.length > ANTI_REPEAT_WINDOW) ring.shift();
  _recordGlobalEcho(response);
}

function pickTemplate(intent, trust, mood, speakerName, agentId) {
  const tier = getTrustTier(trust);
  const bucket = getMoodBucket(mood);
  const pool =
    TEMPLATES[intent]?.[tier]?.[bucket] ||
    TEMPLATES[intent]?.[tier]?.neutral ||
    TEMPLATES[intent]?.neutral?.[bucket] ||
    TEMPLATES[intent]?.neutral?.neutral ||
    CATCH_ALL[tier]?.[bucket] ||
    CATCH_ALL.neutral.neutral;

  const recent = agentId ? _recentResponses(agentId) : [];
  const available = pool.filter(t => {
    const resolved = t.replace(/\{name\}/g, speakerName || 'friend');
    if (recent.includes(resolved)) return false;
    if (agentId && _isEcho(agentId, resolved)) return false;
    return true;
  });

  const pick = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : CATCH_ALL.neutral.neutral[Math.floor(Math.random() * CATCH_ALL.neutral.neutral.length)];

  const result = pick.replace(/\{name\}/g, speakerName || 'friend');
  if (agentId) _recordResponse(agentId, result);
  return result;
}

function validateSLMResponse(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 200) return null;
  if (/\b(I'm in\. See you at for the)\b/.test(trimmed)) return null;
  if (/^[^a-zA-Z0-9'"*([\-_]/.test(trimmed) && trimmed.length < 3) return null;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 30) return null;
  return trimmed;
}

let learned = [];
let _dirty = false;
let _lastSave = 0;

function _loadLearned() {
  try {
    if (fs.existsSync(LEARNED_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LEARNED_FILE, 'utf8'));
      learned = Array.isArray(raw) ? raw : [];
      logger.info('Templates', `Loaded ${learned.length} learned templates`);
    }
  } catch {
    learned = [];
  }
}

function _saveLearned() {
  _dirty = true;
  const now = Date.now();
  if (now - _lastSave < 30000) return;
  _flushLearned();
}

function _flushLearned() {
  if (!_dirty) return;
  try {
    if (learned.length > MAX_LEARNED) _pruneLearned();
    fs.writeFileSync(LEARNED_FILE, JSON.stringify(learned));
    _dirty = false;
    _lastSave = Date.now();
  } catch (err) {
    logger.debug('Templates', `Failed to save: ${err.message}`);
  }
}

setInterval(_flushLearned, 60000);

function _pruneLearned() {
  const now = Date.now();
  for (const e of learned) {
    const age = now - (e.lastUsed || e.created || now);
    const ageDays = age / 86400000;
    e._score = (e.hits || 0) / (1 + ageDays * 0.1);
  }
  learned.sort((a, b) => a._score - b._score);
  while (learned.length > MAX_LEARNED * 0.8) {
    const victim = learned[0];
    if (victim._score <= 0 && learned.length > 50) {
      learned.shift();
    } else break;
  }
  for (const e of learned) delete e._score;

  const seen = new Map();
  learned = learned.filter(e => {
    const key = `${e.intent}|${e.speaker || ''}|${e.response}`;
    const prev = seen.get(key);
    if (prev) {
      prev.hits = Math.max(prev.hits || 0, e.hits || 0);
      prev.lastUsed = Math.max(prev.lastUsed || 0, e.lastUsed || 0);
      return false;
    }
    seen.set(key, e);
    return true;
  });
}

_loadLearned();

function _contextFingerprint(payload) {
  const rel = payload.relationship || {};
  const emo = payload.emotions || {};
  const ctx = payload.civContext || {};
  const inv = ctx.inventory || {};

  const hasIron = (inv.iron_ingot || inv.iron_ore || 0) > 0;
  const hasDiamond = (inv.diamond || inv.diamond_ore || 0) > 0;
  const hasFood = (inv.bread || inv.cooked_beef || inv.apple || 0) > 0;
  const lowHealth = (ctx.health ?? 20) < 10;
  const lowFood = (ctx.food ?? 20) < 10;

  return {
    trust: Math.round((rel.trust ?? 50) / 10) * 10,
    mood: getMoodBucket(emo.mood ?? 0),
    hasIron, hasDiamond, hasFood, lowHealth, lowFood,
    task: (ctx.currentTask || '').slice(0, 20),
  };
}

function _fingerprintSimilarity(a, b) {
  if (a.trust !== b.trust) return false;
  if (a.mood !== b.mood) return false;
  if (a.task && b.task && a.task !== b.task) return false;
  return true;
}

function tryLearnedTemplate(intent, payload) {
  const fp = _contextFingerprint(payload);
  const speaker = (payload.speaker || '').toLowerCase();

  let best = null;
  let bestScore = -1;

  for (const entry of learned) {
    if (entry.intent !== intent) continue;
    if (entry.speaker && entry.speaker !== speaker) continue;
    if (!_fingerprintSimilarity(fp, entry.fp)) continue;

    let score = entry.hits || 0;
    if (entry.speaker === speaker) score += 5;
    if (entry.fp.task && entry.fp.task === fp.task) score += 2;
    const age = Date.now() - (entry.lastUsed || entry.created || 0);
    if (age < 3600000) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (best) {
    best.hits = (best.hits || 0) + 1;
    best.lastUsed = Date.now();
    _saveLearned();
    return best.response;
  }
  return null;
}

function learnTemplate(intent, payload, response) {
  if (!response || !intent) return;

  const validated = validateSLMResponse(response);
  if (!validated) {
    logger.debug('Templates', `Rejected invalid SLM response: "${response.slice(0, 60)}"`);
    return;
  }

  const speaker = (payload.speaker || '').toLowerCase();
  const fp = _contextFingerprint(payload);

  for (const entry of learned) {
    if (entry.intent === intent && entry.response === validated && entry.speaker === speaker) {
      entry.hits = (entry.hits || 0) + 1;
      entry.lastUsed = Date.now();
      _saveLearned();
      return;
    }
  }

  if (learned.length >= MAX_LEARNED) {
    _pruneLearned();
    if (learned.length >= MAX_LEARNED) {
      learned.sort((a, b) => (a.hits || 0) - (b.hits || 0));
      learned.shift();
    }
  }

  learned.push({
    intent, response: validated, speaker, fp,
    hits: 0,
    created: Date.now(),
    lastUsed: Date.now(),
  });
  _saveLearned();
}

function getLearnedStats() {
  return {
    count: learned.length,
    totalHits: learned.reduce((s, e) => s + (e.hits || 0), 0),
    topEntries: [...learned]
      .sort((a, b) => (b.hits || 0) - (a.hits || 0))
      .slice(0, 5)
      .map(e => ({ intent: e.intent, response: e.response.slice(0, 40), hits: e.hits })),
  };
}

function tryTemplate(payload) {
  const message = payload.message || '';
  const speaker = payload.speaker || 'Someone';
  const agentId = payload.agentId || null;
  const trust = payload.relationship?.trust ?? 50;
  const mood = payload.emotions?.mood ?? 0;
  const intent = classifyIntent(message);
  const chatMessage = pickTemplate(intent, trust, mood, speaker, agentId);
  const hasPattern = INTENT_PATTERNS.some(p => p.patterns.test(message));
  const confidence = hasPattern ? 0.9 : 0.5;
  return { chatMessage, confidence, intent };
}

module.exports = {
  tryTemplate, classifyIntent, getTrustTier, getMoodBucket,
  tryLearnedTemplate, learnTemplate, getLearnedStats,
  validateSLMResponse, recordHeard,
};
