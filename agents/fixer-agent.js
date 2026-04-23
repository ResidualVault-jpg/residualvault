'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const db = require('../db');
const { execSync } = require('child_process');

class FixerAgent extends BaseAgent {
  constructor() {
    super({
      name: 'Fixer Agent',
      role: 'You automatically fix issues reported by the User Testing Agent. You restart crashed services, reload nginx, and escalate unfixable issues to the dashboard.',
      model: 'claude-sonnet-4-6',
      schedule: '30 6 * * *',
      timezone: 'America/Denver',
      maxTokens: 4096,
    });
  }

  async execute(context) {
    this._log('info', 'Checking for pending QA reports');

    var result;
    try {
      result = await db.query("SELECT * FROM qa_reports WHERE status='pending' ORDER BY created_at DESC LIMIT 1");
    } catch(e) {
      this._log('info', 'No qa_reports table or no pending reports');
      return { fixed: 0, unfixable: 0 };
    }

    var report = result.rows[0];
    if (report === undefined || report === null) {
      this._log('info', 'No pending QA reports');
      return { fixed: 0, unfixable: 0 };
    }

    var issues = report.report.issues || {};
    var totalIssues = report.report.summary ? report.report.summary.totalIssues : 0;

    if (totalIssues === 0) {
      this._log('info', 'No issues to fix');
      await db.query("UPDATE qa_reports SET status='processed', fixed_at=NOW() WHERE id=$1", [report.id]);
      return { fixed: 0, unfixable: 0 };
    }

    this._log('info', totalIssues + ' issues to address');
    var fixed = [];
    var unfixable = [];

    // Fix crashed PM2 services
    var services = issues.services || [];
    for (var i = 0; i < services.length; i++) {
      var s = services[i];
      try {
        execSync('pm2 restart ' + s.service + ' --update-env 2>/dev/null');
        fixed.push({ type: 'service', item: s.service, action: 'Restarted ' + s.service });
        this._log('info', 'Fixed: restarted ' + s.service);
      } catch(e) {
        unfixable.push({ type: 'service', item: s.service, issue: s.issue, reason: e.message });
      }
    }

    // Fix API/page 502 errors by restarting rv-api + nginx
    var apiAndPages = (issues.apis || []).concat(issues.pages || []);
    var restartedApi = false;
    for (var j = 0; j < apiAndPages.length; j++) {
      var item = apiAndPages[j];
      var issue = (item.issue || '').toLowerCase();
      if ((issue.indexOf('502') > -1 || issue.indexOf('server error') > -1 || issue.indexOf('econnrefused') > -1) && restartedApi === false) {
        try {
          execSync('pm2 restart rv-api --update-env 2>/dev/null');
          execSync('systemctl reload nginx 2>/dev/null');
          fixed.push({ type: 'api', item: item.name || item.page, action: 'Restarted rv-api + nginx' });
          restartedApi = true;
          this._log('info', 'Fixed: restarted rv-api + nginx');
        } catch(e) { unfixable.push({ type: 'api', item: item.name || item.page, issue: item.issue, reason: e.message }); }
      } else {
        unfixable.push({ type: 'api', item: item.name || item.page, issue: item.issue, reason: 'Requires manual investigation' });
      }
    }

    // Escalate unfixable issues to dashboard
    if (unfixable.length > 0) {
      try {
        for (var k = 0; k < unfixable.length; k++) {
          await db.query("INSERT INTO system_alerts (type, message, details) VALUES ($1, $2, $3)",
            ['QA_UNFIXABLE', unfixable[k].item + ': ' + (unfixable[k].issue || ''), JSON.stringify(unfixable[k])]);
        }
        this._log('warn', unfixable.length + ' unfixable issues sent to dashboard');
      } catch(e) { this._log('error', 'Failed to create alerts: ' + e.message); }
    }

    // Mark QA report as processed
    await db.query("UPDATE qa_reports SET status='processed', fixed_at=NOW(), report=report||$1 WHERE id=$2",
      [JSON.stringify({ fixResults: { fixed: fixed, unfixable: unfixable } }), report.id]);

    var priority = unfixable.length > 0 ? 'high' : 'normal';
    await this.saveReport('fixer', 'Fixer Report - ' + fixed.length + ' fixed, ' + unfixable.length + ' unfixable', JSON.stringify({ fixed: fixed, unfixable: unfixable }, null, 2), priority);

    this._log('info', 'Fixer complete: ' + fixed.length + ' fixed, ' + unfixable.length + ' unfixable');
    return { fixed: fixed.length, unfixable: unfixable.length };
  }
}

module.exports = FixerAgent;

if (require.main === module) {
  var agent = new FixerAgent();
  agent.run().then(function(r) { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(function(e) { console.error(e); process.exit(1); });
}
