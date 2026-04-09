'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Anthropic = require('@anthropic-ai/sdk');
const winston   = require('winston');
const fs        = require('fs');
const path      = require('path');
const db        = require('../db');

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
   * @param {number} [config.maxTokens] - Max tokens per Claude call
   */
  constructor(config) {
    this.name      = config.name;
    this.role      = config.role;
    this.model     = config.model     || 'claude-opus-4-5';
    this.schedule  = config.schedule  || '0 * * * *';
    this.maxTokens = config.maxTokens || 4096;

    this.isRunning = false;
    this.lastRun   = null;
    this.status    = 'idle';

    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

  /** Persist generated content (images, videos, copy, etc.) */
  async saveContent(contentType, title, content, url = null, metadata = null) {
    db.saveGeneratedContent(this.name, contentType, title, content, url, metadata);
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
   * Parse JSON safely from Claude output.
   * @param {string} text
   * @returns {object|null}
   */
  parseJSON(text) {
    try {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
      return JSON.parse(match[1].trim());
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
      model:     this.model,
    };
  }
}

module.exports = BaseAgent;
