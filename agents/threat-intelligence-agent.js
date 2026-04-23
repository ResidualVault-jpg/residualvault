'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseSubAgent = require('./base-sub-agent');
const db = require('../db');

class ThreatIntelligenceAgent extends BaseSubAgent {
  constructor() {
    super({
      name:           'Threat Intelligence Agent',
      departmentHead: 'Cybersecurity Agent',
      role:           'You are a threat intelligence analyst. You monitor external threat landscapes, track CVEs affecting the tech stack, analyze attack patterns targeting crypto platforms, and provide early warning intelligence for ResidualVault.',
      model:          'claude-sonnet-4-6',
      schedule:       '45 11 * * 0',
      timezone:       'America/Denver',
      maxTokens:      4096,
    });
  }

  async execute(context = {}) {
    this._log('info', 'Running threat intelligence analysis');

    var allLogs = await db.getRecentLogs(100);
    var suspiciousActivity = allLogs.filter(function(l) {
      var msg = (l.message || '').toLowerCase();
      return msg.indexOf('unauthorized') > -1 || msg.indexOf('403') > -1 || msg.indexOf('brute') > -1 || msg.indexOf('injection') > -1 || msg.indexOf('suspicious') > -1;
    });

    var raw = await this.ask(
      'You are conducting a threat intelligence analysis for ResidualVault, a cryptocurrency staking comparison platform.\n' +
      'Tech stack: Node.js 20, Express, PostgreSQL, Redis, Nginx, Ubuntu 24.04\n' +
      'Dependencies: Stripe, HeyGen API, YouTube API, Twitter API, LinkedIn API, Anthropic API, Google Gemini API\n' +
      'Suspicious log entries found: ' + suspiciousActivity.length + '\n\n' +
      'Analyze and report on:\n' +
      '1. CVE MONITORING: Known vulnerabilities in Node.js 20, Express, PostgreSQL 16, Redis 7, Nginx, npm packages\n' +
      '2. CRYPTO PLATFORM THREATS: Recent attack patterns targeting DeFi/staking platforms (phishing, DNS hijacking, API key theft, smart contract exploits)\n' +
      '3. API SECURITY: Third-party API key exposure risks, webhook spoofing, OAuth token theft\n' +
      '4. SUPPLY CHAIN: npm dependency risks, typosquatting, compromised packages\n' +
      '5. SOCIAL ENGINEERING: Risks from public social media presence, employee impersonation, support channel phishing\n' +
      '6. REGULATORY: Data privacy compliance gaps (GDPR, CCPA) for a crypto platform handling user data\n\n' +
      'Output JSON:\n' +
      '{"threatLevel": "low|medium|high|critical", "securityScore": 1-100, "summary": "string", ' +
      '"threats": [{"category": "string", "severity": "low|medium|high|critical", "threat": "string", "mitigation": "string", "urgency": "immediate|short-term|long-term"}], ' +
      '"watchlist": ["string"]}'
    );

    var report = this.parseJSON(raw) || { threatLevel: 'unknown', summary: raw.substring(0, 500) };

    await this.saveContent(
      'security-report',
      'Threat Intelligence Report - Threat Level: ' + (report.threatLevel || 'N/A').toUpperCase(),
      JSON.stringify(report, null, 2),
      null,
      { scanType: 'threat-intelligence', threatLevel: report.threatLevel, securityScore: report.securityScore }
    );

    this._log('info', 'Threat intel complete - Threat level: ' + report.threatLevel + ', Score: ' + report.securityScore);
    return { threatLevel: report.threatLevel, score: report.securityScore, threats: (report.threats || []).length };
  }
}

module.exports = ThreatIntelligenceAgent;

if (require.main === module) {
  var agent = new ThreatIntelligenceAgent();
  agent.run().then(function(r) { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(function(e) { console.error(e); process.exit(1); });
}
