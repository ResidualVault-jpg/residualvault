'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class EmailConductor extends BaseAgent {
  constructor() {
    super({
      name:      'Email Conductor',
      role:      'You are the Email Marketing Director for ResidualVault, a cryptocurrency staking comparison and intelligence platform. You design high-converting email campaigns, build automation sequences, segment subscriber lists, and turn email into a key growth channel for crypto staking intelligence.',
      model:     'claude-sonnet-4-6',
      schedule:  '0 8 * * 0',
      timezone:  'America/Denver',
      maxTokens: 8096,
    });
  }

  async writeWeeklyNewsletter() {
    const today = new Date().toISOString().split('T')[0];
    return this.ask(`
Write this week's ResidualVault newsletter.

DATE: ${today}
BRAND: ResidualVault — cryptocurrency staking comparison and intelligence platform. Tracks 156+ staking protocols with live APY data, risk analysis, and yield comparisons.
AUDIENCE: Crypto stakers and DeFi investors who want to find the best staking yields and manage risk.
WEBSITE: ResidualVault.com
TONE: Expert but approachable. Data-driven. No hype. Think Bloomberg meets crypto-native.

Newsletter requirements:
- Subject line and preview text (no spam words, under 50 chars for subject)
- Warm opening that acknowledges something happening in crypto/staking this week
- Main feature: one in-depth staking strategy, protocol spotlight, or market insight (300-400 words)
- Quick wins section: 3 actionable staking tips
- Protocol spotlight: highlight a real protocol with strong APY (use real data like Persistence around 32 percent, Stargaze around 25 percent, Evmos around 22 percent, etc.)
- Market context: brief note on staking market trends
- Closing with CTA to explore protocols on ResidualVault.com

IMPORTANT: Use only real protocols and realistic APY figures. Never fabricate data.

Output JSON:
{
  "subject": "string under 50 chars",
  "previewText": "string under 90 chars",
  "greeting": "string",
  "mainFeature": {
    "headline": "string",
    "body": "string",
    "cta": "string",
    "ctaUrl": "https://residualvault.com"
  },
  "quickWins": [{ "tip": "string" }],
  "protocolSpotlight": {
    "name": "string",
    "apy": "string",
    "chain": "string",
    "riskLevel": "string",
    "description": "string"
  },
  "marketContext": "string",
  "closing": "string",
  "estimatedReadTime": "string"
}
`);
  }

  async buildAutomationSequence(goal, targetSegment, emailCount) {
    return this.ask(`
Build a ${emailCount}-email automation sequence for ResidualVault.

BRAND: ResidualVault — crypto staking comparison platform tracking 156+ protocols.
GOAL: ${goal}
TARGET SEGMENT: ${targetSegment}

For each email write:
1. Send timing (Day X after trigger)
2. Subject line and preview text
3. Full email body (focused on staking value prop)
4. Primary CTA pointing to ResidualVault.com
5. If-then branching rules (what happens based on open/click/no-action)

Output JSON:
{
  "sequenceName": "string",
  "goal": "${goal}",
  "targetSegment": "${targetSegment}",
  "trigger": "string",
  "emails": [
    {
      "emailNumber": 1,
      "sendDay": 0,
      "subject": "string",
      "preview": "string",
      "body": "string",
      "cta": "string",
      "ctaUrl": "https://residualvault.com",
      "ifOpened": "string",
      "ifClicked": "string",
      "ifNoAction": "string"
    }
  ]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running email conductor cycle');

    const newsletterRaw = await this.writeWeeklyNewsletter();
    const newsletter = this.parseJSON(newsletterRaw) || {};

    await this.saveContent(
      'email-newsletter',
      newsletter.subject || 'Weekly Newsletter',
      JSON.stringify(newsletter, null, 2),
      null,
      { estimatedReadTime: newsletter.estimatedReadTime }
    );

    const sequences = [
      { goal: 'Onboard new users — introduce staking comparison features and get first protocol saved', segment: 'New Signups', count: 5 },
      { goal: 'Re-engage inactive subscribers with top APY opportunities they are missing', segment: 'Inactive 30+ days', count: 4 },
      { goal: 'Convert free users to Starter/Pro plan with advanced staking analytics', segment: 'Free Tier Users', count: 4 },
    ];

    const seqResults = [];
    for (const seq of sequences) {
      try {
        const raw    = await this.buildAutomationSequence(seq.goal, seq.segment, seq.count);
        const result = this.parseJSON(raw) || {};
        await this.saveContent(
          'email-sequence',
          result.sequenceName || seq.goal,
          JSON.stringify(result, null, 2),
          null,
          { emailCount: seq.count, segment: seq.segment }
        );
        seqResults.push({ name: result.sequenceName, emails: seq.count, status: 'created' });
      } catch (err) {
        this._log('error', `Sequence failed: ${err.message}`);
        seqResults.push({ goal: seq.goal, status: 'failed' });
      }
    }

    await this.saveReport(
      'email-marketing',
      `Email Report — Newsletter ready, ${seqResults.filter(s => s.status === 'created').length} sequences built`,
      JSON.stringify({ newsletter: newsletter.subject, sequences: seqResults }, null, 2)
    );

    return {
      newsletterSubject: newsletter.subject,
      sequencesBuilt: seqResults.filter(s => s.status === 'created').length,
    };
  }
}

module.exports = EmailConductor;

if (require.main === module) {
  const agent = new EmailConductor();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
