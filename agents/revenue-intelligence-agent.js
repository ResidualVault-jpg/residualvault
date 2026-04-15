'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class RevenueIntelligenceAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Revenue Intelligence Agent',
      role:      'You are the Revenue Intelligence Director for ResidualVault. You analyse revenue patterns, identify growth opportunities, forecast revenue trends, detect anomalies, and provide actionable intelligence to maximise MRR, LTV, and overall financial performance.',
      model:     'claude-opus-4-6',
      schedule:  '45 6 * * 0',   // Daily at 6 AM
      timezone:  'America/Denver',
      maxTokens: 6144,
    });
  }

  async analyseRevenueTrends() {
    const metrics = await db.getAllMetrics();
    const reports = await db.getReports(20);
    const today   = new Date().toISOString().split('T')[0];

    return this.ask(`
You are the Revenue Intelligence Director analysing ResidualVault's revenue performance.

SYSTEM DATE: ${today}
AGENT ACTIVITY: ${metrics.length} agents tracked, ${reports.length} recent reports
PLATFORM: ResidualVault — SaaS subscription + course sales + affiliate commissions

Perform a comprehensive revenue analysis:
1. Current MRR health assessment and trends
2. Revenue stream diversification analysis
3. Conversion funnel bottlenecks
4. Churn risk indicators
5. Upsell/cross-sell opportunities
6. Seasonal revenue patterns
7. 30/60/90 day revenue forecast

Output JSON:
{
  "reportDate": "${today}",
  "mrrHealth": { "status": "growing|stable|declining", "trend": "string", "concern": "string|null" },
  "revenueStreams": [
    { "stream": "string", "estimatedContribution": "string", "trend": "up|stable|down", "action": "string" }
  ],
  "funnelBottlenecks": [{ "stage": "string", "issue": "string", "impact": "string", "fix": "string" }],
  "churnRisks": [{ "segment": "string", "riskLevel": "low|medium|high", "intervention": "string" }],
  "opportunities": [{ "opportunity": "string", "estimatedImpact": "string", "effort": "low|medium|high", "priority": 1-10 }],
  "forecast": {
    "next30Days":  { "scenario": "string", "low": "string", "mid": "string", "high": "string" },
    "next60Days":  { "scenario": "string", "low": "string", "mid": "string", "high": "string" },
    "next90Days":  { "scenario": "string", "low": "string", "mid": "string", "high": "string" }
  },
  "topPriorityActions": ["string"],
  "executiveSummary": "string"
}
`);
  }

  async detectAnomalies() {
    return this.ask(`
Analyse potential revenue anomalies for ResidualVault.

Check for:
1. Sudden drop in subscription renewals
2. Unusual spike in refund requests
3. Payment failure rate increase
4. Traffic without conversion (high-visit, zero-revenue days)
5. Affiliate revenue discrepancies
6. Pricing page bounce rate anomalies

Output JSON:
{
  "anomaliesDetected": boolean,
  "anomalies": [
    { "type": "string", "severity": "low|medium|high|critical", "description": "string", "immediateAction": "string" }
  ],
  "normalMetrics": ["string"],
  "alertLevel": "green|yellow|orange|red"
}
`);
  }

  async execute(context = {}) {
    this._log('info', 'Running revenue intelligence analysis');

    const [trendsRaw, anomaliesRaw] = await Promise.all([
      this.analyseRevenueTrends(),
      this.detectAnomalies(),
    ]);

    const trends    = this.parseJSON(trendsRaw)    || {};
    const anomalies = this.parseJSON(anomaliesRaw) || {};

    // Alert on critical anomalies
    if (anomalies.anomaliesDetected && anomalies.anomalies) {
      for (const anomaly of anomalies.anomalies.filter(a => ['high', 'critical'].includes(a.severity))) {
        await this.reportIssue(
          anomaly.severity,
          `Revenue Anomaly: ${anomaly.type}`,
          `${anomaly.description} — Action: ${anomaly.immediateAction}`
        );
      }
    }

    if (anomalies.alertLevel === 'red' || anomalies.alertLevel === 'orange') {
      await this.reportIssue(
        anomalies.alertLevel === 'red' ? 'critical' : 'high',
        `Revenue Alert Level: ${anomalies.alertLevel.toUpperCase()}`,
        'Revenue anomalies detected. Immediate review required.'
      );
    }

    const priority = ['orange', 'red'].includes(anomalies.alertLevel) ? 'high' : 'normal';

    await this.saveReport(
      'revenue-intelligence',
      `Daily Revenue Intelligence — MRR: ${trends.mrrHealth?.status || 'N/A'}, Alert: ${anomalies.alertLevel || 'N/A'}`,
      JSON.stringify({ trends, anomalies }, null, 2),
      priority
    );

    return {
      mrrStatus:      trends.mrrHealth?.status,
      anomalyCount:   (anomalies.anomalies || []).length,
      alertLevel:     anomalies.alertLevel,
      topOpportunities: (trends.opportunities || []).slice(0, 3).map(o => o.opportunity),
    };
  }
}

module.exports = RevenueIntelligenceAgent;

if (require.main === module) {
  const agent = new RevenueIntelligenceAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
