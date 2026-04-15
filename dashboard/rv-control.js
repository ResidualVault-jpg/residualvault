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

// Prevent HTML caching so new deployments are picked up immediately
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

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
app.get('/api/summary', async (req, res) => {
  try {
    res.json(await db.getDashboardSummary());
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

// ─── Universal Content Review & Approval ─────────────────────────────────────
//
// Sunday batch: all 22 agents run 6 AM – 11:30 AM Denver and save content
// with status: 'pending_review'. HeyGen videos render during the afternoon
// and arrive as 'ready_for_review'. Owner reviews everything before Monday.

/**
 * GET /api/review
 * Returns all pending_review + ready_for_review content across all agents.
 * Query params:
 *   ?agent=    filter by agent_name
 *   ?type=     filter by content_type
 *   ?limit=100
 */
app.get('/api/review', async (req, res) => {
  try {
    const { agent: agentName, type: contentType, limit = '200' } = req.query;
    let rows = await db.getContentForReview(parseInt(limit));

    if (agentName) rows = rows.filter(r => r.agent_name === agentName);
    if (contentType) rows = rows.filter(r => r.content_type === contentType);

    const items = rows.map(r => {
      let meta = {};
      try { meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata || {}); } catch (_) {}
      let rawContent = r.content;
      let contentStr = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent || '');
      let title = r.title || r.content_type;
      let readablePreview = '';
      let readableContent = '';
      try {
        const parsed = typeof rawContent === 'object' ? rawContent : JSON.parse(contentStr);
        if (Array.isArray(parsed)) {
          const first = parsed[0] || {};
          title = r.title || first.theme || first.platform || first.name || first.subject || r.content_type;
          readablePreview = (first.hook || first.content || first.response || first.fit || first.subject_line || first.name || '').substring(0, 200);
          readableContent = parsed.map((p, i) => {
            let t = '--- ITEM ' + (i+1) + ' ---\n';
            // Partnership Scout format
            if (p.name) t += 'Partner: ' + p.name + '\n';
            if (p.type) t += 'Type: ' + p.type + '\n';
            if (p.website) t += 'Website: ' + p.website + '\n';
            if (p.fit) t += 'Fit: ' + p.fit + '\n';
            if (p.audience) t += 'Audience: ' + p.audience + '\n';
            if (p.rank) t += 'Priority Rank: ' + p.rank + '\n';
            // Social post format
            if (p.platform) t += 'Platform: ' + p.platform + '\n';
            if (p.hook) t += 'Hook: ' + p.hook + '\n';
            if (p.content) t += 'Content: ' + p.content + '\n';
            if (p.cta) t += 'CTA: ' + p.cta + '\n';
            // Email format
            if (p.subject_line) t += 'Subject: ' + p.subject_line + '\n';
            if (p.preview_text) t += 'Preview: ' + p.preview_text + '\n';
            if (p.body) t += 'Body: ' + p.body + '\n';
            // General format
            if (p.title) t += 'Title: ' + p.title + '\n';
            if (p.description) t += 'Description: ' + p.description + '\n';
            if (p.response) t += 'Response: ' + p.response + '\n';
            return t.trim();
          }).join('\n\n');
        } else if (parsed && typeof parsed === 'object') {
          title = r.title || parsed.title || parsed.name || parsed.subject || r.content_type;
          readablePreview = (parsed.hook || parsed.content || parsed.summary || parsed.description || parsed.fit || '').substring(0, 200);
          readableContent = Object.entries(parsed).map(([k,v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join('\n');
        }
      } catch(_) {
        readablePreview = contentStr.substring(0, 200);
        readableContent = contentStr;
      }
      return {
        id:          r.id,
        agentName:   r.agent_name,
        contentType: r.content_type,
        title:       title || r.content_type,
        url:         r.url,
        status:      meta.status || 'pending_review',
        preview:     readablePreview,
        content:     readableContent,
        meta,
        createdAt:   r.created_at,
      };
    });

    res.json({ total: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/review/:id
 * Full record including complete content.
 */
app.get('/api/review/:id', (req, res) => {
  try {
    const row = db.db.prepare('SELECT * FROM generated_content WHERE id = ?').get(parseInt(req.params.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
    let meta = {};
    try { meta = JSON.parse(row.metadata); } catch (_) {}
    res.json({ ...row, meta });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/review/:id/approve
 * For video content: triggers YouTube upload via HeyGen Video Agent.
 * For all other content: marks as 'approved' (ready for manual publishing or
 * downstream automation).
 * Body (optional): { notes: "string" }
 */
app.post('/api/review/:id/approve', async (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const row = db.db.prepare('SELECT * FROM generated_content WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    let extra = {};

    // Video content → trigger YouTube upload
    if (['video-office-journey', 'video-conference-room', 'video'].includes(row.content_type)) {
      let scheduler;
      try { scheduler = require('../scheduler'); } catch (_) {}
      const agent = scheduler?.getAgent('heygen-video');
      if (agent) {
        const ytResult = await agent.publishVideo(id);
        extra = { youtubeUrl: ytResult?.youtubeUrl, youtubeId: ytResult?.youtubeId };
      }
    } else {
      db.updateContentReview(id, 'approved', { notes: req.body?.notes || '' });
    }

    broadcastUpdate();
    res.json({ success: true, id, status: 'approved', ...extra });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/review/:id/reject
 * Body: { reason: "string" }
 */
app.post('/api/review/:id/reject', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.updateContentReview(id, 'rejected', { reason: req.body?.reason || '' });
    broadcastUpdate();
    res.json({ success: true, id, status: 'rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/review/:id
 * Edit content metadata and/or body before approving.
 * Body: { title, content, notes, youtubeDescription, youtubeTags, ... }
 * Resets status to 'pending_review' so it reappears in the queue.
 */
app.put('/api/review/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const row = db.db.prepare('SELECT * FROM generated_content WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    const { title, content, ...metaPatch } = req.body || {};
    const updates = [];
    const params  = [];

    if (title) { updates.push('title = ?'); params.push(title); }
    if (content !== undefined) { updates.push('content = ?'); params.push(content); }

    // Merge metadata
    let meta = {};
    try { meta = JSON.parse(row.metadata); } catch (_) {}
    Object.assign(meta, metaPatch, { status: 'pending_review', editedAt: new Date().toISOString() });
    updates.push('metadata = ?');
    params.push(JSON.stringify(meta));

    params.push(id);
    db.db.prepare(`UPDATE generated_content SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    broadcastUpdate();
    res.json({ success: true, id, status: 'pending_review' });
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
    db.getDashboardSummary().then(s => socket.emit('summary', s)).catch(e => console.error(e));
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
    db.getDashboardSummary().then(s => io.emit('summary', s)).catch(e => console.error(e));
    io.emit('alerts',  db.getOpenAlerts());
    io.emit('logs',    db.getRecentLogs(50));
  } catch (err) {
    console.error('Broadcast error:', err.message);
  }
}

// Periodic broadcast every 30 seconds
setInterval(broadcastUpdate, 30000);

// ─── Deploy Webhook ───────────────────────────────────────────────────────────
// POST /api/deploy  { "token": "<DEPLOY_TOKEN>" }
// Pulls latest code from git and restarts PM2 processes.
const { execSync } = require('child_process');
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || 'rv-deploy-2025';
const DEPLOY_DIR   = process.env.DEPLOY_DIR   || require('path').join(__dirname, '..');

app.post('/api/deploy', (req, res) => {
  if (req.body.token !== DEPLOY_TOKEN) return res.status(403).json({ error: 'Forbidden' });
  res.json({ status: 'deploying', message: 'Pull started — check back in 15s' });
  // Run async after response is sent
  setImmediate(() => {
    try {
      execSync(
        `cd ${DEPLOY_DIR} && git fetch origin claude/build-ai-agent-system-e0Lfr && git checkout claude/build-ai-agent-system-e0Lfr && git pull origin claude/build-ai-agent-system-e0Lfr`,
        { stdio: 'inherit', timeout: 60000 }
      );
      // Restart rv-control (self) via PM2 — will kill this process
      execSync('pm2 restart rv-control', { stdio: 'inherit', timeout: 30000 });
    } catch (e) {
      console.error('[deploy] Error:', e.message);
    }
  });
});

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
