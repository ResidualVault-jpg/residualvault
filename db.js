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
    await pool.query(
      'INSERT INTO agent_metrics (agent_name, metrics, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (agent_name) DO UPDATE SET metrics = $2, updated_at = NOW()',
      [agentName, JSON.stringify(metrics)]
    );
  } catch (err) { console.error('[DB] updateAgentMetrics error:', err.message); }
};

pool.saveGeneratedContent = async (agentName, contentType, title, content, url, metadata) => {
  try {
    await pool.query(
      'INSERT INTO generated_content (agent_name, content_type, title, content, url, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
      [agentName, contentType, title,
       typeof content === 'string' ? content : JSON.stringify(content),
       url || null,
       metadata ? JSON.stringify(metadata) : null]
    );
  } catch (err) { console.error('[DB] saveGeneratedContent error:', err.message); }
};

pool.createAlert = async (agentName, severity, message) => {
  try {
    await pool.query(
      'INSERT INTO system_alerts (agent_name, severity, message, resolved) VALUES ($1, $2, $3, false)',
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
    return {
      metrics, recentLogs: logs, reports, content, openAlerts: alerts,
      summary: {
        totalAgents: metrics.length,
        totalRuns: logs.length,
        totalSuccess: logs.filter(l => l.status === 'success').length,
        totalFailed: logs.filter(l => l.status === 'error').length,
        openAlerts: alerts.length,
        successRate: logs.length ? ((logs.filter(l => l.status === 'success').length / logs.length) * 100).toFixed(1) : '0.0'
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

module.exports = pool;
