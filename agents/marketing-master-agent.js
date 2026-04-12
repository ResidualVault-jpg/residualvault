'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class MarketingMasterAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Marketing Master Agent',
      role:      'You are the Chief Marketing Officer for ResidualVault. You develop comprehensive marketing strategies, coordinate multi-channel campaigns, analyze market trends, and orchestrate all marketing activities to drive user acquisition, engagement, and retention.',
      model:     'claude-opus-4-5',
      schedule:  '45 8 * * 0',   // Mondays at 7 AM
      timezone:  'America/Denver',
      maxTokens: 8096,
    });
  }

  async buildWeeklyStrategy() {
    const metrics = db.getAllMetrics();
    const reports = db.getReports(10);

    return this.ask(`
You are the CMO of ResidualVault creating this week's marketing strategy.

PLATFORM CONTEXT:
- Product: ResidualVault — a platform for building passive income streams through digital marketing
- Target: Entrepreneurs, side-hustlers, digital nomads aged 25-45
- Key metrics available: ${metrics.length} agent activity records
- Recent reports: ${reports.length} generated

Create a comprehensive 7-day marketing strategy covering:

1. **Campaign Theme** — weekly narrative and messaging
2. **Channel Strategy** — email, social, content, paid, SEO priorities
3. **Content Calendar** — day-by-day content plan
4. **Key Messages** — 3 core messages for the week
5. **Target Segments** — which audience segments to prioritize
6. **KPIs** — measurable targets for the week
7. **Budget Allocation** — percentage breakdown by channel (if applicable)
8. **Agent Coordination** — which AI agents to activate and when

Output JSON:
{
  "weekOf": "${new Date().toISOString().split('T')[0]}",
  "theme": "string",
  "tagline": "string",
  "channels": {
    "email":   { "priority": 1-5, "focus": "string", "frequency": "string" },
    "social":  { "priority": 1-5, "focus": "string", "platforms": ["string"] },
    "content": { "priority": 1-5, "focus": "string", "types": ["string"] },
    "paid":    { "priority": 1-5, "focus": "string", "budget_pct": number },
    "seo":     { "priority": 1-5, "focus": "string", "keywords": ["string"] }
  },
  "contentCalendar": [
    { "day": "string", "channel": "string", "type": "string", "topic": "string", "goal": "string" }
  ],
  "keyMessages": ["string"],
  "targetSegments": ["string"],
  "kpis": [{ "metric": "string", "target": "string", "baseline": "string" }],
  "agentTasks": [{ "agent": "string", "task": "string", "priority": "high|medium|low" }],
  "executiveSummary": "string"
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Building weekly marketing strategy');

    const raw      = await this.buildWeeklyStrategy();
    const strategy = this.parseJSON(raw) || { executiveSummary: raw.substring(0, 1000) };

    await this.saveReport(
      'marketing-strategy',
      `Weekly Marketing Strategy — ${strategy.theme || 'Week of ' + new Date().toDateString()}`,
      JSON.stringify(strategy, null, 2),
      'normal'
    );

    await this.saveContent(
      'strategy',
      `Marketing Strategy: ${strategy.theme}`,
      strategy.executiveSummary || '',
      null,
      { fullStrategy: strategy }
    );

    this._log('info', `Marketing strategy created: ${strategy.theme}`);
    return { theme: strategy.theme, channels: Object.keys(strategy.channels || {}), kpis: (strategy.kpis || []).length };
  }
}

module.exports = MarketingMasterAgent;

if (require.main === module) {
  const agent = new MarketingMasterAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
