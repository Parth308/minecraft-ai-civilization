const logger = require('../../shared/logger');

class TaxCollector {
  constructor(agentId, { memoryServiceUrl, chat }) {
    this.agentId = agentId;
    this.memoryServiceUrl = memoryServiceUrl || 'http://localhost:3002';
    this.chat = chat;
    this.TAX_RATE = 0.15;
    this._pendingObligations = [];
  }

  recordObligation(tradeData) {
    const { partner, giveItem, giveCount, wantItem, wantCount, fairnessScore, success, totalValue } = tradeData;
    if (!success) return null;

    const taxAmount = Math.floor((totalValue || 0) * this.TAX_RATE);
    if (taxAmount <= 0) return null;

    const obligation = {
      payer: this.agentId,
      partner,
      tradeValue: totalValue,
      taxAmount,
      taxRate: this.TAX_RATE,
      items: [
        { item: giveItem, count: giveCount },
        { item: wantItem, count: wantCount }
      ],
      fairnessScore,
      timestamp: Date.now(),
      paid: false
    };

    this._pendingObligations.push(obligation);
    logger.info('TaxCollector', `[TAX OWED] ${this.agentId} owes ${taxAmount} tax on trade with ${partner} (value: ${totalValue})`);
    return obligation;
  }

  getPendingObligations() {
    return this._pendingObligations.filter(o => !o.paid);
  }

  async payTaxes() {
    const pending = this.getPendingObligations();
    if (pending.length === 0) return null;

    let totalPaid = 0;
    for (const obligation of pending) {
      try {
        await fetch(`${this.memoryServiceUrl}/api/ledger/taxes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...obligation, paid: true })
        });
        obligation.paid = true;
        totalPaid += obligation.taxAmount;
        logger.info('TaxCollector', `[TAX PAID] ${this.agentId} paid ${obligation.taxAmount} tax on trade with ${obligation.partner}`);
      } catch (err) {
        logger.debug('TaxCollector', `Failed to record tax: ${err.message}`);
      }
    }

    this._pendingObligations = this._pendingObligations.filter(o => !o.paid);
    return totalPaid > 0 ? { totalPaid, count: pending.length } : null;
  }

  async queryTaxes() {
    try {
      const res = await fetch(`${this.memoryServiceUrl}/api/ledger/taxes?agent=${this.agentId}`);
      return await res.json();
    } catch {
      return { taxes: [], totalPaid: 0 };
    }
  }
}

module.exports = TaxCollector;
