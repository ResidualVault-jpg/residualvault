'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class AdStrategist extends BaseAgent {
  constructor() {
    super({
      name:      'Ad Strategist',
      role:      'You are the Senior Advertising Strategist for ResidualVault. You develop data-driven advertising strategies, craft high-converting messaging frameworks, analyse competitor advertising, and build the overall paid media playbook that drives efficient customer acquisition.',
      model:     'claude-opus-4-5',
      schedule:  '15 9 * * 0',   // Thursdays at 9 AM
      timezone:  'America/Denver',
      maxTokens: 6144,
    });
  }

  async buildMessagingHierarchy() {
    return this.ask(`
Build the complete advertising messaging hierarchy for ResidualVault.

BRAND: ResidualVault — platform for building passive income through digital marketing
USP: The all-in-one system that turns your knowledge and skills into automated income streams

Create:
1. Master value proposition (1 sentence)
2. Proof points (3-5 supporting claims)
3. Pain-to-gain narrative arcs (3 different angles)
4. Emotional triggers by audience segment
5. Objection-handling messaging
6. Social proof frameworks

Output JSON:
{
  "masterUVP": "string",
  "taglines": ["string"],
  "proofPoints": [{ "claim": "string", "support": "string", "format": "string" }],
  "narrativeArcs": [
    { "angle": "string", "pain": "string", "agitate": "string", "solution": "string", "proof": "string", "cta": "string" }
  ],
  "emotionalTriggers": [
    { "segment": "string", "primaryEmotion": "string", "hook": "string", "message": "string" }
  ],
  "objectionHandlers": [
    { "objection": "string", "response": "string", "adCopy": "string" }
  ],
  "socialProofFormats": [{ "type": "string", "template": "string", "placement": "string" }]
}
`);
  }

  async analyseCompetitorAds() {
    return this.ask(`
Analyse the advertising landscape for platforms competing with ResidualVault (passive income / digital marketing platforms).

Competitors to analyse: Kajabi, Teachable, ClickFunnels, Convertkit, Gumroad, Podia

For each:
1. Likely ad angles and messaging
2. Target audience signals
3. Offer structure
4. Gaps we can exploit
5. Differentiation opportunities

Output JSON:
{
  "competitors": [
    {
      "name": "string",
      "messagingThemes": ["string"],
      "audienceFocus": "string",
      "offerStructure": "string",
      "strengths": ["string"],
      "weaknesses": ["string"]
    }
  ],
  "marketGaps": ["string"],
  "differentiationOpportunities": ["string"],
  "whiteSpaceAngles": ["string"],
  "strategicRecommendations": ["string"]
}
`);
  }

  async buildFunnelStrategy() {
    return this.ask(`
Design the complete paid advertising funnel strategy for ResidualVault.

Include all funnel stages: Awareness → Interest → Consideration → Intent → Purchase → Retention

For each stage:
1. Audience (cold/warm/hot)
2. Ad format recommendations
3. Messaging approach
4. Budget allocation (% of total budget)
5. Key metrics
6. Retargeting triggers

Output JSON:
{
  "funnelStages": [
    {
      "stage": "string",
      "audienceTemperature": "cold|warm|hot",
      "audienceSize": "string",
      "formats": ["string"],
      "messaging": "string",
      "budgetPct": number,
      "keyMetrics": ["string"],
      "retargetingTrigger": "string",
      "sampleAd": { "headline": "string", "body": "string", "cta": "string" }
    }
  ],
  "totalBudgetFramework": "string",
  "scalingTriggers": [{ "metric": "string", "threshold": "string", "action": "string" }],
  "expectedROAS": "string"
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Building advertising strategy');

    const [messagingRaw, competitorRaw, funnelRaw] = await Promise.all([
      this.buildMessagingHierarchy(),
      this.analyseCompetitorAds(),
      this.buildFunnelStrategy(),
    ]);

    const messaging   = this.parseJSON(messagingRaw)   || {};
    const competitors = this.parseJSON(competitorRaw)  || {};
    const funnel      = this.parseJSON(funnelRaw)      || {};

    await this.saveContent(
      'ad-strategy',
      'Advertising Strategy & Messaging Hierarchy',
      JSON.stringify({ messaging, funnel }, null, 2),
      null,
      { masterUVP: messaging.masterUVP, funnelStages: (funnel.funnelStages || []).length }
    );

    await this.saveReport(
      'ad-strategy',
      `Ad Strategy — ${(messaging.narrativeArcs || []).length} narratives, ${(funnel.funnelStages || []).length} funnel stages`,
      JSON.stringify({ messaging, competitors, funnel }, null, 2)
    );

    return {
      uvp:           messaging.masterUVP,
      narrativeArcs: (messaging.narrativeArcs || []).length,
      funnelStages:  (funnel.funnelStages || []).length,
      gaps:          (competitors.marketGaps || []).length,
    };
  }
}

module.exports = AdStrategist;

if (require.main === module) {
  const agent = new AdStrategist();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
