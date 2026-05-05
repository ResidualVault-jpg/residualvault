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
app.get('/api/agents', async (req, res) => {
  try {
    const metrics = await db.getAllMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/logs?limit=100&agent= */
app.get('/api/logs', async (req, res) => {
  try {
    const limit     = parseInt(req.query.limit || '100');
    const agentName = req.query.agent || null;
    res.json(await db.getRecentLogs(limit, agentName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/** GET /api/calendar - scheduled content posts */
app.get('/api/calendar', async (req, res) => {
  try {
    const { platform, week } = req.query;
    let offset = parseInt(week || '0');
    let startDate = new Date();
    startDate.setDate(startDate.getDate() - startDate.getDay() + (offset * 7));
    startDate.setHours(0,0,0,0);
    let endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
    let q = 'SELECT * FROM content_posts WHERE scheduled_date >= $1 AND scheduled_date < $2';
    let params = [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]];
    if (platform) { q += ' AND platform = '; params.push(platform); }
    q += ' ORDER BY scheduled_date ASC, scheduled_time ASC';
    const result = await db.query(q, params);
    res.json({ posts: result.rows, weekStart: startDate.toISOString().split('T')[0], weekEnd: endDate.toISOString().split('T')[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/** GET /api/alerts */
app.get('/api/alerts', async (req, res) => {
  try {
    res.json(await db.getOpenAlerts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/alerts/:id/resolve */
app.post('/api/alerts/:id/resolve', async (req, res) => {
  try {
    await db.query('UPDATE system_alerts SET resolved = true WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ success: true });
    broadcastUpdate();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/alerts/:id/detail — fetch related report + logs for an alert */
app.get('/api/alerts/:id/detail', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const alertResult = await db.query('SELECT * FROM system_alerts WHERE id = $1', [alertId]);
    if (!alertResult.rows.length) return res.status(404).json({ error: 'Alert not found' });
    const alert = alertResult.rows[0];

    const reportResult = await db.query(
      `SELECT id, report, created_at FROM agent_reports
       WHERE agent_name = $1 AND created_at >= $2::timestamp - interval '1 hour'
       ORDER BY created_at DESC LIMIT 1`,
      [alert.agent_name, alert.created_at]
    );
    const report = reportResult.rows.length ? reportResult.rows[0].report : null;

    const logResult = await db.query(
      `SELECT status, message, created_at FROM agent_logs
       WHERE agent_name = $1 AND created_at >= $2::timestamp - interval '1 hour'
       ORDER BY created_at DESC LIMIT 10`,
      [alert.agent_name, alert.created_at]
    );

    res.json({ alert, report, logs: logResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/alerts/:id/implement — owner approves, agent executes recommendations */
app.post('/api/alerts/:id/implement', async (req, res) => {
  try {
    const alertId = parseInt(req.params.id);
    const alertResult = await db.query('SELECT * FROM system_alerts WHERE id = $1', [alertId]);
    if (!alertResult.rows.length) return res.status(404).json({ error: 'Alert not found' });
    const alert = alertResult.rows[0];

    const reportResult = await db.query(
      `SELECT id, report FROM agent_reports
       WHERE agent_name = $1 AND created_at >= $2::timestamp - interval '2 hours'
       ORDER BY created_at DESC LIMIT 1`,
      [alert.agent_name, alert.created_at]
    );
    const report = reportResult.rows.length ? reportResult.rows[0].report : null;

    if (!report) {
      return res.status(404).json({ error: 'No report found for this alert — cannot implement without recommendations' });
    }

    // Map agent display name to scheduler key
    const AGENT_NAME_TO_KEY = {
      'Analytics Oracle': 'analytics-oracle',
      'Intelligence Scout': 'intelligence-scout',
      'Industry Researcher': 'industry-researcher',
      'Revenue Intelligence Agent': 'revenue-intelligence',
      'SEO Architect': 'seo-architect',
      'Twitter Content Creator': 'twitter-content',
      'Brand Voice Auditor': 'brand-voice',
      'LinkedIn Content Creator': 'linkedin-content',
      'Content Commander': 'content-commander',
      'Content Scheduler Agent': 'content-scheduler',
      'Social Media Agent': 'social-media',
      'Community Voice': 'community-voice',
      'Email Conductor': 'email-conductor',
      'Marketing Master Agent': 'marketing-master',
      'Advertising Master Agent': 'advertising-master',
      'Ad Strategist': 'ad-strategist',
      'Promotions Master Agent': 'promotions-master',
      'Partnership Scout': 'partnership-scout',
      'Personalization Engine': 'personalization',
      'Customer Success Agent': 'customer-success',
      'Legal & Compliance Guardian': 'legal-compliance',
      'Compliance Auto-Resolver': 'compliance-auto-resolver',
      'Graphics/Image Agent': 'graphics-image',
      'Master Strategist': 'master-strategist',
      'Cybersecurity Agent': 'cybersecurity',
      'Infrastructure Security Scanner': 'infra-security',
      'Threat Intelligence Agent': 'threat-intel',
      'Veo Video Agent': 'veo-video',
      'Crisis Response Agent': 'crisis-response',
      'Fixer Agent': 'fixer',
      'User Testing Agent': 'user-testing',
      'Meta Token Agent': 'meta-token',
      'Instagram Carousel Agent': 'instagram-carousel',
      'Staking Alpha Weekly': 'staking-alpha',
    };

    const agentKey = AGENT_NAME_TO_KEY[alert.agent_name];
    if (!agentKey) {
      return res.status(400).json({ error: 'Cannot map agent "' + alert.agent_name + '" to a scheduler key' });
    }

    // Mark as implementing
    await db.query(
      `UPDATE system_alerts SET details = COALESCE(details, '{}'::jsonb) || '{"status": "implementing"}'::jsonb WHERE id = $1`,
      [alertId]
    );

    res.json({ success: true, message: 'Implementation started for ' + alert.agent_name, alertId, agentKey });

    // Run implementation asynchronously (don't block the response)
    let scheduler;
    try { scheduler = require('../scheduler'); } catch (_) {}
    if (scheduler && scheduler.implementAlert) {
      scheduler.implementAlert(agentKey, report, alertId).then(result => {
        console.log('[rv-control] Implementation complete for alert ' + alertId + ':', JSON.stringify(result).substring(0, 200));
        broadcastUpdate();
      }).catch(err => {
        console.error('[rv-control] Implementation failed for alert ' + alertId + ':', err.message);
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/reports?limit=50&agent= */
app.get('/api/reports', async (req, res) => {
  try {
    const limit     = parseInt(req.query.limit || '50');
    const agentName = req.query.agent || null;
    res.json(await db.getReports(limit, agentName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/content?limit=20&type= */
app.get('/api/content', async (req, res) => {
  try {
    const limit       = parseInt(req.query.limit || '20');
    const contentType = req.query.type || null;
    res.json(await db.getGeneratedContent(limit, contentType));
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
app.get('/api/review/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM generated_content WHERE id = $1', [parseInt(req.params.id)]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });
    let meta = {};
    try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); } catch (_) {}
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
    const _res = await db.query('SELECT * FROM generated_content WHERE id = $1', [id]);
    const row = _res.rows[0];
    if (!row) return res.status(404).json({ error: 'Not found' });

    let extra = {};
    const PLATFORM_MAP = { 'twitter/x': 'twitter', 'twitter': 'twitter', 'x': 'twitter', 'linkedin': 'linkedin', 'instagram': 'instagram', 'facebook': 'facebook', 'tiktok': 'tiktok' };
    const normPlatform = (p) => p ? (PLATFORM_MAP[p.toLowerCase().trim()] || p.toLowerCase().trim()) : null;

    // Veo script approval — triggers Veo clip generation (costs money)
    if (row.content_type && row.content_type.startsWith('video-script-')) {
      let meta = {};
      try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); } catch (_) {}

      if (meta.status !== 'awaiting_veo_approval') {
        await db.updateContentReview(id, 'approved', { notes: req.body?.notes || '' });
      } else {
        await db.updateContentReview(id, 'approved_for_generation', { approvedAt: new Date().toISOString() });
        res.json({ success: true, id, status: 'generating', message: 'Veo generation started. You will see the final video in your review queue when complete.' });

        // Trigger generation in the background (don't block the HTTP response)
        const VeoVideoAgent = require('../agents/veo-video-agent-v2');
        const agent = new VeoVideoAgent();
        agent.generateApprovedVideo(id).then(function(result) {
          console.log('[rv-control] Veo generation complete for content ' + id + ':', result.status);
        }).catch(function(err) {
          console.error('[rv-control] Veo generation failed for content ' + id + ':', err.message);
        });
        return;
      }
    }
    // Video content - trigger YouTube upload
    else if (['video-office-journey', 'video-conference-room', 'video'].includes(row.content_type)) {
      let scheduler;
      try { scheduler = require('../scheduler'); } catch (_) {}
      const agent = scheduler?.getAgent('heygen-video');
      if (agent) {
        const ytResult = await agent.publishVideo(id);
        extra = { youtubeUrl: ytResult?.youtubeUrl, youtubeId: ytResult?.youtubeId };
      }
      await db.updateContentReview(id, 'approved', { notes: req.body?.notes || '' });
    }
    // Social posts - unpack and distribute across the week
    else if (row.content_type === 'social-posts') {
      await db.updateContentReview(id, 'approved', { notes: req.body?.notes || '' });
      let posts = [];
      try { const raw = typeof row.content === 'string' ? JSON.parse(row.content) : row.content; posts = Array.isArray(raw) ? raw : []; } catch (_) {}
      let meta = {};
      try { meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}); } catch (_) {}
      const defaultPlatform = normPlatform(meta.platform);

      // Distribute posts across next 7 days based on platform cadence (Denver time)
      const DAILY_CADENCE = { twitter: 3, linkedin: 1 };
      const nowDenver = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Denver' }));
      const tomorrow = new Date(nowDenver); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0,0,0,0);
      const weekEnd = new Date(tomorrow); weekEnd.setDate(weekEnd.getDate() + 7);
      const slotCounts = {};
      try {
        const existing = await db.query(
          `SELECT scheduled_date::text AS d, platform, COUNT(*)::int AS cnt FROM content_posts
           WHERE scheduled_date >= $1 AND scheduled_date < $2 AND status IN ('approved','published')
           GROUP BY scheduled_date, platform`,
          [tomorrow.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
        );
        for (const r of existing.rows) slotCounts[r.d + '_' + r.platform] = r.cnt;
      } catch (_) {}

      function nextDateFor(plat) {
        const max = DAILY_CADENCE[plat] || 2;
        for (let d = 0; d < 7; d++) {
          const dt = new Date(tomorrow); dt.setDate(dt.getDate() + d);
          const ds = dt.toISOString().split('T')[0];
          const key = ds + '_' + plat;
          if ((slotCounts[key] || 0) < max) { slotCounts[key] = (slotCounts[key] || 0) + 1; return ds; }
        }
        return tomorrow.toISOString().split('T')[0];
      }

      let postsInserted = 0;
      const scheduledDates = [];
      for (const post of posts) {
        const platform = normPlatform(post.platform) || defaultPlatform;
        if (!platform) continue;
        let content = post.content || '';
        if (post.cta && !content.includes(post.cta)) content += '\n\n' + post.cta;
        let hashtags = '';
        if (Array.isArray(post.hashtags)) hashtags = post.hashtags.map(h => h.startsWith('#') ? h : '#' + h).join(' ');
        else if (typeof post.hashtags === 'string') hashtags = post.hashtags;
        const postDate = req.body?.scheduledDate || nextDateFor(platform);
        try {
          await db.query('INSERT INTO content_posts (platform, content, hashtags, scheduled_date, scheduled_time, status) VALUES ($1,$2,$3,$4,$5,$6)', [platform, content, hashtags, postDate, '09:00:00', 'approved']);
          postsInserted++;
          if (!scheduledDates.includes(postDate)) scheduledDates.push(postDate);
        } catch (e) { console.error('[rv-control] Insert post failed:', e.message); }
      }
      extra = { postsInserted, scheduledDates };
    }
    // All other content - just mark approved
    else {
      await db.updateContentReview(id, 'approved', { notes: req.body?.notes || '' });
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
app.post('/api/review/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.updateContentReview(id, 'rejected', { reason: req.body?.reason || '' });
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
app.put('/api/review/:id', async (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const _r = await db.query('SELECT * FROM generated_content WHERE id = $1', [id]);
    const row = _r.rows[0];
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
    await db.query(`UPDATE generated_content SET ${updates.join(', ')} WHERE id = $${params.length}`, params);

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
app.get('/api/videos', async (req, res) => {
  try {
    const { status, limit = '50' } = req.query;
    let rows;
    let result;
    if (status) {
      result = await db.query(`
        SELECT id, title, url, metadata, created_at
        FROM   generated_content
        WHERE  content_type IN ('video-office-journey','video-conference-room','video')
          AND  metadata->>'status' = $1
        ORDER  BY created_at DESC
        LIMIT  $2
      `, [status, parseInt(limit)]);
    } else {
      result = await db.query(`
        SELECT id, title, url, metadata, created_at
        FROM   generated_content
        WHERE  content_type IN ('video-office-journey','video-conference-room','video')
        ORDER  BY created_at DESC
        LIMIT  $1
      `, [parseInt(limit)]);
    }
    rows = result.rows;
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
