'use strict';

require('dotenv').config();
const path    = require('path');
const winston = require('winston');

// ─── Logger ───────────────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message }) =>
      `[${timestamp}] ${level}: ${message}`
    )
  ),
  transports: [new winston.transports.Console()],
});

// ─── Boot sequence ─────────────────────────────────────────────────────────────

async function boot() {
  logger.info('=== ResidualVault AI Agent System Booting ===');

  // Verify required env vars
  const required = ['ANTHROPIC_API_KEY'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    logger.warn(`Missing optional env vars: ${missing.join(', ')} — some agents may be limited`);
  }

  // Start scheduler (loads and registers all 24 agents with cron)
  const scheduler = require('./scheduler');
  await scheduler.start();
  logger.info('Scheduler started — all agents registered');

  // Start rv-control dashboard in-process
  const dashboard = require('./dashboard/rv-control');
  await dashboard.start();
  logger.info(`rv-control dashboard running on port ${process.env.DASHBOARD_PORT || 3001}`);

  logger.info('=== ResidualVault AI Agent System Online ===');
}

boot().catch(err => {
  console.error('Fatal boot error:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
