'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'residualvault.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = 10000');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name  TEXT    NOT NULL,
    type        TEXT    NOT NULL,
    message     TEXT    NOT NULL,
    data        TEXT,
    timestamp   DATETIME DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_name);
  CREATE INDEX IF NOT EXISTS idx_agent_logs_type  ON agent_logs(type);
  CREATE INDEX IF NOT EXISTS idx_agent_logs_ts    ON agent_logs(timestamp);

  CREATE TABLE IF NOT EXISTS agent_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name  TEXT    NOT NULL,
    report_type TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    priority    TEXT    DEFAULT 'normal',
    status      TEXT    DEFAULT 'new',
    created_at  DATETIME DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reports_agent  ON agent_reports(agent_name);
  CREATE INDEX IF NOT EXISTS idx_reports_status ON agent_reports(status);

  CREATE TABLE IF NOT EXISTS agent_metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name      TEXT    NOT NULL UNIQUE,
    runs_total      INTEGER DEFAULT 0,
    runs_success    INTEGER DEFAULT 0,
    runs_failed     INTEGER DEFAULT 0,
    last_run        DATETIME,
    last_status     TEXT    DEFAULT 'never_run',
    avg_duration_ms REAL    DEFAULT 0,
    updated_at      DATETIME DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS generated_content (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name   TEXT    NOT NULL,
    content_type TEXT    NOT NULL,
    title        TEXT,
    content      TEXT,
    url          TEXT,
    metadata     TEXT,
    created_at   DATETIME DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_content_agent ON generated_content(agent_name);
  CREATE INDEX IF NOT EXISTS idx_content_type  ON generated_content(content_type);

  CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name  TEXT    NOT NULL,
    severity    TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    message     TEXT    NOT NULL,
    status      TEXT    DEFAULT 'open',
    created_at  DATETIME DEFAULT (datetime('now')),
    resolved_at DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_status   ON alerts(status);
  CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_name  TEXT    NOT NULL,
    task_type   TEXT    NOT NULL,
    payload     TEXT,
    priority    INTEGER DEFAULT 5,
    status      TEXT    DEFAULT 'pending',
    scheduled_at DATETIME DEFAULT (datetime('now')),
    started_at  DATETIME,
    completed_at DATETIME,
    error       TEXT
  );
`);

// ─── Logging ─────────────────────────────────────────────────────────────────

const _insertLog = db.prepare(
  'INSERT INTO agent_logs (agent_name, type, message, data) VALUES (?, ?, ?, ?)'
);

function logAgentActivity(agentName, type, message, data = null) {
  return _insertLog.run(agentName, type, message, data ? JSON.stringify(data) : null);
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

const _getMetrics  = db.prepare('SELECT * FROM agent_metrics WHERE agent_name = ?');
const _insertMetrics = db.prepare(`
  INSERT INTO agent_metrics (agent_name, runs_total, runs_success, runs_failed, last_run, last_status, avg_duration_ms)
  VALUES (?, 1, ?, ?, datetime('now'), ?, ?)
`);
const _updateMetrics = db.prepare(`
  UPDATE agent_metrics
  SET runs_total = ?, runs_success = ?, runs_failed = ?,
      last_run = datetime('now'), last_status = ?, avg_duration_ms = ?,
      updated_at = datetime('now')
  WHERE agent_name = ?
