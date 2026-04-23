'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

pool.logAgentActivity = async (agentName, status, message, data) => {
  try {
    await pool.query(
      'INSERT INTO agent_logs (agent_name, status, message, data) VALUES ($1, $2, $3, $4)',
      [agentName, status, message, JSON.stringify(data || {})]
    );
  } catch (err) { console.error('[DB] logAgentActivity error:', err.message); }
};

pool.saveAgentReport = async (agentName, type, summary, data) => {
  try {
    await pool.query(
      'INSERT INTO agent_reports (agent_name, report) VALUES ($1, $2)',
      [agentName, JSON.stringify({ type, summary, data })]
    );
  } catch (err) { console.error('[DB] saveAgentReport error:', err.message); }
};

pool.saveReport = pool.saveAgentReport;

pool.updateAgentMetrics = async (agentName, metrics) => {
  try {
    // Read existing metrics first
    const existing = await pool.query(
      'SELECT metrics FROM agent_metrics WHERE agent_name = $1',
      [agentName]
    ).then(r => {
      if (r.rows.length === 0) return {};
      const raw = r.rows[0].metrics;
      return (typeof raw === 'string') ? JSON.parse(raw) : (raw || {});
    }).catch(() => ({}));

    // Merge: increment counters, update status/lastRun/duration
    const merged = {
      ...existing,
      status:       metrics.status       || existing.status,
      lastRun:      metrics.lastRun      || existing.lastRun,
      duration:     metrics.duration     ?? existing.duration,
      runs_total:   (existing.runs_total || 0) + 1,
      runs_success: (existing.runs_success || 0) + (metrics.successCount || 0),
      runs_failed:  (existing.runs_failed  || 0) + (metrics.failCount    || 0),
    };

    await pool.query(
      'INSERT INTO agent_metrics (agent_name, metrics, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (agent_name) DO UPDATE SET metrics = $2, updated_at = NOW()',
      [agentName, JSON.stringify(merged)]
    );
  } catch (err) { console.error('[DB] updateAgentMetrics error:', err.message); }
};

pool.saveGeneratedContent = async (agentName, contentType, title, content, url, metadata) => {
  try {
    await pool.query(
      'INSERT INTO generated_content (agent_name, content_type, title, content, url, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [agentName, contentType, title,
       JSON.stringify(content),
       url || null,
       metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) { console.error('[DB] saveGeneratedContent error:', err.message); }
};

pool.createAlert = async (agentName, severity, message) => {
  try {
    await pool.query(
      'INSERT INTO system_alerts (agent_name, type, message, resolved) VALUES ($1, $2, $3, false)',
      [agentName, severity, message]
    );
  } catch (err) { console.error('[DB] createAlert error:', err.message); }
};

pool.getDashboardSummary = async () => {
  try {
    const metrics = await pool.query('SELECT * FROM agent_metrics ORDER BY updated_at DESC LIMIT 50').then(r => r.rows).catch(() => []);
    const logs = await pool.query('SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT 20').then(r => r.rows).catch(() => []);
    const reports = await pool.query('SELECT * FROM agent_reports ORDER BY created_at DESC LIMIT 10').then(r => r.rows).catch(() => []);
    const content = await pool.query('SELECT * FROM generated_content ORDER BY created_at DESC LIMIT 10').then(r => r.rows).catch(() => []);
    const alerts = await pool.query('SELECT * FROM system_alerts WHERE resolved=false ORDER BY created_at DESC LIMIT 10').then(r => r.rows).catch(() => []);
    // Calculate success rate from actual run data in agent_logs
    const runStats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'complete') AS completions,
        COUNT(*) FILTER (WHERE status = 'error')    AS errors
      FROM agent_logs
    `).then(r => r.rows[0]).catch(() => ({ completions: 0, errors: 0 }));
    const totalCompleted = parseInt(runStats.completions) || 0;
    const totalErrors    = parseInt(runStats.errors) || 0;
    const totalRuns      = totalCompleted + totalErrors;
    const totalAgents    = metrics.length;
    const successCount   = totalCompleted;
    const successRate    = totalRuns > 0 ? ((totalCompleted / totalRuns) * 100).toFixed(1) : '0.0';
    return {
      metrics, recentLogs: logs, reports, content, openAlerts: alerts,
      summary: {
        totalAgents,
        totalRuns,
        totalSuccess: successCount,
        totalFailed: totalErrors,
        openAlerts: alerts.length,
        successRate
      }
    };
  } catch (err) {
    return { metrics: [], recentLogs: [], reports: [], content: [], openAlerts: [], summary: { totalAgents: 0, totalRuns: 0, totalSuccess: 0, totalFailed: 0, openAlerts: 0, successRate: '0.0' } };
  }
};

pool.getAllMetrics = async () => {
  try {
    return (await pool.query('SELECT * FROM agent_metrics ORDER BY updated_at DESC')).rows;
  } catch (e) { return []; }
};


pool.getContentForReview = async (limit = 100) => {
  try {
    const result = await pool.query(`
      SELECT * FROM generated_content
      WHERE metadata IS NULL
         OR metadata->>'status' IS NULL
         OR metadata->>'status' IN ('pending_review', 'ready_for_review')
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  } catch (err) {
    console.error('[DB] getContentForReview error:', err.message);
    return [];
  }
};

