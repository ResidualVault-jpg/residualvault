'use strict';

require('dotenv').config();
const cron    = require('node-cron');
const winston = require('winston');
const path    = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) =>
      `[${timestamp}] [SCHEDULER] ${level.toUpperCase()}: ${message}`
    )
  ),
  transports: [new winston.transports.Console()],
});

// ─── Agent registry ────────────────────────────────────────────────────────────
// Each entry: { file, class }  — schedule is defined inside the agent itself
const AGENT_MANIFESTS = [
  { key: 'cybersecurity',         file: './agents/cybersecurity-agent' },
  { key: 'graphics-image',        file: './agents/graphics-image-agent' },
  { key: 'heygen-video',          file: './agents/heygen-video-agent' },
  { key: 'legal-compliance',      file: './agents/legal-compliance-agent' },
  { key: 'brand-voice',           file: './agents/brand-voice-auditor' },
  { key: 'marketing-master',      file: './agents/marketing-master-agent' },
  { key: 'advertising-master',    file: './agents/advertising-master-agent' },
  { key: 'promotions-master',     file: './agents/promotions-master-agent' },
  { key: 'content-scheduler',     file: './agents/content-scheduler-agent' },
  { key: 'revenue-intelligence',  file: './agents/revenue-intelligence-agent' },
  { key: 'personalization',       file: './agents/personalization-engine' },
  { key: 'partnership-scout',     file: './agents/partnership-scout' },
  { key: 'crisis-response',       file: './agents/crisis-response-agent' },
  { key: 'content-commander',     file: './agents/content-commander' },
  { key: 'ad-strategist',         file: './agents/ad-strategist' },
  { key: 'seo-architect',         file: './agents/seo-architect' },
  { key: 'community-voice',       file: './agents/community-voice' },
  { key: 'analytics-oracle',      file: './agents/analytics-oracle' },
  { key: 'email-conductor',       file: './agents/email-conductor' },
  { key: 'intelligence-scout',    file: './agents/intelligence-scout' },
  { key: 'industry-researcher',   file: './agents/industry-researcher' },
  { key: 'master-strategist',     file: './agents/master-strategist' },
  { key: 'social-media',          file: './agents/social-media-agent' },
  { key: 'customer-success',      file: './agents/customer-success-agent' },
];

// Loaded agent instances
const agents   = {};
const cronJobs = {};

/** Load all agent modules and instantiate them */
function loadAgents() {
  for (const manifest of AGENT_MANIFESTS) {
    try {
      const AgentClass = require(manifest.file);
      agents[manifest.key] = new AgentClass();
      logger.info(`Loaded agent: ${agents[manifest.key].name}`);
    } catch (err) {
      logger.error(`Failed to load agent [${manifest.key}]: ${err.message}`);
    }
  }
  logger.info(`${Object.keys(agents).length}/${AGENT_MANIFESTS.length} agents loaded`);
}

/** Register cron jobs from each agent's .schedule property */
function registerCronJobs() {
  for (const [key, agent] of Object.entries(agents)) {
    const schedule = agent.schedule;

    if (!cron.validate(schedule)) {
      logger.warn(`Invalid cron schedule for ${agent.name}: "${schedule}" — skipping`);
      continue;
    }

    const tz = agent.timezone || 'America/New_York';
    cronJobs[key] = cron.schedule(schedule, async () => {
      logger.info(`Triggering ${agent.name} (${schedule} ${tz})`);
      try {
        await agent.run();
      } catch (err) {
        logger.error(`${agent.name} run error: ${err.message}`);
      }
    }, { timezone: tz });

    logger.info(`Scheduled ${agent.name} → "${schedule}" (${tz})`);
  }
}

/** Manually trigger an agent by key (auto-loads agents if not yet loaded) */
async function runAgent(key, context = {}) {
  if (Object.keys(agents).length === 0) loadAgents();
  const agent = agents[key];
  if (!agent) throw new Error(`Unknown agent key: ${key}`);
  logger.info(`Manual trigger: ${agent.name}`);
  return agent.run(context);
}

/** Get all agent statuses (auto-loads agents if not yet loaded) */
function getAgentStatuses() {
  if (Object.keys(agents).length === 0) loadAgents();
  return Object.entries(agents).map(([key, agent]) => ({
    key,
    ...agent.getStatus(),
  }));
}

/** Get a specific agent instance (auto-loads agents if not yet loaded) */
function getAgent(key) {
  if (Object.keys(agents).length === 0) loadAgents();
  return agents[key] || null;
}

/** Start the scheduler */
async function start() {
  loadAgents();
  registerCronJobs();
  logger.info(`Scheduler running — ${Object.keys(cronJobs).length} cron jobs active`);
}

/** Stop all cron jobs */
function stop() {
  for (const job of Object.values(cronJobs)) job.stop();
  logger.info('All cron jobs stopped');
}

module.exports = { start, stop, runAgent, getAgent, getAgentStatuses, agents };

// Allow standalone execution: node scheduler.js
if (require.main === module) {
  start().then(() => {
    logger.info('Scheduler running standalone (Ctrl+C to stop)');
  }).catch(err => {
    logger.error('Scheduler failed to start:', err);
    process.exit(1);
  });

  process.on('SIGINT',  () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
}
