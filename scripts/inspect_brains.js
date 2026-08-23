const http = require('http');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function inspectAgents() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('         CIVILIZATION AGENT COGNITION & BRAIN STATUS AUDIT      ');
  console.log('════════════════════════════════════════════════════════════════\n');

  for (const port of [3010, 3011, 3012]) {
    try {
      const d = await fetchJson(`http://localhost:${port}/status`);
      console.log(`🤖 AGENT: ${d.username} | Status: ${d.online ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
      console.log(`   Vitals: Health: ${d.stats?.health}/20 | Hunger: ${d.stats?.hunger}/20 | Happiness: ${d.stats?.happiness}% | Fatigue: ${d.stats?.fatigue}%`);
      console.log(`   World: Pos [X: ${Math.round(d.position?.x || 0)}, Y: ${Math.round(d.position?.y || 0)}, Z: ${Math.round(d.position?.z || 0)}] | Biome: ${d.biome || 'plains'} | Time: ${d.timeOfDay}`);
      console.log(`   Active Goal: "${d.activeGoal?.description || d.activeGoal || 'None'}"`);
      console.log(`   Inventory: ${d.inventory?.length ? d.inventory.map(i => `${i.name}×${i.count}`).join(', ') : 'Empty'}`);
      console.log(`   Current Thought / Last Action: [${d.lastDecision?.action}] (${d.lastDecision?.source}) -> "${d.lastDecision?.reason}"`);
      if (d.persona) {
        console.log(`   Persona Traits: Curiosity: ${Math.round((d.persona.traits?.curiosity || 0)*100)}% | Caution: ${Math.round((d.persona.traits?.caution || 0)*100)}% | Sociability: ${Math.round((d.persona.traits?.sociability || 0)*100)}%`);
        console.log(`   Quirk: "${d.persona.quirk || 'None'}" | Scars: ${d.persona.scarCount || 0}`);
      }
      console.log(`   Decision Flow (Last 5): ${(d.recentDecisions || []).slice(-5).map(x => `${x.action}(${x.source})`).join(' ➔ ')}`);
      console.log('────────────────────────────────────────────────────────────────\n');
    } catch (e) {
      console.log(`❌ Port ${port}: ${e.message}\n`);
    }
  }
}

inspectAgents();
