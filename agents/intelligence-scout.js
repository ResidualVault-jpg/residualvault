'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');

class IntelligenceScout extends BaseAgent {
  constructor() {
    super({
      name:      'Intelligence Scout',
      role:      'You are the Competitive Intelligence Director for ResidualVault. You monitor competitors, track market shifts, identify emerging opportunities and threats, and deliver actionable intelligence that keeps ResidualVault ahead of the curve.',
      model:     'claude-opus-4-5',
      schedule:  '15 6 * * 0',   // Wednesdays at 6 AM
      timezone:  'America/Denver',
      maxTokens: 6144,
    });

    this.competitors = [
      'Kajabi', 'Teachable', 'ClickFunnels', 'Convertkit/Kit',
      'Gumroad', 'Podia', 'Thinkific', 'Stan Store',
    ];
  }

  async competitorAnalysis() {
    return this.ask(`
Conduct a comprehensive competitive intelligence report for ResidualVault.

COMPETITORS TO ANALYSE: ${this.competitors.join(', ')}

For each competitor assess:
1. Current positioning and messaging
2. Pricing strategy and recent changes
3. Feature additions/removals
4. Marketing channels and ad spend signals
5. Community sentiment
6. Partnership activities
7. Vulnerability to attack

Output JSON:
{
  "date": "${new Date().toISOString().split('T')[0]}",
  "competitors": [
    {
      "name": "string",
      "positioning": "string",
      "pricingStrategy": "string",
      "strengths": ["string"],
      "weaknesses": ["string"],
      "recentActivity": ["string"],
      "marketingFocus": "string",
      "vulnerabilities": ["string"],
      "threatLevel": "low|medium|high"
    }
  ],
  "marketShare": { "leader": "string", "challenger": "string", "nicher": "string" },
  "competitiveLandscape": "string",
  "residualVaultAdvantages": ["string"],
  "immediateThreats": ["string"]
}
`);
  }

  async identifyMarketOpportunities() {
    return this.ask(`
Identify untapped market opportunities for ResidualVault in the passive income / digital entrepreneurship space.

Research dimensions:
1. Geographic markets (underserved countries/regions)
2. Demographic segments (underserved audiences)
3. Content gaps (high-demand, low-supply topics)
4. Product gaps (features competitors don't offer)
5. Distribution channels (underutilised platforms)
6. Partnership white space
7. Pricing model innovations

Output JSON:
{
  "opportunities": [
    {
      "type": "geographic|demographic|content|product|channel|partnership|pricing",
      "opportunity": "string",
      "size": "small|medium|large|massive",
      "competitiveIntensity": "low|medium|high",
      "captureEffort": "low|medium|high",
      "timeToCapture": "string",
      "potentialImpact": "string",
      "firstMove": "string",
      "priority": 1-10
    }
  ],
  "topOpportunity": "string",
  "quickWins": ["string"],
  "strategicBets": ["string"]
}
`);
  }

  async monitorTrends() {
    return this.ask(`
Monitor and report on emerging trends affecting ResidualVault's market.

TREND CATEGORIES:
1. Technology trends (AI, automation, new platforms)
2. Behaviour shifts (how creators/entrepreneurs are working)
3. Economic trends (affecting buying behaviour)
4. Regulatory trends (affecting digital business)
5. Content consumption trends
6. Platform algorithm changes

Output JSON:
{
  "trends": [
    {
      "category": "string",
      "trend": "string",
      "maturity": "emerging|growing|mainstream|declining",
      "impactOnRV": "positive|neutral|negative",
      "impactScore": 1-10,
      "timeHorizon": "now|6months|12months|2years",
      "recommendedAction": "string",
      "opportunityScore": 1-10
    }
  ],
  "trendingSummary": "string",
  "strategicImplications": ["string"],
  "watchList": ["string"]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running competitive intelligence cycle');

    const [competitorRaw, opportunitiesRaw, trendsRaw] = await Promise.all([
      this.competitorAnalysis(),
      this.identifyMarketOpportunities(),
      this.monitorTrends(),
    ]);

    const competitors   = this.parseJSON(competitorRaw)    || {};
    const opportunities = this.parseJSON(opportunitiesRaw) || {};
    const trends        = this.parseJSON(trendsRaw)         || {};

    // Alert on high-threat competitors
    const highThreats = (competitors.competitors || []).filter(c => c.threatLevel === 'high');
    if (highThreats.length > 0) {
      await this.reportIssue(
        'medium',
        `${highThreats.length} High-Threat Competitor Movements Detected`,
        `Competitors: ${highThreats.map(c => c.name).join(', ')} — Review intelligence report`
      );
    }

    // Alert on negative-impact high-score trends
    const negativeTrends = (trends.trends || []).filter(t => t.impactOnRV === 'negative' && t.impactScore >= 7);
    if (negativeTrends.length > 0) {
      await this.reportIssue(
        'medium',
        'High-Impact Negative Trends Detected',
        negativeTrends.map(t => t.trend).join(' | ')
      );
    }

    await this.saveContent(
      'competitive-intelligence',
      `Competitive Intelligence Report — ${new Date().toISOString().split('T')[0]}`,
      JSON.stringify({ competitors, opportunities, trends }, null, 2),
      null,
      { threatCount: highThreats.length, opportunityCount: (opportunities.opportunities || []).length }
    );

    await this.saveReport(
      'intelligence',
      `Intelligence Report — ${highThreats.length} threats, ${(opportunities.quickWins || []).length} quick wins`,
      JSON.stringify({ competitors, opportunities, trends }, null, 2),
      highThreats.length > 2 ? 'high' : 'normal'
    );

    return {
      competitorsAnalysed: (competitors.competitors || []).length,
      highThreats:         highThreats.length,
      opportunities:       (opportunities.opportunities || []).length,
      trends:              (trends.trends || []).length,
    };
  }
}

module.exports = IntelligenceScout;

if (require.main === module) {
  const agent = new IntelligenceScout();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
