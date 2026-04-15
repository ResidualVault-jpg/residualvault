'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class CrisisResponseAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Crisis Response Agent',
      role:      'You are the Crisis Management Director for ResidualVault. You proactively monitor for threats to brand reputation, prepare crisis response playbooks, and lead rapid response when issues arise. You protect the brand with speed, clarity, and empathy.',
      model:     'claude-opus-4-6',
      schedule:  '*/15 * * * *', // Every 15 minutes
      maxTokens: 4096,
    });

    this.crisisThreshold = 3; // Number of high-severity alerts before escalating
  }

  async monitorThreatSignals() {
    const recentAlerts = await db.getOpenAlerts();
    const allLogs = await db.getRecentLogs(50);
    const recentErrors = allLogs.filter(l => l.type === 'error' || l.status === 'error');

    const criticalAlerts = recentAlerts.filter(a => a.severity === 'critical');
    const highAlerts     = recentAlerts.filter(a => a.severity === 'high');

    return this.ask(`
You are the Crisis Response Director conducting a threat assessment for ResidualVault.

CURRENT SYSTEM STATE:
- Open alerts: ${recentAlerts.length} total (${criticalAlerts.length} critical, ${highAlerts.length} high)
- Recent errors in last 50 logs: ${recentErrors.length}
- Critical alert details: ${JSON.stringify(criticalAlerts.slice(0, 3).map(a => ({ title: a.title, message: a.message })))}

THREAT CATEGORIES TO ASSESS:
1. Technical crisis (system down, data breach, payment failure)
2. Reputational crisis (negative press, viral complaint, influencer call-out)
3. Legal crisis (lawsuit, regulatory action, GDPR violation)
4. Operational crisis (team issue, supply disruption)
5. Financial crisis (revenue crash, churn spike)

Output JSON:
{
  "threatLevel": "green|yellow|orange|red",
  "activeCrises": [
    { "type": "string", "severity": "low|medium|high|critical", "description": "string", "immediateAction": "string", "owner": "string" }
  ],
  "potentialThreats": [
    { "type": "string", "probability": "low|medium|high", "description": "string", "preventiveAction": "string" }
  ],
  "recommendedActions": ["string"],
  "escalationRequired": boolean,
  "monitoringFocus": ["string"]
}
`);
  }

  async generateCrisisPlaybook(crisisType) {
    return this.ask(`
Create a crisis response playbook for ResidualVault for: "${crisisType}"

Include:
1. Immediate response checklist (first 30 minutes)
2. Internal communication template
3. Public statement draft (social media + website)
4. Customer email template
5. Stakeholder notification plan
6. Recovery milestones (24h, 72h, 7-day)
7. Post-crisis review framework

Output JSON:
{
  "crisisType": "${crisisType}",
  "severity": "string",
  "immediateChecklist": [{ "step": number, "action": "string", "owner": "string", "timeframe": "string" }],
  "internalComms": { "subject": "string", "body": "string" },
  "publicStatement": { "social": "string", "website": "string" },
  "customerEmail": { "subject": "string", "body": "string" },
  "stakeholderPlan": [{ "stakeholder": "string", "method": "string", "message": "string", "timing": "string" }],
  "recoveryMilestones": [{ "timeframe": "string", "goal": "string", "successMetric": "string" }],
  "lessonsLearned": "string"
}
`);
  }

  async execute(context = {}) {
    const assessmentRaw = await this.monitorThreatSignals();
    const assessment    = this.parseJSON(assessmentRaw) || {};

    const threatLevel   = assessment.threatLevel || 'green';
    const activeCrises  = assessment.activeCrises || [];

    // Always log assessment
    this._log('info', `Threat level: ${threatLevel}, Active crises: ${activeCrises.length}`);

    // Escalate if red or multiple critical alerts
    if (threatLevel === 'red' || threatLevel === 'orange') {
      await this.reportIssue(
        threatLevel === 'red' ? 'critical' : 'high',
        `Crisis Alert — ${threatLevel.toUpperCase()} Threat Level`,
        assessment.recommendedActions?.join(' | ') || 'Immediate review required'
      );

      // Generate playbooks for active crises
      for (const crisis of activeCrises.filter(c => c.severity === 'critical').slice(0, 2)) {
        const playbookRaw = await this.generateCrisisPlaybook(crisis.type);
        const playbook    = this.parseJSON(playbookRaw) || {};
        await this.saveContent(
          'crisis-playbook',
          `Crisis Playbook: ${crisis.type}`,
          JSON.stringify(playbook, null, 2),
          null,
          { severity: crisis.severity, generatedAt: new Date().toISOString() }
        );
      }
    }

    // Save assessment (only write report if not green to reduce noise)
    if (threatLevel !== 'green') {
      await this.saveReport(
        'crisis-assessment',
        `Crisis Assessment — Threat: ${threatLevel.toUpperCase()}, Crises: ${activeCrises.length}`,
        JSON.stringify(assessment, null, 2),
        ['orange', 'red'].includes(threatLevel) ? 'high' : 'normal'
      );
    }

    return { threatLevel, activeCrises: activeCrises.length, escalated: assessment.escalationRequired };
  }
}

module.exports = CrisisResponseAgent;

if (require.main === module) {
  const agent = new CrisisResponseAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
