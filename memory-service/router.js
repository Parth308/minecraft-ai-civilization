class EventRouter {
  routeEvent(event) {
    const type = event.type ? event.type.toLowerCase() : '';
    const payload = event.payload || {};

    // 1. Relationships (Chat, player interaction, player combat)
    if (type.includes('chat') || type.includes('player') || type.includes('trade') || payload.username) {
      let tag = '[met]';
      if (type.includes('attack') || type.includes('conflict') || type.includes('hurt')) tag = '[conflict]';
      else if (type.includes('trade') || type.includes('coop')) tag = '[coop]';
      else if (type.includes('chat')) tag = '[chat]';

      return {
        section: 'relationships',
        tag,
        summary: event.summary || `${tag} Interacted with player ${payload.username || 'unknown'}: ${payload.message || JSON.stringify(payload)}`
      };
    }

    // 2. Events (Combat damage, death, raids, severe threats)
    if (type.includes('hurt') || type.includes('attack') || type.includes('death') || type.includes('raid') || type.includes('flee')) {
      let tag = '[damage]';
      if (type.includes('death')) tag = '[death]';
      else if (type.includes('raid')) tag = '[raid]';
      else if (type.includes('flee')) tag = '[flee]';

      return {
        section: 'events',
        tag,
        summary: event.summary || `${tag} Incident: ${type} - ${JSON.stringify(payload)}`
      };
    }

    // 3. Skills & Discoveries (Mining, building, exploration, item discovery)
    if (type.includes('mine') || type.includes('craft') || type.includes('build') || type.includes('explore') || type.includes('discover')) {
      let tag = '[discovery]';
      if (type.includes('mine') || type.includes('craft')) tag = '[skill]';
      else if (type.includes('explore')) tag = '[location]';

      // Noise gate: auto-summarized repetitive mine/craft successes flooded
      // skills.md (entire file was "Routine outcome" rows), so semantic
      // retrieval surfaced garbage instead of real tactics. Only curated
      // summaries reach skills; raw routine outcomes divert to recent.md.
      if (!event.summary && tag === '[skill]') {
        return {
          section: 'recent',
          tag: '[routine]',
          summary: `[routine] ${type} - ${JSON.stringify(payload)}`
        };
      }

      return {
        section: 'skills',
        tag,
        summary: event.summary || `${tag} Routine outcome: ${type} - ${JSON.stringify(payload)}`
      };
    }

    // Default fallback -> recent.md
    return {
      section: 'recent',
      tag: '[note]',
      summary: event.summary || `[note] ${type}: ${JSON.stringify(payload)}`
    };
  }
}

module.exports = EventRouter;