pool.updateContentReview = async (id, status, reason = null) => {
  try {
    await pool.query(`
      UPDATE generated_content
      SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE id = $2
    `, [JSON.stringify({ status, reason, reviewedAt: new Date().toISOString() }), id]);
  } catch (err) { console.error('[DB] updateContentReview error:', err.message); }
};


pool.getOpenAlerts = async (limit = 20) => {
  try {
    const result = await pool.query(
      'SELECT * FROM system_alerts WHERE resolved=false ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  } catch (err) { console.error('[DB] getOpenAlerts error:', err.message); return []; }
};

pool.getRecentLogs = async (limit = 50) => {
  try {
    const result = await pool.query(
      'SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  } catch (err) { console.error('[DB] getRecentLogs error:', err.message); return []; }
};


pool.getGeneratedContent = async (limit = 50, contentType = null) => {
  try {
    let query = 'SELECT * FROM generated_content';
    let params = [];
    if (contentType) {
      query += ' WHERE content_type = $1 ORDER BY created_at DESC LIMIT $2';
      params = [contentType, limit];
    } else {
      query += ' ORDER BY created_at DESC LIMIT $1';
      params = [limit];
    }
    return (await pool.query(query, params)).rows;
  } catch (err) { console.error('[DB] getGeneratedContent error:', err.message); return []; }
};

pool.getReports = async (limit = 20, agentName = null) => {
  try {
    let query = 'SELECT * FROM agent_reports';
    let params = [];
    if (agentName) {
      query += ' WHERE agent_name = $1 ORDER BY created_at DESC LIMIT $2';
      params = [agentName, limit];
    } else {
      query += ' ORDER BY created_at DESC LIMIT $1';
      params = [limit];
    }
    return (await pool.query(query, params)).rows;
  } catch (err) { console.error('[DB] getReports error:', err.message); return []; }
};

pool.getMetrics = async () => {
  try {
    return (await pool.query('SELECT * FROM agent_metrics ORDER BY updated_at DESC')).rows;
  } catch (err) { console.error('[DB] getMetrics error:', err.message); return []; }
};

pool.getSummaryStats = async () => {
  try {
    const logs = await pool.query('SELECT status, COUNT(*) as count FROM agent_logs GROUP BY status');
    const stats = { totalRuns: 0, successCount: 0, failCount: 0 };
    for (const row of logs.rows) {
      stats.totalRuns += parseInt(row.count);
      if (row.status === 'complete' || row.status === 'success') stats.successCount += parseInt(row.count);
      if (row.status === 'error' || row.status === 'failed') stats.failCount += parseInt(row.count);
    }
    stats.successRate = stats.totalRuns > 0 ? ((stats.successCount / (stats.successCount + stats.failCount || 1)) * 100).toFixed(1) : '0.0';
    return stats;
  } catch (err) { console.error('[DB] getSummaryStats error:', err.message); return { totalRuns: 0, successCount: 0, failCount: 0, successRate: '0.0' }; }
};

module.exports = pool;