`);

function updateAgentMetrics(agentName, status, durationMs) {
  const row = _getMetrics.get(agentName);
  if (row) {
    const total   = row.runs_total + 1;
    const success = status === 'success' ? row.runs_success + 1 : row.runs_success;
    const failed  = status === 'failed'  ? row.runs_failed  + 1 : row.runs_failed;
    const avg     = (row.avg_duration_ms * row.runs_total + durationMs) / total;
    _updateMetrics.run(total, success, failed, status, avg, agentName);
  } else {
    _insertMetrics.run(
      agentName,
      status === 'success' ? 1 : 0,
      status === 'failed'  ? 1 : 0,
      status,
      durationMs
    );
  }
}

function getAllMetrics() {
  return db.prepare('SELECT * FROM agent_metrics ORDER BY agent_name').all();
}

// ─── Reports ─────────────────────────────────────────────────────────────────

const _insertReport = db.prepare(
  'INSERT INTO agent_reports (agent_name, report_type, title, content, priority) VALUES (?, ?, ?, ?, ?)'
);

function saveReport(agentName, reportType, title, content, priority = 'normal') {
  return _insertReport.run(agentName, reportType, title, content, priority);
}

function getReports(limit = 50, agentName = null) {
  if (agentName) {
    return db.prepare(
      'SELECT * FROM agent_reports WHERE agent_name = ? ORDER BY created_at DESC LIMIT ?'
    ).all(agentName, limit);
  }
  return db.prepare(
    'SELECT * FROM agent_reports ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

const _insertAlert = db.prepare(
  'INSERT INTO alerts (agent_name, severity, title, message) VALUES (?, ?, ?, ?)'
);

function createAlert(agentName, severity, title, message) {
  return _insertAlert.run(agentName, severity, title, message);
}

function getOpenAlerts() {
  return db.prepare(
    "SELECT * FROM alerts WHERE status = 'open' ORDER BY created_at DESC"
  ).all();
}

function resolveAlert(id) {
  return db.prepare(
    "UPDATE alerts SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?"
  ).run(id);
}

// ─── Generated Content ────────────────────────────────────────────────────────

const _insertContent = db.prepare(
  'INSERT INTO generated_content (agent_name, content_type, title, content, url, metadata) VALUES (?, ?, ?, ?, ?, ?)'
);

function saveGeneratedContent(agentName, contentType, title, content, url = null, metadata = null) {
  return _insertContent.run(
    agentName, contentType, title, content, url,
    metadata ? JSON.stringify(metadata) : null
  );
}

function getGeneratedContent(limit = 50, contentType = null) {
  if (contentType) {
    return db.prepare(
      'SELECT * FROM generated_content WHERE content_type = ? ORDER BY created_at DESC LIMIT ?'
    ).all(contentType, limit);
  }
  return db.prepare(
    'SELECT * FROM generated_content ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

function getRecentLogs(limit = 200, agentName = null) {
  if (agentName) {
    return db.prepare(
      'SELECT * FROM agent_logs WHERE agent_name = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(agentName, limit);
  }
  return db.prepare(
    'SELECT * FROM agent_logs ORDER BY timestamp DESC LIMIT ?'
  ).all(limit);
}

// ─── Dashboard summary ────────────────────────────────────────────────────────

function getDashboardSummary() {
  const metrics     = getAllMetrics();
  const openAlerts  = getOpenAlerts();
  const recentLogs  = getRecentLogs(50);
  const reports     = getReports(20);
  const content     = getGeneratedContent(10);

  const totalRuns    = metrics.reduce((s, m) => s + m.runs_total, 0);
  const totalSuccess = metrics.reduce((s, m) => s + m.runs_success, 0);
  const totalFailed  = metrics.reduce((s, m) => s + m.runs_failed, 0);

  return {
    metrics,
    openAlerts,
    recentLogs,
    reports,
    content,
    summary: {
      totalAgents:  metrics.length,
      totalRuns,
      totalSuccess,
      totalFailed,
      openAlerts:   openAlerts.length,
      successRate:  totalRuns > 0 ? ((totalSuccess / totalRuns) * 100).toFixed(1) : '0.0',
    },
  };
}

// ─── Content Review ───────────────────────────────────────────────────────────

/**
 * Update the review status of a generated_content record.
 * Merges the patch into the existing metadata JSON.
 *
 * @param {number} id        - generated_content.id
 * @param {string} status    - 'approved' | 'rejected' | 'pending_review' | 'live'
 * @param {object} [patch]   - additional metadata fields to merge
 */
function updateContentReview(id, status, patch = {}) {
  const row = db.prepare('SELECT metadata FROM generated_content WHERE id = ?').get(id);
  if (!row) throw new Error(`Content record ${id} not found`);
  let meta = {};
  try { meta = JSON.parse(row.metadata); } catch (_) {}
  Object.assign(meta, patch, { status, reviewedAt: new Date().toISOString() });
  db.prepare('UPDATE generated_content SET metadata = ? WHERE id = ?')
    .run(JSON.stringify(meta), id);
  return meta;
}

/**
 * Fetch content records pending review (status = 'pending_review' | 'ready_for_review').
 */
function getContentForReview(limit = 100) {
  return db.prepare(`
    SELECT id, agent_name, content_type, title, url, metadata, created_at
    FROM   generated_content
    WHERE  metadata LIKE '%"status":"pending_review"%'
       OR  metadata LIKE '%"status":"ready_for_review"%'
    ORDER  BY created_at DESC
    LIMIT  ?
  `).all(limit);
}

module.exports = {
  db,
  logAgentActivity,
  updateAgentMetrics,
  getAllMetrics,
  saveReport,
  getReports,
  createAlert,
  getOpenAlerts,
  resolveAlert,
  saveGeneratedContent,
  getGeneratedContent,
  updateContentReview,
  getContentForReview,
  getRecentLogs,
  getDashboardSummary,
};
