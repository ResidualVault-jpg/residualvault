'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Anthropic = require('@anthropic-ai/sdk');
const winston   = require('winston');
const fs        = require('fs');
const path      = require('path');
const db        = require('../db');

// Proxy support: honour HTTPS_PROXY / HTTP_PROXY / GLOBAL_AGENT_HTTP_PROXY
function _buildAnthropicClient(apiKey) {
  const proxyUrl = process.env.HTTPS_PROXY
                || process.env.HTTP_PROXY
                || process.env.GLOBAL_AGENT_HTTP_PROXY
                || '';
  if (proxyUrl) {
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      return new Anthropic({ apiKey, httpAgent: new HttpsProxyAgent(proxyUrl) });
    } catch (_) { /* fall through to plain client */ }
  }
  return new Anthropic({ apiKey });
}

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

class BaseAgent {
  /**
   * @param {object} config
   * @param {string} config.name        - Display name
   * @param {string} config.role        - Role description for system prompt
   * @param {string} [config.model]     - Claude model ID
   * @param {string} [config.schedule]  - node-cron expression
   * @param {string} [config.timezone]  - IANA timezone for the cron job (default: America/New_York)
   * @param {number} [config.maxTokens] - Max tokens per Claude call
   */
  constructor(config) {
    this.name      = config.name;
    this.role      = config.role;
    this.model     = config.model     || 'claude-opus-4-6';
    this.schedule  = config.schedule  || '0 * * * *';
    this.timezone  = config.timezone  || 'America/New_York';
    this.maxTokens = config.maxTokens || 4096;

    this.isRunning = false;
    this.lastRun   = null;
    this.status    = 'idle';

    this.client = _buildAnthropicClient(process.env.ANTHROPIC_API_KEY);

    const logFile = path.join(logsDir, `${this.name.toLowerCase().replace(/[\s/&]+/g, '-')}.log`);
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) =>
          `[${timestamp}] [${this.name}] ${level.toUpperCase()}: ${message}`
        )
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: logFile, maxsize: 5242880, maxFiles: 3 }),
      ],
    });
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _log(type, message, data = null) {
    const level = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'info';
    this.logger[level](message);
    db.logAgentActivity(this.name, type, message, data);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Log info-level activity to DB + file */
  async log(type, message, data = null) {
    this._log(type, message, data);
  }

  /** Create an alert visible on the rv-control dashboard */
  async reportIssue(severity, title, message) {
    this.logger.warn(`ALERT [${severity.toUpperCase()}]: ${title}`);
    db.createAlert(this.name, severity, title, message);
  }

  /** Save a structured report to the DB */
  async saveReport(reportType, title, content, priority = 'normal') {
    db.saveReport(this.name, reportType, title, content, priority);
    this._log('report', `Saved ${priority} report: ${title}`);
  }

  /**
   * Persist generated content (images, videos, copy, etc.).
   * Automatically sets metadata.status = 'pending_review' so all content
   * lands in the Sunday review queue. Callers may override by passing
   * { status: 'processing' } (e.g. video agent) or any other value.
   */
  async saveContent(contentType, title, content, url = null, metadata = null) {
    const meta = (metadata && typeof metadata === 'object') ? { ...metadata } : {};
    if (!meta.status) meta.status = 'pending_review';
    // Parse content if it's a JSON string so it saves properly
    let contentToSave = content;
    try { contentToSave = JSON.parse(content); } catch(_) { contentToSave = content; }
    await db.saveGeneratedContent(this.name, contentType, title, contentToSave, url, meta);
  }

  /**
   * Call the Claude API with a conversation.
   * Includes a timeout to prevent hanging calls from blocking the agent.
   * @param {Array}  messages       - Anthropic messages array
   * @param {string} [systemOverride] - Override default system prompt
   * @returns {string} - Assistant text response
   */
  async chat(messages, systemOverride = null) {
    const system = systemOverride || (
      `You are the ${this.name} for ResidualVault, a digital marketing and passive income platform. ` +
      `${this.role} ` +
      `Always be specific, data-driven, and actionable. Output valid JSON when requested.`
    );

    const timeoutMs = (this.maxTokens > 4096) ? 300000 : 180000; // 5 min for large, 3 min for normal

    const apiPromise = this.client.messages.create({
      model:      this.model,
      max_tokens: this.maxTokens,
      system,
      messages,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Claude API call timed out after ${timeoutMs / 1000}s`)), timeoutMs)
    );

    const response = await Promise.race([apiPromise, timeoutPromise]);
    return response.content[0].text;
  }

  /**
   * Convenience: single-turn prompt to Claude.
   * @param {string} prompt
   * @param {string} [system]
   */
  async ask(prompt, system = null) {
    return this.chat([{ role: 'user', content: prompt }], system);
  }

  /**
   * Parse JSON safely from Claude output (handles code blocks and bare JSON).
   * @param {string} text
   * @returns {any|null}
   */
  parseJSON(text) {
    if (!text) return null;
    try {
      // 1. Try fenced code block: ```json ... ```
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) return JSON.parse(fenced[1].trim());
      // 2. Try raw JSON starting with { or [
      const raw = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (raw) return JSON.parse(raw[1].trim());
      // 3. Full string as JSON
      return JSON.parse(text.trim());
    } catch (err) {
      if (this.logger) this.logger.warn('parseJSON failed: ' + err.message + ' (response length: ' + (text ? text.length : 0) + ')');
      return null;
    }
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Must be overridden by each agent */
  async execute(context = {}) {
    throw new Error(`execute() must be implemented by ${this.name}`);
  }

  /** Called by the scheduler — wraps execute() with metrics + error handling */
  async run(context = {}) {
    if (this.isRunning) {
      this.logger.warn('Already running — skipping this tick');
      return { skipped: true, reason: 'already_running' };
    }

    this.isRunning = true;
    this.status    = 'running';
    this.lastRun   = new Date();
    const t0       = Date.now();

    this._log('start', 'Starting execution');

    try {
      const result   = await this.execute(context);
      const duration = Date.now() - t0;
      await db.updateAgentMetrics(this.name, { status: 'success', lastRun: new Date().toISOString(), duration, successCount: 1 });
      this._log('complete', `Completed in ${duration}ms`);
      this.status = 'idle';
      return result;
    } catch (err) {
      const duration = Date.now() - t0;
      await db.updateAgentMetrics(this.name, { status: 'failed', lastRun: new Date().toISOString(), duration, failCount: 1 });
      this._log('error', `Failed after ${duration}ms: ${err.message}`, { stack: err.stack });
      await this.reportIssue('high', `${this.name} Execution Error`, err.message);
      this.status = 'error';
      throw err;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Implement approved recommendations from a report.
   * Called when the owner clicks "Implement" on an alert in rv-control.
   * Sends the report back to Claude with instructions to execute, then
   * takes action through existing agent methods.
   */
  async implement(report, alertId) {
    this._log('info', `Implementing approved recommendations (alert ${alertId})`);
    const t0 = Date.now();

    const reportStr = typeof report === 'string' ? report : JSON.stringify(report, null, 2);

    // Parse nested report data if present
    let reportData = report;
    if (report && report.data && typeof report.data === 'string') {
      try { reportData = JSON.parse(report.data); } catch (_) { reportData = report; }
    }

    const systemPrompt =
      `You are the ${this.name} for ResidualVault. ${this.role} ` +
      `The platform owner has reviewed and APPROVED your recommendations below. ` +
      `You must now execute them. Produce a JSON implementation plan.`;

    const userPrompt =
      `APPROVED REPORT — IMPLEMENT NOW:\n${reportStr.substring(0, 12000)}\n\n` +
      `Generate a JSON implementation plan. IMPORTANT: Keep total response under 7000 tokens.\n` +
      `For each recommendation:\n` +
      `1. Determine the action type: "schedule_post", "update_content", "create_content", "configuration", or "advisory"\n` +
      `2. For schedule_post: include full post text (max 1500 chars per post)\n` +
      `3. For create_content: include a summary/outline, not the full body\n` +
      `4. Focus on the TOP 5 most impactful actions if there are many\n\n` +
      `Response format:\n` +
      `{\n` +
      `  "actions": [\n` +
      `    {\n` +
      `      "type": "schedule_post",\n` +
      `      "platform": "linkedin|twitter|instagram|youtube|email",\n` +
      `      "content": "full post text",\n` +
      `      "hashtags": ["tag1"],\n` +
      `      "scheduled_date": "YYYY-MM-DD",\n` +
      `      "reason": "why this action"\n` +
      `    },\n` +
      `    {\n` +
      `      "type": "create_content",\n` +
      `      "content_type": "blog-post|email-newsletter|social-posts|ad-campaign",\n` +
      `      "title": "content title",\n` +
      `      "body": "full content body",\n` +
      `      "reason": "why this action"\n` +
      `    },\n` +
      `    {\n` +
      `      "type": "advisory",\n` +
      `      "recommendation": "what to do",\n` +
      `      "reason": "why this cannot be auto-executed"\n` +
      `    }\n` +
      `  ],\n` +
      `  "summary": "1-2 sentence summary of all actions taken"\n` +
      `}`;

    // Use higher token limit for implementation plans
    const savedMaxTokens = this.maxTokens;
    this.maxTokens = 8000;
    let response;
    try {
      response = await this.chat([{ role: 'user', content: userPrompt }], systemPrompt);
    } finally {
      this.maxTokens = savedMaxTokens;
    }
    const plan = this.parseJSON(response);

    if (!plan || !plan.actions || !Array.isArray(plan.actions)) {
      this._log('error', 'Failed to parse implementation plan');
      await this.saveReport('implementation', 'Implementation Failed — ' + this.name, JSON.stringify({
        error: 'Could not parse implementation plan from Claude response',
        rawResponse: response.substring(0, 3000),
        alertId
      }, null, 2));
      return { success: false, error: 'parse_failed' };
    }

    const results = { scheduled: 0, created: 0, advisory: 0, failed: 0, details: [] };

    for (const action of plan.actions) {
      try {
        if (action.type === 'schedule_post' && action.platform && action.content) {
          const schedDate = action.scheduled_date || new Date(Date.now() + 86400000).toISOString().split('T')[0];
          await db.query(
            `INSERT INTO content_posts (platform, content, status, scheduled_date, hashtags)
             VALUES ($1, $2, 'approved', $3, $4)`,
            [action.platform.toLowerCase(), action.content, schedDate, JSON.stringify(action.hashtags || [])]
          );
          results.scheduled++;
          results.details.push({ type: 'scheduled', platform: action.platform, date: schedDate, reason: action.reason });

        } else if (action.type === 'create_content' && action.body) {
          await this.saveContent(
            action.content_type || 'general',
            action.title || 'Implemented: ' + (action.reason || '').substring(0, 60),
            typeof action.body === 'string' ? action.body : JSON.stringify(action.body),
            null,
            { status: 'pending_review', implemented_from_alert: alertId, agent: this.name }
          );
          results.created++;
          results.details.push({ type: 'created', contentType: action.content_type, title: action.title, reason: action.reason });

        } else if (action.type === 'advisory') {
          results.advisory++;
          results.details.push({ type: 'advisory', recommendation: action.recommendation, reason: action.reason });

        } else {
          results.details.push({ type: action.type || 'unknown', action, note: 'Logged for manual review' });
        }
      } catch (err) {
        results.failed++;
        results.details.push({ type: 'error', action: action.type, error: err.message });
        this._log('error', 'Implementation action failed: ' + err.message);
      }
    }

    // Resolve the alert
    await db.query(
      `UPDATE system_alerts SET resolved = true,
       details = COALESCE(details, '{}'::jsonb) || jsonb_build_object(
         'resolved_by'::text, 'owner-approved-implementation'::text,
         'resolved_at'::text, $1::text,
         'implementation_results'::text, $2::text
       ) WHERE id = $3`,
      [new Date().toISOString(), JSON.stringify(results), alertId]
    );

    // Save implementation report
    await this.saveReport('implementation', 'Implemented: ' + (plan.summary || this.name + ' recommendations'), JSON.stringify({
      alertId,
      summary: plan.summary,
      scheduled: results.scheduled,
      created: results.created,
      advisory: results.advisory,
      failed: results.failed,
      details: results.details,
      timestamp: new Date().toISOString()
    }, null, 2));

    // Log as visible content in rv-control
    const implSummary = `Scheduled: ${results.scheduled} posts, Created: ${results.created} content items` +
      (results.advisory > 0 ? `, Advisory: ${results.advisory} (need manual action)` : '') +
      (results.failed > 0 ? `, Failed: ${results.failed}` : '');

    await this.saveContent(
      'implementation_report',
      'IMPLEMENTED: ' + this.name + ' recommendations',
      '## Implementation Report\n\n' +
      '**Agent:** ' + this.name + '\n' +
      '**Alert:** #' + alertId + '\n' +
      '**Summary:** ' + (plan.summary || 'N/A') + '\n\n' +
      '### Results\n' + implSummary + '\n\n' +
      '### Actions Taken\n' +
      results.details.map((d, i) => '**' + (i + 1) + '.** [' + d.type.toUpperCase() + '] ' + (d.reason || d.recommendation || d.error || JSON.stringify(d))).join('\n') + '\n',
      null,
      { status: 'implemented', alertId, agent: this.name }
    );

    const duration = Date.now() - t0;
    this._log('info', `Implementation complete in ${duration}ms: ${implSummary}`);

    return { success: true, ...results, summary: plan.summary };
  }

  /** Returns current agent status object */
  getStatus() {
    return {
      name:      this.name,
      role:      this.role,
      status:    this.status,
      isRunning: this.isRunning,
      lastRun:   this.lastRun,
      schedule:  this.schedule,
      timezone:  this.timezone,
      model:     this.model,
    };
  }
}

module.exports = BaseAgent;
