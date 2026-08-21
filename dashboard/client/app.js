/**
 * Civilization Control Center — Frontend App
 * Pure vanilla JS, no build step required.
 * Connects to dashboard WebSocket and live-updates all panels.
 */

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  ws: null,
  wsReady: false,
  agents: {},          // keyed by username
  broker: {},
  memoryService: {},
  spectator: {},
  dtreeAgent: 'alpha', // which agent the decision tree shows
  memAgent: 'Agent_Alpha',
  memSection: 'profile',
  chatCount: 0,
  viewerActive: false
};

const AGENT_KEYS = { 'Agent_Alpha': 'alpha', 'Agent_Beta': 'beta' };

// ─── WebSocket ────────────────────────────────────────────────────────────────

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}/ws`);

  state.ws.onopen = () => {
    state.wsReady = true;
    console.log('[WS] Connected');
  };

  state.ws.onmessage = (ev) => {
    try {
      const { type, data } = JSON.parse(ev.data);
      handleMsg(type, data);
    } catch (err) {
      console.error('[WS] Parse error', err);
    }
  };

  state.ws.onclose = () => {
    state.wsReady = false;
    console.warn('[WS] Disconnected — reconnecting in 3s...');
    setTimeout(connectWs, 3000);
  };

  state.ws.onerror = (err) => console.error('[WS] Error', err);
}

function wsSend(type, data) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type, ...data }));
  }
}

// ─── Message Handlers ─────────────────────────────────────────────────────────

function handleMsg(type, data) {
  switch (type) {
    case 'full_state':
      updateServicesPanel(data.broker, data.memoryService);
      if (data.agents) data.agents.forEach(updateAgentCard);
      updateSpectator(data.spectator || {});
      break;

    case 'service_health':
      updateServicesPanel(data.broker, data.memoryService);
      break;

    case 'agents_state':
      data.forEach(updateAgentCard);
      updateDecisionTree();
      break;

    case 'chat_message':
      appendChatMsg(data);
      break;

    case 'chat_history':
      data.messages.forEach(appendChatMsg);
      break;

    case 'spectator_state':
      updateSpectator(data);
      break;

    case 'spectate_ack':
      if (data.ok) activateViewer();
      break;
  }
}

// ─── Service Health Panel ────────────────────────────────────────────────────

function updateServicesPanel(broker, mem) {
  if (broker) {
    state.broker = broker;
    setDot('brokerDot', broker.status);
    setText('brokerMeta', broker.responseMs != null ? `${broker.responseMs}ms` : broker.lastError || '—');
    // LLM provider chips
    const list = document.getElementById('providersList');
    if (list && broker.providers) {
      list.innerHTML = broker.providers.map(p =>
        `<span class="provider-chip">${p}</span>`
      ).join('');
    }
  }
  if (mem) {
    state.memoryService = mem;
    setDot('memDot', mem.status);
    setText('memMeta', mem.responseMs != null ? `${mem.responseMs}ms` : mem.lastError || '—');
  }

  const uptime = broker?.uptime || mem?.uptime || null;
  if (uptime != null) setText('serverUptime', `up ${formatUptime(uptime)}`);
}

function updateSpectator(sp) {
  state.spectator = sp;
  setDot('spectDot', sp.online ? 'ok' : 'error');
  setText('spectMeta', sp.online ? (sp.currentTarget || 'ready') : 'offline');
}

// ─── Agent Cards ──────────────────────────────────────────────────────────────

function updateAgentCard(agent) {
  const key = AGENT_KEYS[agent.username];
  if (!key) return;
  state.agents[agent.username] = agent;

  const action = agent.online && agent.lastDecision?.action ? agent.lastDecision.action : 'OFFLINE';
  const stats = agent.stats || {};
  const pos = agent.position;

  // Action badge
  const badge = document.getElementById(`${key}Badge`);
  if (badge) { badge.className = `action-badge ${action}`; badge.textContent = action; }

  // Position
  setText(`${key}Pos`, pos ? `X ${pos.x}  Y ${pos.y}  Z ${pos.z}` : 'Position: —');

  // Confidence ring (2πr = 100.53 for r=16)
  const conf = agent.lastDecision?.confidence || 0;
  const CIRC = 100.53;
  const offset = CIRC - conf * CIRC;
  setStyle(`${key}RingFill`, 'strokeDashoffset', offset);
  setText(`${key}RingTxt`, `${Math.round(conf * 100)}%`);

  // Stats bars
  if (agent.online) {
    setBar(`${key}HP`,     (stats.health / 20) * 100, `${stats.health || 0}/20`);
    setBar(`${key}Hunger`,  stats.hunger || 0,          `${stats.hunger || 0}%`);
    setBar(`${key}Anger`,   stats.anger  || 0,          `${stats.anger  || 0}%`);
    setBar(`${key}Happy`,   stats.happiness || 0,       `${stats.happiness || 0}%`);
    setBar(`${key}Fatigue`, stats.fatigue || 0,         `${stats.fatigue || 0}%`);
  }

  // Goal
  setText(`${key}Goal`, agent.activeGoal || 'No active goal');

  // Inventory & Equipment
  updateAgentInventory(key, agent);
}

function getItemIcon(name) {
  if (!name) return '📦';
  const n = name.toLowerCase();
  if (n.includes('pickaxe')) return '⛏️';
  if (n.includes('axe')) return '🪓';
  if (n.includes('shovel')) return '🥄';
  if (n.includes('sword')) return '⚔️';
  if (n.includes('bow') || n.includes('crossbow')) return '🏹';
  if (n.includes('shield')) return '🛡️';
  if (n.includes('helmet') || n.includes('cap')) return '🪖';
  if (n.includes('chestplate') || n.includes('tunic')) return '🦺';
  if (n.includes('leggings') || n.includes('pants')) return '👖';
  if (n.includes('boots')) return '👢';
  if (n.includes('log') || n.includes('wood') || n.includes('plank')) return '🪵';
  if (n.includes('coal')) return '🪙';
  if (n.includes('iron') || n.includes('gold') || n.includes('diamond')) return '💎';
  if (n.includes('beef') || n.includes('pork') || n.includes('mutton') || n.includes('chicken') || n.includes('bread') || n.includes('apple') || n.includes('stew') || n.includes('potato') || n.includes('carrot')) return '🍖';
  if (n.includes('torch')) return '🔦';
  return '📦';
}

function updateAgentInventory(key, agent) {
  const inv = agent.inventory || [];
  const equip = agent.equipment || {};

  // Update item count badge
  const countEl = document.getElementById(`${key}InvCount`);
  const totalCount = Array.isArray(inv) ? (typeof inv[0] === 'object' ? inv.reduce((s, i) => s + (i.count || 1), 0) : inv.length) : 0;
  if (countEl) countEl.textContent = `${totalCount} item${totalCount === 1 ? '' : 's'}`;

  // Update Equipment Row
  const equipEl = document.getElementById(`${key}Equip`);
  if (equipEl) {
    const main = equip.mainHand ? `<span class="equip-chip active" title="Main Hand">⚔️ ${equip.mainHand}</span>` : `<span class="equip-chip">⚔️ empty</span>`;
    const off = equip.offHand ? `<span class="equip-chip active" title="Off Hand">🛡️ ${equip.offHand}</span>` : '';
    const armor = [equip.helmet, equip.chestplate, equip.leggings, equip.boots].filter(Boolean);
    const armorHtml = armor.length > 0 ? `<span class="equip-chip active" title="Armor">🪖 ${armor.join(', ')}</span>` : '';
    equipEl.innerHTML = main + off + armorHtml;
  }

  // Update Inventory Grid
  const invEl = document.getElementById(`${key}Inv`);
  if (invEl) {
    if (!inv || inv.length === 0) {
      invEl.innerHTML = `<div class="inv-empty">Inventory empty</div>`;
      return;
    }
    invEl.innerHTML = inv.map(item => {
      if (typeof item === 'string') {
        const parts = item.split(' x');
        const name = parts[0];
        const count = parts[1] || '1';
        return `<span class="inv-item" title="${name}">${getItemIcon(name)} ${name} <span class="count">×${count}</span></span>`;
      }
      const name = item.displayName || item.name;
      return `<span class="inv-item" title="${item.name}">${getItemIcon(item.name)} ${name} <span class="count">×${item.count}</span></span>`;
    }).join('');
  }
}

// ─── Decision Tree ────────────────────────────────────────────────────────────

function setDtreeAgent(agentKey) {
  state.dtreeAgent = agentKey;
  document.getElementById('dtreeTabAlpha').className = `dtree-tab alpha${agentKey === 'alpha' ? ' active' : ''}`;
  document.getElementById('dtreeTabBeta').className  = `dtree-tab beta${agentKey === 'beta'  ? ' active' : ''}`;
  updateDecisionTree();
}

function updateDecisionTree() {
  const username = state.dtreeAgent === 'alpha' ? 'Agent_Alpha' : 'Agent_Beta';
  const agent = state.agents[username];
  const container = document.getElementById('dtreeContent');
  if (!container) return;

  if (!agent?.lastDecision) {
    container.innerHTML = `<div style="padding:10px 14px;color:var(--text-dim);font-size:11px;">No decision data yet...</div>`;
    return;
  }

  const { action, confidence, escalated, allCandidates } = agent.lastDecision;
  const candidates = allCandidates || [{ name: action, confidence, reason: '' }];

  let html = candidates
    .sort((a, b) => b.confidence - a.confidence)
    .map(c => {
      const isWinner = c.name === action;
      const pct = Math.round(c.confidence * 100);
      return `
        <div class="dtree-row${isWinner ? ' winner' : ''}">
          <span class="dtree-rule">${c.name}</span>
          <div class="dtree-bar-bg"><div class="dtree-bar-fill${isWinner ? ' winner' : ''}" style="width:${pct}%"></div></div>
          <span class="dtree-conf">${c.confidence.toFixed(2)}</span>
        </div>`;
    }).join('');

  if (escalated) {
    html += `<div class="escalated-badge">🧠 ESCALATED → LLM<span style="margin-left:auto;font-family:var(--mono)">${action}</span></div>`;
  }

  container.innerHTML = html;
}

// ─── Memory Viewer ────────────────────────────────────────────────────────────

function setMemAgent(name) {
  state.memAgent = `Agent_${name}`;
  const key = name.toLowerCase();
  document.getElementById('memBtnAlpha').className = `mem-agent-btn${key === 'alpha' ? ' active alpha' : ''}`;
  document.getElementById('memBtnBeta').className  = `mem-agent-btn${key === 'beta'  ? ' active beta'  : ''}`;
  loadMemSection();
}

function setMemSection(section) {
  state.memSection = section;
  document.querySelectorAll('.mem-tab').forEach(t => t.classList.remove('active'));
  const tabs = ['profile', 'relationships', 'events', 'skills', 'recent'];
  const idx = tabs.indexOf(section);
  if (idx >= 0) document.querySelectorAll('.mem-tab')[idx]?.classList.add('active');
  loadMemSection();
}

async function loadMemSection() {
  const content = document.getElementById('memContent');
  if (!content) return;
  content.innerHTML = `<div class="shimmer" style="height:14px;border-radius:3px;margin-bottom:8px;"></div>`.repeat(6);

  try {
    const url = `/api/dashboard/memory/sections/${encodeURIComponent(state.memAgent)}/${state.memSection}`;
    const res = await fetch(url);
    const data = await res.json();
    renderMemContent(data.content || '');
  } catch (err) {
    content.innerHTML = `<div class="mem-empty">Failed to load: ${err.message}</div>`;
  }
}

function renderMemContent(raw) {
  const content = document.getElementById('memContent');
  if (!content) return;
  const lines = raw.split('\n').filter(l => l.trim().startsWith('-'));
  if (lines.length === 0) {
    content.innerHTML = `<div class="mem-empty">No entries in this section yet.</div>`;
    return;
  }
  content.innerHTML = lines.map(l => {
    const text = l.replace(/^-\s*/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return `<div class="entry"><span class="bullet">▸</span><span>${text}</span></div>`;
  }).join('');
}

// ─── Civilization Ledger ──────────────────────────────────────────────────────

async function loadLedger() {
  try {
    const res = await fetch('/api/dashboard/ledger');
    const data = await res.json();
    renderLedgerSection('ledgerCurrencies', data.currencies || [], 'currency');
    renderLedgerSection('ledgerSettlements', data.settlements || [], 'settlement');
    renderLedgerSection('ledgerFactions', data.factions || [], 'faction');
  } catch (err) {
    console.warn('[Ledger] Failed to load:', err.message);
  }
}

function renderLedgerSection(elId, items, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!items.length) { el.innerHTML = `<div class="ledger-empty">None yet</div>`; return; }
  el.innerHTML = items.map(item => `
    <div class="ledger-row">
      <span class="ledger-name">${item.name}</span>
      <span class="ledger-by">by ${item.establishedBy || item.claimedBy || item.founder || '?'}</span>
    </div>`).join('');
}

// ─── Live Chat ────────────────────────────────────────────────────────────────

function appendChatMsg(msg) {
  const log = document.getElementById('chatLog');
  if (!log) return;
  const ts = new Date(msg.timestamp || Date.now()).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
  const userClass = msg.source === 'operator' ? 'operator'
    : (msg.username || '').includes('Alpha') ? 'alpha'
    : (msg.username || '').includes('Beta')  ? 'beta'
    : 'server';

  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-ts">${ts}</span><span class="chat-user ${userClass}">${msg.username || 'Server'}</span><span class="chat-text">${escHtml(msg.message || '')}</span>`;
  log.appendChild(div);

  // Auto-scroll to bottom
  log.scrollTop = log.scrollHeight;

  // Limit DOM nodes
  while (log.children.length > 100) log.removeChild(log.firstChild);

  state.chatCount++;
  setText('chatCount', `${state.chatCount} messages`);
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';

  try {
    await fetch('/api/dashboard/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
  } catch (err) {
    console.error('[Chat] Send failed:', err.message);
  }
}

