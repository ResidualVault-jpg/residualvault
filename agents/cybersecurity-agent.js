'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db        = require('../db');

class CybersecurityAgent extends BaseAgent {
  constructor() {
    super({
      name:      'Cybersecurity Agent',
      role:      'You are a cybersecurity expert specializing in web application security, threat detection, and incident response. Your mission is to proactively identify vulnerabilities, monitor for suspicious activity, and protect ResidualVault\'s digital assets and user data.',
      model:     'claude-opus-4-6',
      schedule:  '15 11 * * 0',   // Every hour
      timezone:  'America/Denver',
      maxTokens: 4096,
    });
  }


  async reviewSubAgentWork() {
    const result = await db.query(
      "SELECT id, agent_name, content_type, title, content, metadata FROM generated_content WHERE metadata->>'department_head' = $1 AND metadata->>'status' = $2 ORDER BY created_at ASC",
      [this.name, 'awaiting_dept_review']
    );
    const pending = result.rows;
    if (pending.length === 0) {
      this._log('info', 'No sub-agent security reports to review');
      return { reviewed: 0, approved: 0, revised: 0 };
    }
    this._log('info', 'Reviewing ' + pending.length + ' security reports from sub-agents');
    let approved = 0, revised = 0;
    for (const item of pending) {
      let contentStr = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
      let meta = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : (item.metadata || {});
      try {
        const reviewResult = await this.ask(
          'You are the Chief Security Officer reviewing a security report from your team.\n' +
          'Sub-agent: ' + item.agent_name + '\n' +
          'Report title: ' + item.title + '\n' +
          'Content:\n' + contentStr.substring(0, 3000) + '\n\n' +
          'Review for:\n' +
          '1. Accuracy of threat assessments\n' +
          '2. Completeness of coverage\n' +
          '3. Actionability of recommendations\n' +
          '4. Priority accuracy (are critical items truly critical?)\n' +
          '5. Any missed angles or blind spots\n\n' +
          'Output JSON:\n' +
          '{"approved": true/false, "score": 1-10, "feedback": "string", "additionalFindings": "string or null"}'
        );
        const review = this.parseJSON(reviewResult) || { approved: true, score: 7 };
        if (review.approved !== false && (review.score || 7) >= 5) {
          meta.status = 'pending_review';
          meta.dept_review = { approved: true, score: review.score, feedback: review.feedback, reviewedAt: new Date().toISOString() };
          await db.query('UPDATE generated_content SET metadata = $1 WHERE id = $2', [JSON.stringify(meta), item.id]);
          approved++;
        } else {
          meta.status = 'revision_needed';
          meta.dept_review = { approved: false, score: review.score, feedback: review.feedback, reviewedAt: new Date().toISOString() };
          await db.query('UPDATE generated_content SET metadata = $1 WHERE id = $2', [JSON.stringify(meta), item.id]);
          revised++;
        }
      } catch (err) {
        this._log('error', 'Review failed for ' + item.title + ': ' + err.message);
        meta.status = 'pending_review';
        meta.dept_review = { approved: true, autoApproved: true, error: err.message };
        await db.query('UPDATE generated_content SET metadata = $1 WHERE id = $2', [JSON.stringify(meta), item.id]);
        approved++;
      }
    }
    return { reviewed: pending.length, approved, revised };
  }

  async execute(context = {}) {
    // Step 1: Review sub-agent security reports
    const reviewResult = await this.reviewSubAgentWork();
    this._log('info', 'Sub-agent review: ' + reviewResult.approved + ' approved, ' + reviewResult.revised + ' need revision');

    // Step 2: Run own security audit
    this._log('info', 'Running security audit cycle');

    // Gather internal metrics from DB
    const allLogs = await db.getRecentLogs(200);
    const recentErrors = allLogs.filter(l => l.type === 'error' || l.status === 'error');
    const recentAlerts = await db.getOpenAlerts();

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
