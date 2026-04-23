'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class PromotionsMasterAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Promotions Master Agent',
      role:      'You are the Promotions Director for ResidualVault. You design, launch, and manage promotional campaigns, discount strategies, flash sales, loyalty programs, and special offers that drive conversions and revenue without eroding brand value.',
      model:     'claude-sonnet-4-6',
      schedule:  '30 9 * * 0',   // Wednesdays at 8 AM
      timezone:  'America/Denver',
      maxTokens: 4096,
    });
  }

  async designPromotion(type, goal, duration) {
    return this.ask(`
Design a ${type} promotion for ResidualVault.

PROMOTION BRIEF:
- Type: ${type}
- Goal: ${goal}
- Duration: ${duration}
- Platform: ResidualVault (passive income / digital marketing SaaS)

Create a complete promotion including:
1. Promotion concept and hook
2. Offer mechanics (discount %, bonus, bundle, etc.)
3. Eligibility and terms
4. Urgency/scarcity elements
5. Multi-channel rollout plan
6. Email sequence (3 emails: launch, mid, last-chance)
7. Success metrics

Output JSON:
{
  "name": "string",
  "type": "${type}",
  "headline": "string",
  "offer": {
    "description": "string",
    "discountPct": number,
    "bonusItems": ["string"],
    "originalPrice": "string",
    "promoPrice": "string",
    "promoCode": "string"
  },
  "urgency": { "mechanism": "string", "limitType": "time|quantity|both", "limitValue": "string" },
  "eligibility": "string",
  "channels": ["string"],
  "emailSequence": [
    { "email": 1, "subject": "string", "hook": "string", "cta": "string", "sendTime": "string" }
  ],
  "metrics": [{ "kpi": "string", "target": "string" }],
  "startDate": "string",
  "endDate": "string",
  "executiveSummary": "string"
}
`);
  }

  async generateLoyaltyProgram() {
    return this.ask(`
Design a comprehensive loyalty program for ResidualVault users.

Include:
1. Program name and concept
2. Tier structure (3-4 tiers)
3. Points/rewards mechanics
4. Redemption options
5. Exclusive benefits per tier
6. Referral component
7. Communication strategy

Output JSON:
{
  "programName": "string",
  "concept": "string",
  "tiers": [
    {
      "name": "string",
      "requirement": "string",
      "color": "string",
      "benefits": ["string"],
      "pointsMultiplier": number
    }
  ],
  "mechanics": {
    "earningRules": [{ "action": "string", "points": number }],
    "redemptionOptions": [{ "option": "string", "cost": "string" }]
  },
  "referralBonus": "string",
  "launchStrategy": "string"
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Designing weekly promotions');

    const promoTypes = [
      { type: 'Flash Sale',        goal: 'Drive immediate conversions from fence-sitters',  duration: '48 hours' },
      { type: 'Bundle Offer',      goal: 'Increase average order value',                    duration: '7 days' },
      { type: 'Referral Campaign', goal: 'Acquire new users via existing member network',   duration: '30 days' },
    ];

    const results = [];

    for (const brief of promoTypes.slice(0, 2)) {
      try {
        const raw   = await this.designPromotion(brief.type, brief.goal, brief.duration);
        const promo = this.parseJSON(raw) || {};

        await this.saveContent(
          'promotion',
          promo.name || `${brief.type} Promotion`,
          promo.executiveSummary || '',
          null,
          { offer: promo.offer, channels: promo.channels, emailSequence: promo.emailSequence }
        );

        results.push({ type: brief.type, name: promo.name, promoCode: promo.offer?.promoCode, status: 'designed' });
      } catch (err) {
        this._log('error', `Promotion design failed: ${err.message}`);
        results.push({ type: brief.type, status: 'failed' });
      }
    }

    // Loyalty program (weekly)
    const loyaltyRaw = await this.generateLoyaltyProgram();
    const loyalty    = this.parseJSON(loyaltyRaw) || {};

    await this.saveContent('loyalty-program', loyalty.programName || 'Loyalty Program', loyalty.concept || '', null, loyalty);

    await this.saveReport(
      'promotions',
      `Weekly Promotions Plan — ${results.filter(r => r.status === 'designed').length} promotions ready`,
      JSON.stringify({ promotions: results, loyaltyProgram: loyalty.programName }, null, 2)
    );

    return { promotions: results.length, loyaltyProgram: loyalty.programName };
  }
}

module.exports = PromotionsMasterAgent;

if (require.main === module) {
  const agent = new PromotionsMasterAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
