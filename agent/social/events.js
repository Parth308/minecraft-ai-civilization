const logger = require('../../shared/logger');

// Event types that agents can propose through dialogue
const EVENT_TYPES = {
  GATHERING: 'gathering',     // General meetup for socializing
  FEAST: 'feast',             // Share food together
  BUILD: 'build',             // Cooperative construction project
  DEFEND: 'defend',           // Defense rally against threats
  TRADE: 'trade',             // Organized trading event
  CEREMONY: 'ceremony',       // Mark a milestone
  MEETING: 'meeting'          // Discuss matters of concern
};

// How close agents need to be to "attend" an event (blocks)
const ATTENDANCE_RADIUS = 16;

// Events expire after this long (ms) — 30 Minecraft minutes = 600 real seconds
const EVENT_DURATION_MS = 30 * 60 * 1000;

// Cooldown: don't propose events too often (5 real minutes)
const PROPOSAL_COOLDOWN_MS = 5 * 60 * 1000;

class SocialEvents {
  constructor(agentId, societyClient, relationships, bot) {
    this.agentId = agentId;
    this.society = societyClient;
    this.relationships = relationships;
    this.bot = bot;
    this.lastProposalTime = 0;
    this.attending = null; // currently attending event ID
  }

  // ── Parse event proposals from chat messages ─────────────────────────
  // Returns proposal object or null if message isn't a gathering proposal
  parseProposal(message, speaker) {
    if (!message || !speaker) return null;
    if (speaker.toLowerCase() === this.agentId.toLowerCase()) return null;

    const lower = message.toLowerCase();

    // Patterns that indicate event proposals
    const proposalPatterns = [
      /(?:let'?s|we should|everyone|all of us|join me)\s+(?:meet|gather|come|go|head|assemble|get together)/i,
      /(?:meet|gather|come|assemble)\s+(?:at|near|by|in|around)\s+/i,
      /(?:feast|celebrate|party|eat together|share food)/i,
      /(?:build|construct|make)\s+(?:something|a |together|as a group)/i,
      /(?:defend|protect|guard|rally)\s+(?:against|the |our|from)/i,
      /(?:trade|exchange|barter|swap)\s+(?:with|goods|items|stuff)/i,
      /(?:meeting|discuss|talk about|decide|vote on)/i,
      /(?:ceremony|ritual|memorial|honor|纪念|庆祝)/i
    ];

    const isProposal = proposalPatterns.some(p => p.test(lower));
    if (!isProposal) return null;

    // Try to extract location from message
    const locationPatterns = [
      /(?:at|near|by|in|around)\s+(?:the\s+)?([A-Za-z_]+(?:\s+[A-Za-z_]+)?)/i,
      /(?:my|your|their)\s+(base|house|home|shelter|camp|village|town|spot)/i,
      /coordinates?\s*[:=]?\s*(-?\d+)\s*[,;]\s*(-?\d+)/i
    ];

    let location = null;
    let coords = null;

    for (const pattern of locationPatterns) {
      const match = message.match(pattern);
      if (match) {
        if (match[1] && isNaN(match[1])) {
          location = match[1].trim();
        } else if (match[1] && match[2]) {
          coords = { x: parseInt(match[1], 10), z: parseInt(match[2], 10) };
        }
        break;
      }
    }

    // Determine event type from keywords
    let eventType = EVENT_TYPES.GATHERING;
    if (/feast|celebrate|party|eat|food/i.test(lower)) eventType = EVENT_TYPES.FEAST;
    else if (/build|construct|make|craft/i.test(lower)) eventType = EVENT_TYPES.BUILD;
    else if (/defend|protect|guard|rally|threat|attack/i.test(lower)) eventType = EVENT_TYPES.DEFEND;
    else if (/trade|exchange|barter|swap|sell|buy/i.test(lower)) eventType = EVENT_TYPES.TRADE;
    else if (/meeting|discuss|talk|decide|vote|plan/i.test(lower)) eventType = EVENT_TYPES.MEETING;
    else if (/ceremony|ritual|memorial|honor|celebrate/i.test(lower)) eventType = EVENT_TYPES.CEREMONY;

    // Extract purpose from message
    const purpose = message.slice(0, 120);

    return {
      proposer: speaker,
      type: eventType,
      purpose,
      location: location || 'current area',
      coords,
      proposedAt: new Date().toISOString(),
      rsvps: { [speaker]: true }, // proposer auto-attends
      attendees: [],
      status: 'proposed'
    };
  }

  // ── Decide whether to attend an event ────────────────────────────────
  // Uses relationship data and persona to make decision
  async decideAttendance(proposal) {
    // Cooldown check — don't attend events too frequently
    const recentAttend = await this.society.getActiveEvents().catch(() => []);
    if (recentAttend.length > 2) return { attend: false, reason: 'Too many active events' };

    // Factor in relationship with proposer
    const rel = this.relationships?.get?.(proposal.proposer) || {};
    const trust = rel.trust || 50;
    const affinity = rel.affinity || 50;

    // Higher trust/affinity → more likely to attend
    const socialScore = (trust + affinity) / 2;

    // Risk assessment: defense events are riskier, feasts are safer
    const riskMap = {
      [EVENT_TYPES.GATHERING]: 0.1,
      [EVENT_TYPES.FEAST]: 0.05,
      [EVENT_TYPES.BUILD]: 0.15,
      [EVENT_TYPES.DEFEND]: 0.4,
      [EVENT_TYPES.TRADE]: 0.1,
      [EVENT_TYPES.MEETING]: 0.1,
      [EVENT_TYPES.CEREMONY]: 0.05
    };
    const risk = riskMap[proposal.type] || 0.1;

    // Decision threshold: social score must exceed risk + base threshold
    const threshold = 0.3 + risk;
    const attend = (socialScore / 100) > threshold;

    // Build response message
    const responses = {
      accept: [
        `I'll be there!`,
        `Count me in for the ${proposal.type}.`,
        `Sounds good, I'll join.`,
        `On my way!`,
        `I'm in. See you at ${proposal.location}.`
      ],
      decline: [
        `Can't make it right now, sorry.`,
        `I'm busy with something else.`,
        `Maybe another time.`,
        `Not today, but good luck.`,
        `I'll sit this one out.`
      ]
    };

    const pool = attend ? responses.accept : responses.decline;
    const response = pool[Math.floor(Math.random() * pool.length)];

    return {
      attend,
      reason: attend ? `Trust ${trust}, affinity ${affinity}` : `Risk ${risk} too high for social score ${socialScore}`,
      message: response
    };
  }

  // ── Check if agent is within attendance range ────────────────────────
  checkAttendanceRange(event) {
    if (!this.bot?.entity?.position) return false;
    if (!event.coords) return false;

    const pos = this.bot.entity.position;
    const dx = pos.x - event.coords.x;
    const dz = pos.z - event.coords.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    return distance <= ATTENDANCE_RADIUS;
  }

  // ── Generate event proposal message for chat ─────────────────────────
  generateProposalMessage(proposal) {
    const typeMessages = {
      [EVENT_TYPES.GATHERING]: [
        `Everyone, let's gather at ${proposal.location}! ${proposal.purpose}`,
        `Meeting at ${proposal.location} — who's in? ${proposal.purpose}`,
        `Let's all meet up at ${proposal.location}. ${proposal.purpose}`
      ],
      [EVENT_TYPES.FEAST]: [
        `Feast time at ${proposal.location}! Bring food, let's eat together!`,
        `Let's have a feast at ${proposal.location}! Everyone bring something to share.`,
        `Food and company at ${proposal.location} — join me for a feast!`
      ],
      [EVENT_TYPES.BUILD]: [
        `Building project at ${proposal.location}! Let's construct something together.`,
        `Who wants to help build at ${proposal.location}? Teamwork makes it faster.`,
        `Construction time at ${proposal.location} — come lend a hand!`
      ],
      [EVENT_TYPES.DEFEND]: [
        `Defense rally at ${proposal.location}! We need to protect our area.`,
        `Rally at ${proposal.location} — potential threat spotted. Everyone ready!`,
        `Let's defend ${proposal.location} together. Bring your best gear.`
      ],
      [EVENT_TYPES.TRADE]: [
        `Trade fair at ${proposal.location}! Bring your goods, let's交换.`,
        `Trading meet at ${proposal.location} — who has what to offer?`,
        `Market day at ${proposal.location}! Let's exchange goods and services.`
      ],
      [EVENT_TYPES.MEETING]: [
        `Important meeting at ${proposal.location}. We need to discuss ${proposal.purpose}`,
        `Let's meet at ${proposal.location} to talk things over.`,
        `Gathering at ${proposal.location} for a discussion. All welcome.`
      ],
      [EVENT_TYPES.CEREMONY]: [
        `Ceremony at ${proposal.location}! Let's mark this occasion together.`,
        `Time for a ceremony at ${proposal.location}. Please join us.`,
        `We're holding a ceremony at ${proposal.location}. Your presence would mean a lot.`
      ]
    };

    const messages = typeMessages[proposal.type] || typeMessages[EVENT_TYPES.GATHERING];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  // ── Generate attendance response message ─────────────────────────────
  generateAttendanceMessage(proposal, attending) {
    const yesResponses = [
      `I'll be there! See you at ${proposal.location}.`,
      `Count me in!`,
      `On my way to ${proposal.location}.`,
      `I'm joining the ${proposal.type}.`,
      `Good idea, I'm in.`
    ];

    const noResponses = [
      `Sorry, can't make it this time.`,
      `I'm busy, maybe next time.`,
      `I'll sit this one out.`,
      `Not today, but have fun!`,
      `Can't join, good luck though.`
    ];

    const pool = attending ? yesResponses : noResponses;
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

module.exports = SocialEvents;
module.exports.EVENT_TYPES = EVENT_TYPES;
module.exports.ATTENDANCE_RADIUS = ATTENDANCE_RADIUS;
module.exports.EVENT_DURATION_MS = EVENT_DURATION_MS;
