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
    this.model     = config.model     || 'claude-opus-4-5';
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
    db.saveGeneratedContent(this.name, contentType, title, content, url, meta);
  }

  /**
   * Call the Claude API with a conversation.
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

    const response = await this.client.messages.create({
      model:      this.model,
      max_tokens: this.maxTokens,
      system,
      messages,
    });

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
    } catch {
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
      db.updateAgentMetrics(this.name, 'success', duration);
      this._log('complete', `Completed in ${duration}ms`);
      this.status = 'idle';
      return result;
    } catch (err) {
      const duration = Date.now() - t0;
      db.updateAgentMetrics(this.name, 'failed', duration);
      this._log('error', `Failed after ${duration}ms: ${err.message}`, { stack: err.stack });
      await this.reportIssue('high', `${this.name} Execution Error`, err.message);
      this.status = 'error';
      throw err;
    } finally {
      this.isRunning = false;
    }
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
