'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class MasterStrategist extends BaseAgent {
  constructor() {
    super({
      name:      'Master Strategist',
      role:      'You are the CEO-level Strategic Advisor for ResidualVault. You synthesise intelligence from all 24 autonomous agents, identify the highest-leverage opportunities, resolve strategic conflicts, and produce the overarching roadmap that ensures ResidualVault achieves its vision of becoming the #1 passive income platform.',
      model:     'claude-opus-4-5',
      schedule:  '0 11 * * 0',  // Sundays at 6 PM (weekly strategy brief)
      timezone:  'America/Denver',
      maxTokens: 8096,
    });
  }

  async synthesiseAgentIntelligence() {
    const summary = db.getDashboardSummary();
    const reportsRaw = await db.getReports(30);
    const reports = Array.isArray(reportsRaw) ? reportsRaw : [];
    const alerts  = await db.getOpenAlerts();
    const metrics = db.getAllMetrics();

    // Extract key intelligence from recent reports
    const reportSummaries = reports.slice(0, 20).map(r => ({
      agent:    r.agent_name,
      type:     r.report_type,
      title:    r.title,
      priority: r.priority,
      date:     r.created_at,
    }));

    return this.ask(`
You are the Master Strategist synthesising intelligence from all ResidualVault autonomous agents.

SYSTEM HEALTH:
- Total agents: ${metrics.length}
- System success rate: ${summary.summary?.successRate}%
- Open alerts: ${alerts.length}
- Total agent runs: ${summary.summary?.totalRuns}

RECENT REPORTS (last 20):
${JSON.stringify(reportSummaries, null, 2)}

OPEN ALERTS:
${JSON.stringify(alerts.slice(0, 10).map(a => ({ agent: a.agent_name, severity: a.severity, title: a.title })))}

Synthesise all intelligence into a comprehensive strategic brief covering:
1. State of the business (health assessment)
2. Top 5 strategic opportunities this week
3. Top 3 threats requiring immediate attention
4. Cross-agent insights (patterns only one agent might miss)
5. Resource allocation recommendations (which agents to prioritise)
6. 30-day strategic roadmap
7. CEO action items for this week

Output JSON:
{
  "weekOf":            "${new Date().toISOString().split('T')[0]}",
  "businessHealth":    { "status": "excellent|good|concerning|critical", "score": 0-100, "trend": "improving|stable|declining" },
  "strategicOpps":    [{ "opportunity": "string", "source": "string", "impact": "high|medium|low", "urgency": "now|this-week|this-month", "owner": "string" }],
  "threats":          [{ "threat": "string", "severity": "critical|high|medium", "source": "string", "mitigation": "string", "deadline": "string" }],
  "crossAgentInsights": ["string"],
  "agentPriorities":  [{ "agent": "string", "priority": 1-10, "reason": "string", "focusArea": "string" }],
  "roadmap30Days":    [{ "week": "string", "theme": "string", "keyActions": ["string"], "expectedOutcome": "string" }],
  "ceoActionItems":   [{ "action": "string", "urgency": "today|this-week|this-month", "impact": "string" }],
  "northStarMetric":  "string",
  "executiveBrief":   "string (2-3 paragraphs, board-ready)"
}
`);
  }

  async buildOKRs() {
    return this.ask(`
Build quarterly OKRs (Objectives and Key Results) for ResidualVault.

QUARTER: ${new Date().toISOString().split('T')[0]} onwards
COMPANY STAGE: Growth stage, scaling
NORTH STAR: Become the #1 passive income platform for digital entrepreneurs

Create 4 Objectives, each with 3-4 Key Results. Key Results must be measurable.

Output JSON:
{
  "quarter": "string",
  "companyObjective": "string",
  "okrs": [
    {
      "objective": "string",
      "owner": "string",
      "keyResults": [
        { "kr": "string", "baseline": "string", "target": "string", "stretch": "string", "measurement": "string" }
      ],
      "initiatives": ["string"],
      "agentsSupporting": ["string"]
    }
  ],
  "companyKPIs": [{ "kpi": "string", "current": "string", "target": "string", "deadline": "string" }]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running Master Strategist weekly synthesis');

    const [intelligenceRaw, okrsRaw] = await Promise.all([
      this.synthesiseAgentIntelligence(),
      this.buildOKRs(),
    ]);

    const intelligence = this.parseJSON(intelligenceRaw) || {};
    const okrs         = this.parseJSON(okrsRaw)         || {};

    // Alert on business health issues
    if (intelligence.businessHealth?.status === 'critical') {
      await this.reportIssue(
        'critical',
        'Business Health Critical — Immediate CEO Action Required',
        intelligence.executiveBrief || 'Multiple critical issues detected across agent network'
      );
    } else if (intelligence.businessHealth?.status === 'concerning') {
      await this.reportIssue(
        'high',
        'Business Health Concerning — Review Strategic Brief',
        intelligence.executiveBrief || 'Multiple concerning signals across agent network'
      );
    }

    // Alert on critical threats
    for (const threat of (intelligence.threats || []).filter(t => t.severity === 'critical')) {
      await this.reportIssue(
        'critical',
        `Strategic Threat: ${threat.threat}`,
        `${threat.mitigation} — Deadline: ${threat.deadline}`
      );
    }

    await this.saveContent(
      'strategic-brief',
      `Weekly Strategic Brief — ${intelligence.weekOf}`,
      intelligence.executiveBrief || '',
      null,
      {
        businessHealth: intelligence.businessHealth,
        opportunities:  (intelligence.strategicOpps || []).length,
        threats:        (intelligence.threats || []).length,
        okrObjectives:  (okrs.okrs || []).length,
      }
    );

    await this.saveReport(
      'master-strategy',
      `Weekly Strategy Brief — Health: ${intelligence.businessHealth?.status} (${intelligence.businessHealth?.score}/100)`,
      JSON.stringify({ intelligence, okrs }, null, 2),
      ['critical', 'concerning'].includes(intelligence.businessHealth?.status) ? 'high' : 'normal'
    );

    this._log('info', `Strategic synthesis complete — Business health: ${intelligence.businessHealth?.status}`);

    return {
      businessStatus: intelligence.businessHealth?.status,
      businessScore:  intelligence.businessHealth?.score,
      opportunities:  (intelligence.strategicOpps || []).length,
      threats:        (intelligence.threats || []).length,
      ceoActions:     (intelligence.ceoActionItems || []).length,
      okrObjectives:  (okrs.okrs || []).length,
    };
  }
}

module.exports = MasterStrategist;

if (require.main === module) {
  const agent = new MasterStrategist();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
