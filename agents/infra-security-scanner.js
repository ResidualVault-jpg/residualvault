'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseSubAgent = require('./base-sub-agent');
const db = require('../db');

class InfraSecurityScanner extends BaseSubAgent {
  constructor() {
    super({
      name:           'Infrastructure Security Scanner',
      departmentHead: 'Cybersecurity Agent',
      role:           'You are an infrastructure security specialist. You audit server configurations, network exposure, SSL certificates, file permissions, firewall rules, and system hardening for ResidualVault.',
      model:          'claude-sonnet-4-6',
      schedule:       '30 11 * * 0',
      timezone:       'America/Denver',
      maxTokens:      4096,
    });
  }

  async execute(context = {}) {
    this._log('info', 'Running infrastructure security scan');

    var allLogs = await db.getRecentLogs(100);
    var systemErrors = allLogs.filter(function(l) { return l.type === 'error' && l.agent_name !== 'Cybersecurity Agent'; });

    var raw = await this.ask(
      'You are conducting an infrastructure security audit for ResidualVault.\n' +
      'Platform: Node.js on Ubuntu 24.04, DigitalOcean, Nginx reverse proxy, PostgreSQL, Redis, PM2\n' +
      'Recent system errors: ' + systemErrors.length + '\n\n' +
      'Analyze and report on:\n' +
      '1. SERVER HARDENING: SSH config, fail2ban, unattended upgrades, kernel updates\n' +
      '2. NETWORK EXPOSURE: Open ports, firewall (UFW) rules, exposed services\n' +
      '3. SSL/TLS: Certificate validity, HSTS headers, cipher suite strength\n' +
      '4. FILE PERMISSIONS: Sensitive files (.env, keys), directory permissions\n' +
      '5. DATABASE SECURITY: PostgreSQL auth, connection limits, backup encryption\n' +
      '6. PROCESS SECURITY: PM2 running as non-root, resource limits, log rotation\n' +
      '7. DEPENDENCY RISKS: Node.js version currency, npm audit findings\n\n' +
      'Output JSON:\n' +
      '{"threatLevel": "low|medium|high|critical", "securityScore": 1-100, "summary": "string", ' +
      '"findings": [{"category": "string", "severity": "low|medium|high|critical", "finding": "string", "recommendation": "string"}], ' +
      '"immediateActions": ["string"]}'
    );

    var report = this.parseJSON(raw) || { threatLevel: 'unknown', summary: raw.substring(0, 500) };

    await this.saveContent(
      'security-report',
      'Infrastructure Security Scan - Threat Level: ' + (report.threatLevel || 'N/A').toUpperCase(),
      JSON.stringify(report, null, 2),
      null,
      { scanType: 'infrastructure', threatLevel: report.threatLevel, securityScore: report.securityScore }
    );

    this._log('info', 'Infrastructure scan complete - Threat level: ' + report.threatLevel + ', Score: ' + report.securityScore);
    return { threatLevel: report.threatLevel, score: report.securityScore, findings: (report.findings || []).length };
  }
}

module.exports = InfraSecurityScanner;

if (require.main === module) {
  var agent = new InfraSecurityScanner();
  agent.run().then(function(r) { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(function(e) { console.error(e); process.exit(1); });
}