// ─── Spectator Bot ────────────────────────────────────────────────────────────

window.spectateAgent = function(agentId) {
  wsSend('spectate_agent', { agentId });
  activateViewer();
};

function activateViewer() {
  const overlay = document.getElementById('viewerOverlay');
  const frame = document.getElementById('worldFrame');
  if (overlay) overlay.classList.add('hidden');
  if (frame) {
    if (!frame.src || frame.src === 'about:blank' || frame.src === location.href) {
      frame.src = '/viewer/';
    }
  }
  state.viewerActive = true;
}

// ─── Exposed globals for HTML onclick ────────────────────────────────────────

window.setDtreeAgent = setDtreeAgent;
window.setMemAgent = setMemAgent;
window.setMemSection = setMemSection;
window.sendChat = sendChat;

// ─── Utility Helpers ─────────────────────────────────────────────────────────

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setStyle(id, prop, val) {
  const el = document.getElementById(id);
  if (el) el.style[prop] = val;
}

function setDot(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `dot ${status === 'ok' ? 'ok' : status === 'error' ? 'error' : 'unknown'}`;
}

function setBar(id, pct, label) {
  const fill = document.getElementById(id);
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const val = document.getElementById(`${id}v`);
  if (val) val.textContent = label;
}

function formatUptime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Init ────────────────────────────────────────────────────────────────────

// Enter sends chat
document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

// Load ledger on startup and every 30s
loadLedger();
setInterval(loadLedger, 30000);

// Load initial memory section
loadMemSection();

// Connect WebSocket
connectWs();

console.log('%c⬡ Civilization Control Center', 'color:#00d4ff;font-size:18px;font-weight:bold;');
console.log('%cConnecting to live agent telemetry...', 'color:#666;');
