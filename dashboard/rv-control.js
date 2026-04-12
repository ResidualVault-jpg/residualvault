'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express  = require('express');
const http     = require('http');
const socketIo = require('socket.io');
const path     = require('path');
const db       = require('../db');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, { cors: { origin: '*' } });

const PORT   = parseInt(process.env.DASHBOARD_PORT || '3001');
const SECRET = process.env.DASHBOARD_SECRET || null;

// ─── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Optional IP allowlist
const ALLOWED_IPS = process.env.ALLOWED_IPS
  ? process.env.ALLOWED_IPS.split(',').map(s => s.trim())
  : [];

function ipGuard(req, res, next) {
  if (ALLOWED_IPS.length === 0) return next();
  const ip = req.ip || req.connection.remoteAddress;
  if (ALLOWED_IPS.some(allowed => ip.includes(allowed))) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

app.use(ipGuard);

// ─── REST API ──────────────────────────────────────────────────────────────────

/** GET /api/summary — full dashboard data */
app.get('/api/summary', (req, res) => {
  try {
    res.json(db.getDashboardSummary());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/agents — agent statuses */
app.get('/api/agents', (req, res) => {
  try {
    const metrics = db.getAllMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/logs?limit=100&agent= */
app.get('/api/logs', (req, res) => {
  try {
    const limit     = parseInt(req.query.limit || '100');
    const agentName = req.query.agent || null;
    res.json(db.getRecentLogs(limit, agentName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/alerts */
app.get('/api/alerts', (req, res) => {
  try {
    res.json(db.getOpenAlerts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/alerts/:id/resolve */
app.post('/api/alerts/:id/resolve', (req, res) => {
  try {
    db.resolveAlert(parseInt(req.params.id));
    res.json({ success: true });
    broadcastUpdate();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/reports?limit=50&agent= */
app.get('/api/reports', (req, res) => {
  try {
    const limit     = parseInt(req.query.limit || '50');
    const agentName = req.query.agent || null;
    res.json(db.getReports(limit, agentName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/content?limit=20&type= */
app.get('/api/content', (req, res) => {
  try {
    const limit       = parseInt(req.query.limit || '20');
    const contentType = req.query.type || null;
    res.json(db.getGeneratedContent(limit, contentType));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/agents/:key/run — manually trigger an agent */
app.post('/api/agents/:key/run', async (req, res) => {
  try {
    // Lazy-load scheduler to avoid circular deps at module load time
    let scheduler;
    try { scheduler = require('../scheduler'); } catch (_) {}

    if (!scheduler || !scheduler.getAgent(req.params.key)) {
      return res.status(404).json({ error: `Agent "${req.params.key}" not found or scheduler not loaded` });
    }

    // Fire and forget — don't block the HTTP response
    scheduler.runAgent(req.params.key, req.body || {}).then(() => {
      broadcastUpdate();
    }).catch(err => {
      console.error(`Manual trigger error: ${err.message}`);
    });

    res.json({ success: true, message: `Agent "${req.params.key}" triggered` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Video Review & Approval ──────────────────────────────────────────────────

/**
 * GET /api/videos?status=ready_for_review
 * Returns video records with optional status filter.
 * Statuses: processing | ready_for_review | approved | live | rejected | failed
 */
app.get('/api/videos', (req, res) => {
  try {
    const { status, limit = '50' } = req.query;
    let rows;
    if (status) {
      rows = db.db.prepare(`
        SELECT id, title, url, metadata, created_at
        FROM   generated_content
        WHERE  content_type IN ('video-office-journey','video-conference-room','video')
          AND  metadata LIKE ?
        ORDER  BY created_at DESC
        LIMIT  ?
      `).all(`%"status":"${status}"%`, parseInt(limit));
    } else {
      rows = db.db.prepare(`
        SELECT id, title, url, metadata, created_at
        FROM   generated_content
        WHERE  content_type IN ('video-office-journey','video-conference-room','video')
        ORDER  BY created_at DESC
        LIMIT  ?
      `).all(parseInt(limit));
    }
    // Parse metadata for cleaner response
    const videos = rows.map(r => {
      let meta = {};
      try { meta = JSON.parse(r.metadata); } catch (_) {}
      return {
        id:                 r.id,
        title:              r.title,
        youtubeUrl:         r.url,
        status:             meta.status      || 'unknown',
        format:             meta.format      || 'video',
        localPath:          meta.localPath   || null,
        videoUrl:           meta.videoUrl    || null,
        youtubeDescription: meta.youtubeDescription || null,
        youtubeTags:        meta.youtubeTags || [],
        thumbnailConcept:   meta.thumbnailConcept || null,
        submittedAt:        meta.submittedAt  || null,
        renderedAt:         meta.renderedAt   || null,
        approvedAt:         meta.approvedAt   || null,
        rejectedAt:         meta.rejectedAt   || null,
        reason:             meta.reason       || null,
        createdAt:          r.created_at,
      };
    });
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/approve
 * Uploads the video to YouTube and marks it 'live'.
 */
app.post('/api/videos/:id/approve', async (req, res) => {
  try {
    let scheduler;
    try { scheduler = require('../scheduler'); } catch (_) {}
    const agent = scheduler?.getAgent('heygen-video');
    if (!agent) return res.status(503).json({ error: 'HeyGen Video Agent not available' });

    const result = await agent.publishVideo(parseInt(req.params.id));
    broadcastUpdate();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/reject
 * Body: { reason: "string" }
 */
app.post('/api/videos/:id/reject', (req, res) => {
  try {
    let scheduler;
    try { scheduler = require('../scheduler'); } catch (_) {}
    const agent = scheduler?.getAgent('heygen-video');
    if (!agent) return res.status(503).json({ error: 'HeyGen Video Agent not available' });

    agent.rejectVideo(parseInt(req.params.id), req.body?.reason || '');
    broadcastUpdate();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/videos/:id/edit
 * Body: { title, youtubeDescription, youtubeTags }
 * Updates metadata; resets status to ready_for_review.
 */
app.put('/api/videos/:id/edit', async (req, res) => {
  try {
    let scheduler;
    try { scheduler = require('../scheduler'); } catch (_) {}
    const agent = scheduler?.getAgent('heygen-video');
    if (!agent) return res.status(503).json({ error: 'HeyGen Video Agent not available' });

    const result = await agent.editVideo(parseInt(req.params.id), req.body || {});
    broadcastUpdate();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/agents/statuses */
app.get('/api/agents/statuses', (req, res) => {
  try {
    let scheduler;
    try { scheduler = require('../scheduler'); } catch (_) {}
    if (!scheduler) return res.json([]);
    res.json(scheduler.getAgentStatuses());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all → dashboard SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[rv-control] Client connected: ${socket.id}`);

  // Send current state immediately
  try {
    socket.emit('summary', db.getDashboardSummary());
  } catch (err) {
    console.error('Failed to send initial summary:', err.message);
  }

  socket.on('disconnect', () => {
    console.log(`[rv-control] Client disconnected: ${socket.id}`);
  });

  socket.on('resolve-alert', (id) => {
    db.resolveAlert(id);
    broadcastUpdate();
  });
});

/** Push fresh data to all connected dashboards */
function broadcastUpdate() {
  try {
    io.emit('summary', db.getDashboardSummary());
    io.emit('alerts',  db.getOpenAlerts());
    io.emit('logs',    db.getRecentLogs(50));
  } catch (err) {
    console.error('Broadcast error:', err.message);
  }
}

// Periodic broadcast every 30 seconds
setInterval(broadcastUpdate, 30000);

// ─── Export / Start ────────────────────────────────────────────────────────────

async function start() {
  return new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`[rv-control] Dashboard running at http://localhost:${PORT}`);
      resolve();
    });
  });
}

function stop() {
  server.close();
}

module.exports = { start, stop, broadcastUpdate, io };

if (require.main === module) {
  start().catch(err => {
    console.error('Dashboard failed to start:', err);
    process.exit(1);
  });
}
