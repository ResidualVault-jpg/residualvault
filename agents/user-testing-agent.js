'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const BaseAgent = require('./base-agent');
const https = require('https');
const http = require('http');
const db = require('../db');

const BASE_URL = 'https://residualvault.com';
const API_BASE = 'https://residualvault.com/api/v1';

const PAGES = [
  { name: 'Homepage', path: '/' },
  { name: 'Staking Options', path: '/staking' },
  { name: 'Leaderboard', path: '/leaderboard' },
  { name: 'Education Hub', path: '/education' },
  { name: 'Blog', path: '/blog' },
  { name: 'Calculator', path: '/calculator' },
  { name: 'Pricing', path: '/pricing' },
  { name: 'Contact', path: '/contact' },
  { name: 'Login', path: '/login' },
  { name: 'Register', path: '/register' },
  { name: 'Privacy Policy', path: '/privacy' },
  { name: 'Terms', path: '/terms' },
];

class UserTestingAgent extends BaseAgent {
  constructor() {
    super({
      name: 'User Testing Agent',
      role: 'You act as a real user and test every function on the ResidualVault website and API. You report all errors, broken pages, and failed endpoints to the Fixer Agent.',
      model: 'claude-sonnet-4-6',
      schedule: '0 6 * * *',
      timezone: 'America/Denver',
      maxTokens: 4096,
    });
  }

  _httpCheck(url) {
    return new Promise(function(resolve) {
      var mod = url.startsWith('https') ? https : http;
      var req = mod.get(url, { timeout: 15000 }, function(res) {
        var body = '';
        res.on('data', function(c) { body += c; });
        res.on('end', function() { resolve({ status: res.statusCode, body: body }); });
      });
      req.on('error', function(e) { resolve({ status: 0, error: e.message }); });
      req.on('timeout', function() { req.destroy(); resolve({ status: 0, error: 'Timeout' }); });
    });
  }

  async checkPages() {
    var results = [];
    for (var i = 0; i < PAGES.length; i++) {
      var page = PAGES[i];
      var res = await this._httpCheck(BASE_URL + page.path);
      if (res.status >= 200 && res.status < 400) {
        results.push({ page: page.name, path: page.path, status: 'OK', code: res.status });
      } else {
        results.push({ page: page.name, path: page.path, status: 'FAIL', code: res.status, issue: res.error || 'HTTP ' + res.status });
      }
    }
    return results;
  }

  async checkAPIs() {
    var endpoints = [
      { name: 'Protocols List', url: BASE_URL + '/api/protocols' },
      { name: 'Protocols All', url: BASE_URL + '/api/protocols/all' },
      { name: 'Rewards', url: BASE_URL + '/api/rewards' },
      { name: 'Health', url: BASE_URL + '/health' },
    ];
    var results = [];
    for (var i = 0; i < endpoints.length; i++) {
      var ep = endpoints[i];
      var res = await this._httpCheck(ep.url);
      if (res.status === 200) {
        results.push({ name: ep.name, url: ep.url, status: 'OK' });
      } else {
        results.push({ name: ep.name, url: ep.url, status: 'FAIL', issue: res.error || 'HTTP ' + res.status });
      }
    }
    return results;
  }

  async checkServices() {
    var results = [];
    var services = ['rv-api', 'rv-scheduler', 'rv-control'];
    for (var i = 0; i < services.length; i++) {
      try {
        var { execSync } = require('child_process');
        var out = execSync('pm2 jlist 2>/dev/null').toString();
        var list = JSON.parse(out);
        var svc = list.find(function(p) { return p.name === services[i]; });
        if (svc && svc.pm2_env.status === 'online') {
          results.push({ service: services[i], status: 'OK' });
        } else {
          results.push({ service: services[i], status: 'FAIL', issue: svc ? svc.pm2_env.status : 'not found' });
        }
      } catch(e) {
        results.push({ service: services[i], status: 'FAIL', issue: e.message });
      }
    }
    return results;
  }

  async execute(context) {
    this._log('info', 'Running full site QA test');

    var pageResults = await this.checkPages();
    var apiResults = await this.checkAPIs();
    var serviceResults = await this.checkServices();

    var failedPages = pageResults.filter(function(r) { return r.status === 'FAIL'; });
    var failedAPIs = apiResults.filter(function(r) { return r.status === 'FAIL'; });
    var failedServices = serviceResults.filter(function(r) { return r.status === 'FAIL'; });
    var totalIssues = failedPages.length + failedAPIs.length + failedServices.length;

    var report = {
      timestamp: new Date().toISOString(),
      summary: {
        pagesChecked: PAGES.length, pagesFailed: failedPages.length,
        apisChecked: 4, apisFailed: failedAPIs.length,
        servicesFailed: failedServices.length,
        totalIssues: totalIssues,
      },
      issues: { pages: failedPages, apis: failedAPIs, services: failedServices },
      passing: {
        pages: pageResults.filter(function(r) { return r.status === 'OK'; }).map(function(r) { return r.page; }),
        apis: apiResults.filter(function(r) { return r.status === 'OK'; }).map(function(r) { return r.name; }),
      },
    };

    // Save to qa_reports table for Fixer Agent
    try {
      await db.query('CREATE TABLE IF NOT EXISTS qa_reports (id SERIAL PRIMARY KEY, report JSONB, status VARCHAR(20) DEFAULT \'pending\', created_at TIMESTAMP DEFAULT NOW(), fixed_at TIMESTAMP)');
      await db.query('INSERT INTO qa_reports (report) VALUES ($1)', [JSON.stringify(report)]);
    } catch(e) { this._log('error', 'Failed to save QA report: ' + e.message); }

    var priority = totalIssues > 3 ? 'high' : 'normal';
    await this.saveReport('qa-test', 'QA Test - ' + totalIssues + ' issues found (' + PAGES.length + ' pages, 4 APIs, 3 services checked)', JSON.stringify(report, null, 2), priority);

    if (totalIssues > 0) {
      this._log('warn', 'Found ' + totalIssues + ' issues: ' + failedPages.length + ' pages, ' + failedAPIs.length + ' APIs, ' + failedServices.length + ' services');
    } else {
      this._log('info', 'All checks passed');
    }

    return { totalIssues: totalIssues, pages: failedPages.length, apis: failedAPIs.length, services: failedServices.length };
  }
}

module.exports = UserTestingAgent;

if (require.main === module) {
  var agent = new UserTestingAgent();
  agent.run().then(function(r) { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
       .catch(function(e) { console.error(e); process.exit(1); });
}
