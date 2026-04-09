'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class AnalyticsOracle extends BaseAgent {
  constructor() {
    super({
      name:      'Analytics Oracle',
      role:      'You are the Chief Analytics Officer for ResidualVault. You synthesise data from all sources, surface actionable insights, build intelligence reports for all stakeholders, identify performance trends, and translate complex data into clear business decisions.',
      model:     'claude-opus-4-5',
      schedule:  '0 5 * * *',   // Daily at 5 AM (runs first, before other agents)
      maxTokens: 8096,
    });
  }

  async generateDailyIntelligenceReport() {
    const summary   = db.getDashboardSummary();
    const metrics   = summary.metrics;
    const alerts    = summary.openAlerts;
    const reports   = summary.reports;
    const content   = summary.content;

    const systemStats = summary.summary;

    return this.ask(`
You are the Analytics Oracle generating the daily intelligence report for ResidualVault.

SYSTEM PERFORMANCE DATA:
- Total agent runs today: ${systemStats.totalRuns}
- Success rate: ${systemStats.successRate}%
- Failed runs: ${systemStats.totalFailed}
- Open alerts: ${systemStats.openAlerts}
- Active agents: ${systemStats.totalAgents}

AGENT PERFORMANCE:
${JSON.stringify(metrics.map(m => ({
  agent: m.agent_name,
  runs: m.runs_total,
  successRate: m.runs_total > 0 ? ((m.runs_success / m.runs_total) * 100).toFixed(0) + '%' : 'N/A',
  lastRun: m.last_run,
  avgDuration: m.avg_duration_ms ? Math.round(m.avg_duration_ms) + 'ms' : 'N/A',
  status: m.last_status,
})), null, 2)}

RECENT ALERTS: ${JSON.stringify(alerts.slice(0, 5).map(a => ({ agent: a.agent_name, severity: a.severity, title: a.title })))}

Generate a comprehensive daily intelligence report covering:
1. Executive summary (3 bullet points)
2. System health assessment
3. Top 5 performance insights
4. Revenue and growth indicators
5. Content pipeline health
6. Marketing performance snapshot
7. Risk dashboard
8. Today's recommended priority actions

Output JSON:
{
  "reportDate": "${new Date().toISOString().split('T')[0]}",
  "executiveSummary": ["string", "string", "string"],
  "systemHealth": { "status": "green|yellow|red", "score": 0-100, "notes": "string" },
  "insights": [{ "category": "string", "insight": "string", "impact": "string", "action": "string" }],
  "kpiSnapshot": {
    "agentSuccessRate": "${systemStats.successRate}%",
    "openAlerts": ${systemStats.openAlerts},
    "contentPipeline": "string",
    "marketingHealth": "string",
    "revenueSignal": "string"
  },
  "riskDashboard": [{ "risk": "string", "level": "low|medium|high|critical", "mitigation": "string" }],
  "todaysPriorities": [{ "priority": number, "action": "string", "owner": "string", "impact": "string" }],
  "trendingOpportunities": ["string"]
}
`);
  }

  async generateWeeklyAnalytics() {
    return this.ask(`
Generate a weekly analytics report for ResidualVault covering all business dimensions.

Date: ${new Date().toISOString().split('T')[0]}

Include:
1. Week-over-week performance comparison
2. Content performance metrics
3. Marketing funnel analysis
4. Community engagement trends
5. Revenue intelligence summary
6. Agent system performance
7. Next week predictions and recommendations

Output JSON:
{
  "weekOf": "${new Date().toISOString().split('T')[0]}",
  "wow": {
    "traffic":     { "change": "string", "trend": "up|stable|down" },
    "conversions": { "change": "string", "trend": "up|stable|down" },
    "revenue":     { "change": "string", "trend": "up|stable|down" },
    "engagement":  { "change": "string", "trend": "up|stable|down" }
  },
  "topPerformers": [{ "item": "string", "metric": "string", "value": "string" }],
  "underperformers": [{ "item": "string", "issue": "string", "fix": "string" }],
  "nextWeekForecast": { "outlook": "string", "confidence": "string", "keyDrivers": ["string"] },
  "recommendations": ["string"]
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Generating analytics intelligence reports');

    const [dailyRaw, weeklyRaw] = await Promise.all([
      this.generateDailyIntelligenceReport(),
      new Date().getDay() === 1 ? this.generateWeeklyAnalytics() : Promise.resolve('{}'), // Weekly on Mondays
    ]);

    const daily  = this.parseJSON(dailyRaw)  || {};
    const weekly = this.parseJSON(weeklyRaw) || {};

    // Alert on system health issues
    if (daily.systemHealth?.status === 'red') {
      await this.reportIssue('critical', 'System Health Critical', daily.systemHealth.notes || 'Multiple systems degraded');
    } else if (daily.systemHealth?.status === 'yellow') {
      await this.reportIssue('medium', 'System Health Warning', daily.systemHealth.notes || 'Performance degradation detected');
    }

    // Alert on critical risks
    if (daily.riskDashboard) {
      for (const risk of daily.riskDashboard.filter(r => r.level === 'critical')) {
        await this.reportIssue('critical', `Risk: ${risk.risk}`, risk.mitigation);
      }
    }

    await this.saveReport(
      'daily-intelligence',
      `Daily Intelligence Report — Health: ${daily.systemHealth?.status}, Score: ${daily.systemHealth?.score}`,
      JSON.stringify(daily, null, 2),
      daily.systemHealth?.status === 'red' ? 'high' : 'normal'
    );

    if (Object.keys(weekly).length > 0) {
      await this.saveReport(
        'weekly-analytics',
        `Weekly Analytics — ${weekly.weekOf}`,
        JSON.stringify(weekly, null, 2)
      );
    }

    return {
      systemHealth:    daily.systemHealth?.status,
      systemScore:     daily.systemHealth?.score,
      insights:        (daily.insights || []).length,
      openAlerts:      db.getOpenAlerts().length,
      topPriority:     daily.todaysPriorities?.[0]?.action,
    };
  }
}

module.exports = AnalyticsOracle;

if (require.main === module) {
  const agent = new AnalyticsOracle();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
