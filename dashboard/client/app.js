/* Control Tower — vanilla JS dashboard.
   Data via WebSocket events: full_state, agents_state, service_health,
   broker_stats, chat_history, chat_message. */

(() => {
  'use strict';

  const state = {
    page: 'overview',
    agents: [],
    broker: null,
    memoryService: null,
    brokerStats: null,
    spectator: null,
    spectateTarget: null,
    chat: [],
    wsOnline: false
  };

  const root = document.getElementById('page-root');

  // ── Formatting helpers ────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtInt = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const fmtCost = usd => {
    if (usd == null) return '—';
    if (usd === 0) return '$0.00';
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    if (usd < 1000) return `$${usd.toFixed(2)}`;
    return `$${(usd / 1000).toFixed(1)}k`;
  };
  const fmtMs = ms => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
  const timeOf = iso => {
    try { return new Date(iso).toLocaleTimeString('en-US', { hour12: false }); } catch { return ''; }
  };
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

  function sourceBadge(ev) {
    if (ev.source === 'llm') {
      const p = ev.provider ? `<span class="badge badge-llm">${esc(ev.provider)}</span>` : '<span class="badge badge-llm">LLM</span>';
      return p;
    }
    if (ev.source === 'cache') return `<span class="badge badge-cache">CACHE·${esc((ev.cacheType || '').toUpperCase())}</span>`;
    if (ev.source === 'fallback') return '<span class="badge badge-fallback">SAFETY</span>';
    return '<span class="badge badge-tree">TREE</span>';
  }

  const SOURCE_LABEL = { tree: 'Tree', llm: 'LLM', cache: 'Cache', fallback: 'Fallback' };

  // ── Derived metrics ───────────────────────────────────────────────
  function decisionSplit() {
    const counts = { tree: 0, llm: 0, cache: 0, fallback: 0 };
    for (const a of state.agents) {
      for (const d of a.recentDecisions || []) {
        const k = d.source in counts ? d.source : 'tree';
        counts[k] += 1;
      }
    }
    return counts;
  }

  function onlineAgents() { return state.agents.filter(a => a.online); }

  // ── Render dispatch ───────────────────────────────────────────────
  let draftChat = '';

  function scrollChat() {
    const feed = document.getElementById('chat-feed');
    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
  }

  function render() {
    const input = document.getElementById('chat-input');
    const wasFocused = input && document.activeElement === input;
    if (input) draftChat = input.value;

    const fn = {
      overview: renderOverview,
      world: renderWorld,
      agents: renderAgents,
      decisions: renderDecisions,
      costs: renderCosts
    }[state.page];
    const html = fn ? fn() : '';
    if (html !== null) {
      root.innerHTML = html;
    }

    if (state.page === 'overview' || state.page === 'world') {
      const newInput = document.getElementById('chat-input');
      if (newInput) {
        if (draftChat) newInput.value = draftChat;
        if (wasFocused) newInput.focus();
      }
      scrollChat();
    }
  }

  function setPage(page) {
    state.page = page;
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.setAttribute('aria-current', btn.dataset.page === page ? 'page' : 'false');
    });
    render();
  }

  // ── Page: Overview ────────────────────────────────────────────────
  function renderOverview() {
    const s = state.brokerStats;
    const t = s?.totals || {};
    const split = decisionSplit();
    const total = Object.values(split).reduce((x, y) => x + y, 0);
    const rlHits = Object.values(s?.rateLimits?.providers || {}).reduce((x, p) => x + p.totalHits, 0);
    const blocked = Object.values(s?.rateLimits?.providers || {}).filter(p => p.blocked).length;

    return `
      <div class="page-header">
        <div class="page-title">Overview</div>
        <div class="page-desc">Live civilization telemetry</div>
      </div>

      <div class="grid-kpi">
        <div class="card">
          <div class="kpi-label">Agents Online</div>
          <div class="kpi-value green">${onlineAgents().length}<span style="font-size:15px;color:var(--text-faint)">/${state.agents.length}</span></div>
        </div>
        <div class="card">
          <div class="kpi-label">Local Tree Share</div>
          <div class="kpi-value">${pct(split.tree, total)}%</div>
          <div class="kpi-sub">${fmtInt(split.tree)} of ${fmtInt(total)} recent decisions · $0 cost</div>
        </div>
        <div class="card">
          <div class="kpi-label">LLM Escalations</div>
          <div class="kpi-value amber">${fmtInt(t.calls ?? '—')}</div>
          <div class="kpi-sub">${fmtInt(s?.caches?.exactHits || 0)} exact + ${fmtInt(s?.caches?.semanticHits || 0)} semantic cache hits</div>
        </div>
        <div class="card">
          <div class="kpi-label">Spend (Free Tier)</div>
          <div class="kpi-value green">$0.00</div>
          <div class="kpi-sub">${s?.freeTierMode ? `100% Free Tier · ${fmtCost(t.savedUsd)} saved` : `${fmtCost(t.costUsd)} spend`}</div>
        </div>
        <div class="card" style="cursor:pointer" onclick="window.spectateAgent('${esc(state.agents[0]?.username || 'Agent_Alpha')}')">
          <div class="kpi-label">3D World View</div>
          <div class="kpi-value" style="font-size:20px;display:flex;align-items:center;gap:6px">
            <span class="status-pill ${state.spectator?.online ? 'ok' : 'err'}"></span>
            <span style="color:var(--text)">${state.spectator?.online ? 'Live Stream' : 'Standby'}</span>
          </div>
          <div class="kpi-sub" style="color:var(--green)">Click to watch 3D feed →</div>
        </div>
      </div>

      <div class="section-title">Decision Source Split (recent window)</div>
      <div class="card" style="margin-bottom:20px">
        <div class="bar-track" style="height:10px;display:flex;border-radius:99px;background:var(--surface-3);overflow:hidden">
          ${total > 0 ? `
            <span style="width:${pct(split.tree, total)}%;background:var(--green)" title="Tree ${split.tree}"></span>
            <span style="width:${pct(split.llm, total)}%;background:var(--amber)" title="LLM ${split.llm}"></span>
            <span style="width:${pct(split.cache, total)}%;background:var(--lime)" title="Cache ${split.cache}"></span>
            <span style="width:${pct(split.fallback, total)}%;background:var(--red)" title="Fallback ${split.fallback}"></span>
          ` : ''}
        </div>
        <div class="stat-strip">
          <span><span class="badge badge-tree">Tree</span> <b>${split.tree}</b></span>
          <span><span class="badge badge-llm">LLM</span> <b>${split.llm}</b></span>
          <span><span class="badge badge-cache">Cache</span> <b>${split.cache}</b></span>
          <span><span class="badge badge-fallback">Fallback</span> <b>${split.fallback}</b></span>
        </div>
      </div>

      <div class="grid-2">
        <div>
          <div class="section-title" style="margin-top:0">Recent Escalations</div>
          <div class="card" style="padding:6px 4px">${escalationsTable((s?.recentEscalations || []).slice(-8).reverse(), true)}</div>
        </div>
        <div>
          <div class="section-title" style="margin-top:0">Global Chat</div>
          <div class="card" style="display:flex;flex-direction:column;gap:10px">
            <div class="chat-feed" id="chat-feed" role="log">${chatFeed(state.chat.slice(-40))}</div>
            <form class="chat-input-row" id="chat-form" onsubmit="return false;">
              <input class="chat-input" id="chat-input" type="text" placeholder="Send as [Operator]..." maxlength="256" autocomplete="off" />
              <button class="btn btn-send" id="chat-send-btn" type="button">Send</button>
            </form>
            <div style="display:flex;gap:5px;flex-wrap:wrap;font-size:11px;align-items:center">
              <span style="color:var(--text-faint)">⚡ Quick God-Mode:</span>
              <span class="inv-chip" style="cursor:pointer" onclick="window.insertChatCommand('!status')">!status</span>
              <span class="inv-chip" style="cursor:pointer" onclick="window.insertChatCommand('!come')">!come</span>
              <span class="inv-chip" style="cursor:pointer" onclick="window.insertChatCommand('!memories')">!memories</span>
              <span class="inv-chip" style="cursor:pointer" onclick="window.insertChatCommand('!quest Build a secure wooden shelter')">!quest Build Shelter</span>
              <span class="inv-chip" style="cursor:pointer" onclick="window.insertChatCommand('!quest Mine iron ore and craft armor')">!quest Mine Iron</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── Page: 3D World View & Spectator ───────────────────────────────
  function renderWorld() {
    const spec = state.spectator || {};
    const online = !!spec.online;
    const currentTarget = state.spectateTarget || spec.currentTarget || (state.agents[0]?.username || 'Agent_Alpha');
    const targetAgent = state.agents.find(a => a.username === currentTarget) || state.agents[0] || null;
    const d = targetAgent?.lastDecision;
    const actionName = (d?.action || 'IDLE').toUpperCase();
    const actionIcon = ACTION_ICONS[actionName] || '⚡';
    const posStr = targetAgent?.position ? `${targetAgent.position.x}, ${targetAgent.position.y}, ${targetAgent.position.z}` : '—';

    // If world container and iframe already exist in DOM, perform non-destructive HUD update
    const existingFrame = document.getElementById('world-stream-frame');
    if (existingFrame && state.page === 'world') {
      const overlay = document.getElementById('world-stream-overlay-box');
      if (overlay) {
        overlay.innerHTML = `
          <span class="status-pill ${online ? 'ok' : 'err'}"></span>
          <span>Tracking: <b style="color:var(--green)">${esc(currentTarget)}</b></span>
          <span style="color:var(--text-faint)">|</span>
          <span class="num">${posStr}</span>
        `;
      }
      const telemetryBox = document.getElementById('world-telemetry-content');
      if (telemetryBox && targetAgent) {
        telemetryBox.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px">
            <div class="action-banner">
              <span class="action-icon-pill">${actionIcon} <b class="action-name">${esc(actionName)}</b></span>
              ${d ? sourceBadge(d) : ''}
            </div>
            <div class="stat-strip" style="margin-top:0">
              <span>Biome: <b>${esc(targetAgent.biome || '—')}</b></span>
              <span>Time: <b>${targetAgent.isNight ? '🌙 Night' : '☀️ Day'}</b></span>
            </div>
            <div class="vitals-grid">
              ${statMeter('Health', '❤️', targetAgent.stats?.health ?? 20, 20, (targetAgent.stats?.health ?? 20) <= 6 ? 'red' : 'green')}
              ${statMeter('Hunger', '🍖', targetAgent.stats?.hunger ?? 20, 20, (targetAgent.stats?.hunger ?? 20) <= 6 ? 'red' : 'amber')}
            </div>
            <div class="thought-bubble" style="margin-top:2px">
              <span class="thought-tag">💭 THOUGHT PROCESS</span>
              <div class="thought-content" style="font-size:12px">${esc(d?.reason || 'Navigating world…')}</div>
            </div>
          </div>
        `;
      }
      const chatFeedEl = document.getElementById('world-chat-feed');
      if (chatFeedEl) {
        chatFeedEl.innerHTML = chatFeed(state.chat.slice(-20));
      }
      return null; // Signals render() that in-place DOM update was completed
    }

    return `
      <div class="page-header">
        <div class="page-title">3D World View &amp; Spectator</div>
        <div class="page-desc">Live real-time 3D Prismarine viewport rendered from SpectatorBot in Minecraft</div>
      </div>

      <div class="world-container">
        <!-- Control Toolbar -->
        <div class="world-header-toolbar">
          <div class="spectator-targets-wrap">
            <span style="font-size:12px;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em">Spectate Target:</span>
            ${state.agents.length === 0 ? '<span style="font-size:12px;color:var(--text-faint)">No active agents</span>' : state.agents.map(a => `
              <button class="spectator-target-btn ${a.username === currentTarget ? 'active' : ''}" onclick="window.spectateAgent('${esc(a.username)}')">
                <span class="status-pill ${a.online ? 'ok' : 'err'}"></span>
                <span>▶ ${esc(a.username)}</span>
              </button>
            `).join('')}
          </div>

          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge ${online ? 'badge-online' : 'badge-offline'}">${online ? 'SPECTATOR READY' : 'SPECTATOR CONNECTING'}</span>
            <button class="btn btn-spectate" onclick="window.reloadWorldViewer()">↻ Reload Stream</button>
          </div>
        </div>

        <!-- Main Stream & Live HUD Grid -->
        <div class="world-main-grid">
          <!-- 3D Stream Viewport -->
          <div class="world-stream-card">
            <div class="world-stream-overlay" id="world-stream-overlay-box">
              <span class="status-pill ${online ? 'ok' : 'err'}"></span>
              <span>Tracking: <b style="color:var(--green)">${esc(currentTarget)}</b></span>
              <span style="color:var(--text-faint)">|</span>
              <span class="num">${posStr}</span>
            </div>
            <iframe id="world-stream-frame" src="/viewer/" class="world-iframe" title="Minecraft 3D World View"></iframe>
          </div>

          <!-- Live Agent HUD & Chat Stream -->
          <div class="world-hud-card">
            <div class="subcard-title">Target Telemetry · ${esc(currentTarget)}</div>
            <div id="world-telemetry-content">
              ${targetAgent ? `
                <div style="display:flex;flex-direction:column;gap:8px">
                  <div class="action-banner">
                    <span class="action-icon-pill">${actionIcon} <b class="action-name">${esc(actionName)}</b></span>
                    ${d ? sourceBadge(d) : ''}
                  </div>
                  <div class="stat-strip" style="margin-top:0">
                    <span>Biome: <b>${esc(targetAgent.biome || '—')}</b></span>
                    <span>Time: <b>${targetAgent.isNight ? '🌙 Night' : '☀️ Day'}</b></span>
                  </div>
                  <div class="vitals-grid">
                    ${statMeter('Health', '❤️', targetAgent.stats?.health ?? 20, 20, (targetAgent.stats?.health ?? 20) <= 6 ? 'red' : 'green')}
                    ${statMeter('Hunger', '🍖', targetAgent.stats?.hunger ?? 20, 20, (targetAgent.stats?.hunger ?? 20) <= 6 ? 'red' : 'amber')}
                  </div>
                  <div class="thought-bubble" style="margin-top:2px">
                    <span class="thought-tag">💭 THOUGHT PROCESS</span>
                    <div class="thought-content" style="font-size:12px">${esc(d?.reason || 'Navigating world…')}</div>
                  </div>
                </div>
              ` : '<div class="empty-state">Waiting for target data…</div>'}
            </div>

            <div class="subcard-title" style="margin-top:6px">In-Game Chat &amp; Operator</div>
            <div class="chat-feed" id="world-chat-feed" style="max-height:160px" role="log">${chatFeed(state.chat.slice(-20))}</div>
            <form class="chat-input-row" id="chat-form" onsubmit="return false;">
              <input class="chat-input" id="chat-input" type="text" placeholder="Send as [Operator]..." maxlength="256" autocomplete="off" />
              <button class="btn btn-send" id="chat-send-btn" type="button">Send</button>
            </form>
          </div>
        </div>
      </div>`;
  }

  // ── Page: Agents ──────────────────────────────────────────────────
  const ACTION_ICONS = {
    MINE: '⛏️',
    CRAFT: '⚒️',
    FIGHT: '⚔️',
    EAT: '🍖',
    SLEEP: '🛌',
    EXPLORE: '🧭',
    TALK: '💬',
    CHAT: '💬',
    TRADE: '🤝',
    FLEE: '🏃',
    WANDER: '🚶',
    BUILD: '🧱',
    HARVEST: '🌾',
    EQUIP: '🛡️',
    IDLE: '⏳'
  };

  function formatItemName(name) {
    if (!name) return 'Empty';
    return String(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatArmor(eq = {}) {
    const pieces = [eq.helmet, eq.chestplate, eq.leggings, eq.boots].filter(Boolean);
    if (!pieces.length) return 'None';
    return pieces.map(p => formatItemName(p)).join(', ');
  }

  function renderCandidatesMatrix(candidates = []) {
    if (!Array.isArray(candidates) || candidates.length === 0) return '';
    return `
      <div class="candidates-section">
        <div class="candidates-header">
          <span>Decision Alternatives</span>
          <span>Decision Tree Matrix</span>
        </div>
        <div class="candidates-grid">
          ${candidates.map((c, i) => {
            const isTop = i === 0;
            const confPct = Math.round((c.confidence ?? 0) * 100);
            const icon = ACTION_ICONS[c.name] || '⚡';
            return `
              <div class="candidate-row ${isTop ? 'top-pick' : ''}">
                <div class="candidate-meta">
                  <span class="candidate-name">${icon} ${esc(c.name)}${c.isDynamic ? ' <span class="badge badge-cache" style="font-size:9px;padding:1px 4px">LEARNED</span>' : ''}</span>
                  <span class="num candidate-conf">${confPct}%</span>
                </div>
                <div class="candidate-bar-track">
                  <div class="candidate-bar-fill ${isTop ? 'top' : ''}" style="width:${confPct}%"></div>
                </div>
                ${c.reason ? `<div class="candidate-reason">${esc(c.reason)}</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  function statMeter(label, icon, val, max, colorCls = 'green') {
    const w = Math.max(0, Math.min(100, (val / max) * 100));
    return `
      <div class="stat-row-item">
        <div class="stat-label-box">
          <span>${icon}</span>
          <span>${esc(label)}</span>
        </div>
        <div class="stat-meter">
          <div class="stat-meter-fill ${colorCls}" style="width:${w}%"></div>
        </div>
        <span class="stat-num-val">${Math.round(val)}</span>
      </div>`;
  }

  function renderAgents() {
    return `
      <div class="page-header">
        <div class="page-title">Agents &amp; Cognition</div>
        <div class="page-desc">${onlineAgents().length} online · ${state.agents.length} registered (auto-discovered) · Live decision reasoning &amp; vitals</div>
      </div>
      ${state.agents.length === 0
        ? '<div class="card empty-state">No agents reporting yet…</div>'
        : `<div class="agent-grid">${state.agents.map(agentCard).join('')}</div>`}`;
  }

  function agentCard(a) {
    const st = a.stats || {};
    const d = a.lastDecision;
    const eq = a.equipment || {};
    const inv = Array.isArray(a.inventory) ? a.inventory : [];
    const actionName = (d?.action || 'IDLE').toUpperCase();
    const actionIcon = ACTION_ICONS[actionName] || '⚡';
    const goalStr = typeof a.activeGoal === 'string' ? a.activeGoal : (a.activeGoal?.description || 'Exploring & surviving civilization');
    const posStr = a.position ? `${a.position.x}, ${a.position.y}, ${a.position.z}` : '—';
    const personaObj = (a.persona && typeof a.persona === 'object') ? a.persona : {};
    const personaTitle = personaObj.title || personaObj.seed || (typeof a.persona === 'string' ? a.persona : 'Pioneer');
    const temperament = personaObj.temperament || null;
    const quirk = personaObj.quirk || null;

    return `
      <div class="card agent-card">
        <!-- Header Ribbon -->
        <div class="agent-card-header">
          <div class="agent-title-row">
            <div class="agent-identity">
              <span class="status-pill ${a.online ? 'ok' : 'err'}"></span>
              <span class="agent-name">${esc(a.username)}</span>
              <span class="persona-badge" title="${esc(personaObj.seed || '')}">🧬 ${esc(personaTitle)}</span>
              ${temperament ? `<span class="badge badge-neutral" style="font-size:11px">🎭 ${esc(temperament)}</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <button class="btn-spectate" onclick="window.spectateAgent('${esc(a.username)}')">🎥 Spectate</button>
              <span class="badge ${a.online ? 'badge-online' : 'badge-offline'}">${a.online ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
          </div>

          <div class="agent-meta-ribbon">
            <span class="meta-chip">📍 <b>${posStr}</b></span>
            <span class="meta-chip">🌲 <b>${esc(a.biome || 'Unknown')}</b></span>
            <span class="meta-chip">${a.isNight ? '🌙 Night' : '☀️ Day'}</span>
            ${a.isRaining ? '<span class="meta-chip" style="color:var(--amber)">🌧 Raining</span>' : ''}
            ${a.isInWater ? '<span class="meta-chip" style="color:#38bdf8">🌊 In Water</span>' : ''}
            ${a.isOnFire ? '<span class="meta-chip" style="color:var(--red)">🔥 On Fire</span>' : ''}
            ${quirk ? `<span class="meta-chip" style="color:var(--lime);font-style:italic">✨ ${esc(quirk)}</span>` : ''}
          </div>
        </div>

        <!-- Goal Ribbon -->
        <div class="agent-goal-box">
          <span class="goal-label">🎯 ACTIVE GOAL</span>
          <span class="goal-text">${esc(goalStr)}</span>
        </div>

        <!-- Main Body Grid: Vitals/Gear on Left vs Cognition Hub on Right -->
        <div class="agent-body-grid">
          <!-- Left Column: Vitals & Equipment -->
          <div class="agent-vitals-column">
            <div class="subcard-title">Vitals &amp; Internal State</div>
            <div class="vitals-grid">
              ${statMeter('Health', '❤️', st.health ?? 20, 20, (st.health ?? 20) <= 6 ? 'red' : 'green')}
              ${statMeter('Hunger', '🍖', st.hunger ?? 20, 20, (st.hunger ?? 20) <= 6 ? 'red' : 'amber')}
              ${statMeter('Happiness', '😊', Math.max(0, st.happiness ?? 50), 100, 'lime')}
              ${statMeter('Fatigue', '💤', Math.max(0, st.fatigue ?? 0), 100, (st.fatigue ?? 0) > 70 ? 'red' : 'neutral')}
              ${statMeter('Anger', '😠', Math.max(0, st.anger ?? 0), 100, (st.anger ?? 0) > 50 ? 'red' : 'neutral')}
            </div>

            <div class="subcard-title" style="margin-top:6px">Gear &amp; Inventory</div>
            <div class="equip-strip">
              <span class="equip-slot" title="Main Hand">⚔️ ${esc(formatItemName(eq.mainHand))}</span>
              <span class="equip-slot" title="Armor">🛡️ ${esc(formatArmor(eq))}</span>
              <span class="equip-slot" title="Total Items">🎒 ${inv.length} item${inv.length === 1 ? '' : 's'}</span>
            </div>

            ${inv.length > 0 ? `
              <div class="inv-chips-wrap">
                ${inv.slice(0, 10).map(item => `
                  <span class="inv-chip">${esc(formatItemName(item.name))} <b>×${item.count || 1}</b></span>
                `).join('')}
                ${inv.length > 10 ? `<span class="inv-chip">+${inv.length - 10} more</span>` : ''}
              </div>
            ` : '<div style="font-size:11.5px;color:var(--text-faint);padding:4px 0">Empty inventory</div>'}

            <!-- Live Personality Genome Tuner -->
            <div class="subcard-title" style="margin-top:10px">🧬 Live Personality Genome (Real-Time Tuner)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--bg);padding:8px 10px;border-radius:var(--r-sm);border:1px solid var(--border-soft);font-size:11px">
              ${['curiosity', 'caution', 'greed', 'sociability', 'ambition'].map(t => {
                const tr = a.persona?.traits || {};
                const v = Math.round(((tr[t] ?? 0.5) * 100));
                return `
                  <div>
                    <div style="display:flex;justify-content:space-between;color:var(--text-dim);text-transform:capitalize;margin-bottom:2px">
                      <span>${t}</span>
                      <b style="color:var(--text)">${v}%</b>
                    </div>
                    <input type="range" min="0.05" max="0.95" step="0.05" value="${tr[t] ?? 0.5}"
                      style="width:100%;accent-color:var(--green);cursor:pointer"
                      onchange="window.setAgentTrait('${esc(a.username)}', '${t}', this.value)" />
                  </div>`;
              }).join('')}
            </div>
          </div>

          <!-- Right Column: Cognition Decision Hub -->
          <div class="agent-cognition-column">
            <div class="subcard-title" style="display:flex;justify-content:space-between;align-items:center;">
              <span>🧠 Cognitive Decision Engine</span>
              ${d?.confidence != null ? `<span style="color:var(--text-dim);font-size:11px">Conf: <b class="num" style="color:var(--text)">${Math.round(d.confidence * 100)}%</b></span>` : ''}
            </div>

            <div class="action-banner">
              <div class="action-badge-row">
                <span class="action-icon-pill">${actionIcon} <b class="action-name">${esc(actionName)}</b></span>
                ${d ? sourceBadge(d) : ''}
                ${d?.provider ? `<span class="badge badge-neutral">${esc(d.provider)}${d.model ? ` · ${esc(d.model.split('/').pop())}` : ''}</span>` : ''}
                ${d?.latencyMs ? `<span class="badge badge-neutral">⚡ ${Math.round(d.latencyMs)}ms</span>` : ''}
              </div>
            </div>

            <div class="thought-bubble">
              <div class="thought-header">
                <span class="thought-tag">💭 THOUGHT &amp; REASONING</span>
                ${d?.webKnowledgeUsed ? '<span class="badge badge-cache" style="font-size:10px">🌐 Web Knowledge</span>' : ''}
              </div>
              <div class="thought-content">${esc(d?.reason || 'Evaluating survival parameters and heuristic rules…')}</div>
              ${d?.chatMessage ? `<div class="thought-dialogue">💬 <i>"${esc(d.chatMessage)}"</i></div>` : ''}
              ${d?.tacticLearned ? `<div class="thought-tactic">💡 <b>Learned Tactic:</b> ${esc(d.tacticLearned)}</div>` : ''}
            </div>

            ${renderCandidatesMatrix(d?.allCandidates)}
          </div>
        </div>

        <!-- Recent Activity Trace -->
        ${(a.recentDecisions || []).length > 0 ? `
          <div class="agent-history-box">
            <div class="subcard-title" style="margin-bottom:6px">Recent Decision Trace</div>
            ${a.recentDecisions.slice(-5).reverse().map(x => `
              <div class="agent-history-row">
                <span class="num" style="color:var(--text-faint);width:55px">${timeOf(x.ts)}</span>
                ${sourceBadge(x)}
                <b class="mono" style="color:var(--text);width:85px">${ACTION_ICONS[x.action] || ''} ${esc(x.action)}</b>
                ${x.source === 'llm' && x.provider ? `<span style="color:var(--amber-deep);font-size:11px">${esc(x.provider)}</span>` : ''}
                <span style="color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:11.5px">${esc(x.reason || '')}</span>
              </div>`).join('')}
          </div>
        ` : ''}
      </div>`;
  }

  // ── Page: Decisions ───────────────────────────────────────────────
  function renderDecisions() {
    const escs = [...(state.brokerStats?.recentEscalations || [])].reverse();
    return `
      <div class="page-header">
        <div class="page-title">Decisions &amp; Escalations</div>
        <div class="page-desc">Every LLM call, cache hit and fallback routed by the broker (last 200)</div>
      </div>

      <div class="card" style="padding:6px 4px;margin-bottom:16px">
        ${escalationsTable(escs, false)}
      </div>

      <div class="section-title">Per-Agent Decision Feeds</div>
      <div class="grid-2">
        ${state.agents.map(a => `
          <div class="card">
            <div class="agent-head" style="margin-bottom:8px">
              <span class="status-pill ${a.online ? 'ok' : 'err'}"></span>
              <span class="agent-name">${esc(a.username)}</span>
            </div>
            ${(a.recentDecisions || []).length === 0
              ? '<div class="empty-state">No local decisions yet…</div>'
              : a.recentDecisions.slice(-12).reverse().map(x => `
                <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-soft);font-size:12.5px">
                  <span class="num" style="color:var(--text-faint)">${timeOf(x.ts)}</span>
                  ${sourceBadge(x)}
                  <b class="mono">${esc(x.action)}</b>
                  ${x.confidence != null ? `<span style="color:var(--text-faint)">conf ${Number(x.confidence).toFixed(2)}</span>` : ''}
                  <span style="color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${esc(x.reason || '')}</span>
                </div>`).join('')}
          </div>`).join('')}
      </div>`;
  }

  function escalationsTable(rows, compact) {
    if (!rows.length) return '<div class="empty-state">No escalations recorded yet…</div>';
    return `
      <table>
        <thead><tr>
          <th>Time</th><th>Agent</th><th>Source</th><th>Action</th>
          ${compact ? '' : '<th>Provider / Model</th>'}
          <th>Tokens</th><th>Cost</th><th>Latency</th>
        </tr></thead>
        <tbody>
          ${rows.map(e => `
            <tr>
              <td class="num" style="color:var(--text-faint)">${timeOf(e.ts)}</td>
              <td>${esc(e.agentId)}</td>
              <td>${sourceBadge(e)}</td>
              <td><b class="mono">${esc(e.action || '—')}</b></td>
              ${compact ? '' : `<td>${e.provider ? `<span style="color:var(--amber)">${esc(e.provider)}</span>` : '<span style="color:var(--text-faint)">—</span>'} ${e.model ? `<span style="color:var(--text-faint);font-size:11px">${esc(e.model)}</span>` : ''}</td>`}
              <td class="num">${e.source === 'llm' ? `${fmtInt(e.inputTokens)}/${fmtInt(e.outputTokens)}` : '—'}</td>
              <td class="num">${e.costUsd > 0 ? fmtCost(e.costUsd) : e.source === 'llm' ? '$0*' : '—'}</td>
              <td class="num">${e.latencyMs ? fmtMs(e.latencyMs) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  // ── Page: Costs ───────────────────────────────────────────────────
  function renderCosts() {
    const s = state.brokerStats;
    if (!s) return '<div class="card empty-state">Waiting for broker stats…</div>';
    const t = s.totals || {};
    const rl = s.rateLimits?.providers || {};

    return `
      <div class="page-header">
        <div class="kpi-title"><div class="page-title">Costs &amp; Free Tier Limits</div>
        <div class="page-desc">100% Free Developer Tier Active · Zero Cost · Benchmark Savings: ${fmtCost(t.savedUsd)}</div></div>
      </div>

      <div class="grid-kpi">
        <div class="card"><div class="kpi-label">Actual Spend</div><div class="kpi-value green">$0.00</div><div class="kpi-sub">100% Free Tier Active</div></div>
        <div class="card"><div class="kpi-label">Tokens Processed</div><div class="kpi-value">${fmtInt((t.inputTokens || 0) + (t.outputTokens || 0))}</div><div class="kpi-sub">${fmtInt(t.inputTokens)} in / ${fmtInt(t.outputTokens)} out</div></div>
        <div class="card"><div class="kpi-label">Commercial Value Saved</div><div class="kpi-value" style="color:var(--lime)">${fmtCost(t.savedUsd)}</div><div class="kpi-sub">vs commercial list prices</div></div>
        <div class="card"><div class="kpi-label">Avg Latency</div><div class="kpi-value">${t.successes ? fmtMs(Math.round((Object.values(s.providers).reduce((x, p) => x + p.totalLatencyMs, 0)) / t.successes)) : '—'}</div></div>
      </div>

      <div class="section-title">Free Tier Providers</div>
      <div class="card" style="padding:6px 4px;margin-bottom:16px">
        <table>
          <thead><tr>
            <th>Provider &amp; Tier</th><th>Calls</th><th>OK / Fail</th><th>429 Hits</th>
            <th>In Tok</th><th>Out Tok</th><th>Actual / Saved</th><th>Avg Latency</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${Object.entries(s.providers).map(([name, p]) => {
              const r = rl[name];
              return `
                <tr>
                  <td>
                    <b>${esc(name)}</b>${!p.configured ? ' <span class="badge badge-neutral">no key</span>' : ''}
                    <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${esc(p.tier || '')}</div>
                  </td>
                  <td class="num">${fmtInt(p.calls)}</td>
                  <td class="num"><span style="color:var(--green)">${fmtInt(p.successes)}</span> / <span style="color:var(--red)">${fmtInt(p.failures)}</span></td>
                  <td class="num" style="color:${p.rateLimited > 0 ? 'var(--red)' : 'inherit'}">${fmtInt(p.rateLimited)}</td>
                  <td class="num">${fmtInt(p.inputTokens)}</td>
                  <td class="num">${fmtInt(p.outputTokens)}</td>
                  <td class="num"><span class="green">$0.00</span> <span style="color:var(--text-faint);font-size:11px">(${fmtCost(p.savedUsd)} saved)</span></td>
                  <td class="num">${p.avgLatencyMs != null ? fmtMs(p.avgLatencyMs) : '—'}</td>
                  <td>${r?.blocked
                    ? `<span class="badge badge-offline">COOLDOWN ${Math.ceil(r.cooldownRemainingMs / 1000)}s</span>`
                    : p.configured ? '<span class="badge badge-online">READY</span>'
                    : '<span class="badge badge-neutral">OFF</span>'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="section-title">Cache Efficiency (free wins)</div>
      <div class="grid-kpi">
        <div class="card"><div class="kpi-label">Exact Hits</div><div class="kpi-value" style="color:var(--lime)">${fmtInt(s.caches.exactHits)}</div><div class="kpi-sub">$0 spent</div></div>
        <div class="card"><div class="kpi-label">Semantic Hits</div><div class="kpi-value" style="color:var(--lime)">${fmtInt(s.caches.semanticHits)}</div><div class="kpi-sub">$0 spent</div></div>
        <div class="card"><div class="kpi-label">Fallbacks</div><div class="kpi-value ${s.caches.fallbacks > 0 ? 'red' : ''}">${fmtInt(s.caches.fallbacks)}</div><div class="kpi-sub">provider unavailable</div></div>
        <div class="card"><div class="kpi-label">Broker Uptime</div><div class="kpi-value mono" style="font-size:18px">${t.startedAt ? new Date(t.startedAt).toLocaleString('en-US') : '—'}</div></div>
      </div>`;
  }

  // ── Chat feed ─────────────────────────────────────────────────────
  function chatFeed(msgs) {
    if (!msgs.length) return '<div class="empty-state">No chat yet… Send a message as operator to converse with agents!</div>';
    return msgs.map(m => {
      const u = m.username || m.agentUsername || '?';
      const isOperator = u.toLowerCase() === 'youallneed' || u.toLowerCase() === 'operator';
      const isAlpha = u === 'Agent_Alpha';
      const isBeta = u === 'Agent_Beta';
      const isGamma = u === 'Agent_Gamma';
      
      const badgeClass = isOperator ? 'who-operator' : isAlpha ? 'who-alpha' : isBeta ? 'who-beta' : isGamma ? 'who-gamma' : 'who-other';
      const badgeLabel = isOperator ? '👑 ' + esc(u) : '🤖 ' + esc(u);

      return `
      <div class="chat-msg ${isOperator ? 'chat-msg-operator' : ''}">
        <span class="chat-time num">${timeOf(m.timestamp)}</span>
        <span class="who ${badgeClass}">${badgeLabel}</span>
        <span class="chat-text">${esc(m.message)}</span>
      </div>`;
    }).join('');
  }

  // ── Sidebar service pills ─────────────────────────────────────────
  function setSvc(id, ok) {
    const el = document.getElementById(id);
    if (el) el.className = `status-pill ${ok ? 'ok' : 'err'}`;
  }

  // ── WebSocket wiring ──────────────────────────────────────────────
  let ws = null;

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.onopen = () => { state.wsOnline = true; setSvc('svc-ws', true); };

    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      handleEvent(msg.type, msg.data);
    };

    ws.onclose = () => {
      state.wsOnline = false;
      setSvc('svc-ws', false);
      setTimeout(connectWS, 3000);
    };

    ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  }

  function handleEvent(type, data) {
    switch (type) {
      case 'full_state':
        state.broker = data.broker || null;
        state.memoryService = data.memoryService || null;
        state.brokerStats = data.brokerStats || state.brokerStats;
        state.spectator = data.spectator || null;
        state.agents = Array.isArray(data.agents) ? data.agents : [];
        if (!state.spectateTarget && state.agents.length > 0) {
          state.spectateTarget = state.agents[0].username;
        }
        break;
      case 'agents_state':
        state.agents = Array.isArray(data) ? data : [];
        if (!state.spectateTarget && state.agents.length > 0) {
          state.spectateTarget = state.agents[0].username;
        }
        break;
      case 'service_health':
        state.broker = data.broker || state.broker;
        state.memoryService = data.memoryService || state.memoryService;
        break;
      case 'broker_stats':
        state.brokerStats = data;
        break;
      case 'spectator_state':
        state.spectator = data;
        break;
      case 'spectate_ack':
        if (data?.agentId) state.spectateTarget = data.agentId;
        break;
      case 'chat_history':
        state.chat = data.messages || [];
        break;
      case 'chat_message': {
        const user = (data.username || data.agentUsername || '').trim();
        const text = (data.message || '').trim();
        const isDup = state.chat.slice(-10).some(m => {
          const mUser = (m.username || m.agentUsername || '').trim();
          const mText = (m.message || '').trim();
          return mUser === user && mText === text;
        });
        if (!isDup) {
          state.chat.push(data);
          if (state.chat.length > 120) state.chat.shift();
        }
        break;
      }
      default: return;
    }
    setSvc('svc-broker', state.broker?.status === 'ok');
    setSvc('svc-memory', state.memoryService?.status === 'ok');
    setSvc('svc-spectator', state.spectator?.online && state.spectator?.viewerReady);
    render();
  }

  // ── Global Actions ─────────────────────────────────────────────────
  window.spectateAgent = function(agentName) {
    if (!agentName) return;
    state.spectateTarget = agentName;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'spectate_agent', agentId: agentName }));
    }
    setPage('world');
  };

  window.reloadWorldViewer = function() {
    const frame = document.getElementById('world-stream-frame');
    if (frame) {
      frame.src = '/viewer/?t=' + Date.now();
    }
  };

  window.setAgentTrait = async function(agentName, traitKey, val) {
    const numVal = parseFloat(val);
    try {
      await fetch(`/api/dashboard/agents/${encodeURIComponent(agentName)}/personality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traits: { [traitKey]: numVal } })
      });
      const agent = state.agents.find(a => a.username === agentName);
      if (agent && agent.persona && agent.persona.traits) {
        agent.persona.traits[traitKey] = numVal;
      }
      render();
    } catch (err) {
      console.error('Failed to update agent trait:', err);
    }
  };

  window.insertChatCommand = function(cmd) {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = cmd;
      input.focus();
    }
  };

  // ── Operator Chat ──────────────────────────────────────────────────
  async function sendOperatorChat() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    input.disabled = true;
    try {
      const res = await fetch('/api/dashboard/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (res.ok) {
        draftChat = '';
        input.value = '';
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Chat send failed:', err.error || res.statusText);
      }
    } catch (err) {
      console.error('Failed to send operator chat:', err);
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => setPage(btn.dataset.page));
  });

  root.addEventListener('click', e => {
    if (e.target && (e.target.id === 'chat-send-btn' || e.target.closest('#chat-send-btn'))) {
      e.preventDefault();
      sendOperatorChat();
    }
  });

  root.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.id === 'chat-input') {
      e.preventDefault();
      sendOperatorChat();
    }
  });

  connectWS();
  render();
})();
