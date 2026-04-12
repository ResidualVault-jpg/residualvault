'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class CybersecurityAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Cybersecurity Agent',
      role:      'You are a cybersecurity expert specializing in web application security, threat detection, and incident response. Your mission is to proactively identify vulnerabilities, monitor for suspicious activity, and protect ResidualVault\'s digital assets and user data.',
      model:     'claude-opus-4-5',
      schedule:  '15 11 * * 0',   // Every hour
      timezone:  'America/Denver',
      maxTokens: 4096,
    });
  }

  async execute(context = {}) {
    this._log('info', 'Running security audit cycle');

    // Gather internal metrics from DB
    const recentErrors = db.getRecentLogs(200).filter(l => l.type === 'error');
    const recentAlerts = db.getOpenAlerts();

    const prompt = `
You are conducting a comprehensive security audit for ResidualVault.

**Current System State:**
- Recent error count (last 200 log entries): ${recentErrors.length}
- Open alerts: ${recentAlerts.length}
- Error patterns: ${JSON.stringify(recentErrors.slice(0, 10).map(e => ({ agent: e.agent_name, msg: e.message.substring(0, 100) })))}

**Security Audit Tasks:**
1. Analyze error patterns for potential security indicators (brute force, injection attempts, auth failures)
2. Assess API key exposure risks based on error messages
3. Evaluate rate limiting needs based on agent execution patterns
4. Check for anomalous agent behavior patterns
5. Generate a prioritized list of security recommendations

**Output JSON:**
{
  "threatLevel": "low|medium|high|critical",
  "findings": [
    { "category": "string", "severity": "low|medium|high|critical", "description": "string", "recommendation": "string" }
  ],
  "immediateActions": ["string"],
  "securityScore": 0-100,
  "summary": "string"
}
`.trim();

    const raw    = await this.ask(prompt);
    const report = this.parseJSON(raw) || { threatLevel: 'unknown', summary: raw.substring(0, 500) };

    const priority = ['high', 'critical'].includes(report.threatLevel) ? 'high' : 'normal';

    await this.saveReport(
      'security-audit',
      `Security Audit — Threat Level: ${(report.threatLevel || 'N/A').toUpperCase()}`,
      JSON.stringify(report, null, 2),
      priority
    );

    // Alert if threat level is elevated
    if (['high', 'critical'].includes(report.threatLevel)) {
      await this.reportIssue(
        report.threatLevel,
        'Elevated Security Threat Detected',
        report.summary || 'Security audit flagged high-risk conditions. Review the security report immediately.'
      );
    }

    // Alert on any critical findings
    if (report.findings) {
      for (const finding of report.findings.filter(f => f.severity === 'critical')) {
        await this.reportIssue(
          'critical',
          `Critical Security Finding: ${finding.category}`,
          finding.description
        );
      }
    }

    this._log('info', `Security audit complete — Threat level: ${report.threatLevel}, Score: ${report.securityScore}`);
    return report;
  }
}

module.exports = CybersecurityAgent;

if (require.main === module) {
  const agent = new CybersecurityAgent();
  agent.run().then(r => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(e => { console.error(e); process.exit(1); });
}
