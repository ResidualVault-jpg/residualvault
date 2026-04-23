const express = require('express');
const pool = require('./db');
const { sendContentAlert, sendDailyReport } = require('./mailer');
const router = express.Router();

router.post('/content', async (req, res) => {
  try {
    const { agent, platform, content, scheduled_for, status } = req.body;
    await pool.query(
      'INSERT INTO content_queue (agent, platform, content, scheduled_for, status, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [agent, platform, content, scheduled_for, status || 'pending']
    );
    const countResult = await pool.query("SELECT COUNT(*) FROM content_queue WHERE status='pending'");
    const pendingCount = countResult.rows[0].count;
    await sendContentAlert(agent, platform, pendingCount);
    res.json({ success: true, message: 'Content queued' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to queue content' });
  }
});

router.post('/intel', async (req, res) => {
  try {
    const { agent, briefing, topics, opportunities } = req.body;
    await pool.query(
      'INSERT INTO agent_intel (agent, briefing, topics, opportunities, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [agent, briefing, JSON.stringify(topics || []), JSON.stringify(opportunities || [])]
    );
    res.json({ success: true, message: 'Intel stored' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to store intel' });
  }
});

router.post('/analytics', async (req, res) => {
  try {
    const { date, visitors, signups, revenue, top_source, social_stats } = req.body;
    await pool.query(
      'INSERT INTO analytics_log (date, visitors, signups, revenue, top_source, social_stats, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [date, visitors, signups, revenue, top_source, JSON.stringify(social_stats || {})]
    );
    res.json({ success: true, message: 'Analytics stored' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to store analytics' });
  }
});

router.post('/email', async (req, res) => {
  try {
    const { agent, subject, body, segment, scheduled_for } = req.body;
    await pool.query(
      'INSERT INTO email_queue (agent, subject, body, segment, scheduled_for, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())',
      [agent, subject, body, segment, scheduled_for, 'pending']
    );
    res.json({ success: true, message: 'Email queued' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to queue email' });
  }
});

router.post('/research', async (req, res) => {
  try {
    const { agent, topic, findings, sources } = req.body;
    await pool.query(
      'INSERT INTO research_log (agent, topic, findings, sources, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [agent, topic, findings, JSON.stringify(sources || [])]
    );
    res.json({ success: true, message: 'Research stored' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to store research' });
  }
});

router.post('/strategy', async (req, res) => {
  try {
    const { agent, week, summary, priorities, kpis } = req.body;
    await pool.query(
      'INSERT INTO strategy_log (agent, week, summary, priorities, kpis, created_at) VALUES ($1, $2, $3, $4, $5, NOW())',
      [agent, week, summary, JSON.stringify(priorities || []), JSON.stringify(kpis || {})]
    );
    res.json({ success: true, message: 'Strategy stored' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to store strategy' });
  }
});

router.get('/content/pending', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM content_queue WHERE status='pending' ORDER BY created_at DESC LIMIT 50"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/content/all', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM content_queue ORDER BY created_at DESC LIMIT 200'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.patch('/content/:id/approve', async (req, res) => {
  try {
    await pool.query("UPDATE content_queue SET status='approved' WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.patch('/content/:id/reject', async (req, res) => {
  try {
    await pool.query("UPDATE content_queue SET status='rejected' WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/report/daily', async (req, res) => {
  try {
    const pending = await pool.query("SELECT COUNT(*) FROM content_queue WHERE status='pending'");
    const approved = await pool.query("SELECT COUNT(*) FROM content_queue WHERE status='approved' AND created_at > NOW() - INTERVAL '24 hours'");
    await sendDailyReport({
      pending: pending.rows[0].count,
      approved: approved.rows[0].count
    });
    res.json({ success: true, message: 'Daily report sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send report' });
  }
});


// --- HeyGen Video Webhook ---
router.post('/heygen', async (req, res) => {
  try {
    const { event_type, event_data } = req.body || {};
    const videoId = event_data?.video_id;
    console.log('[HeyGen Webhook] Event:', event_type, 'Video:', videoId);

    if (!videoId) return res.json({ received: true });

    if (event_type === 'avatar_video.success' || event_type === 'video.success') {
      const videoUrl = event_data?.url || event_data?.video_url || null;
      const result = await pool.query(
        "SELECT id, metadata FROM generated_content WHERE metadata->>'videoId' = $1",
        [videoId]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        let meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        meta.status = 'ready_for_review';
        meta.videoUrl = videoUrl;
        meta.renderedAt = new Date().toISOString();
        await pool.query(
          'UPDATE generated_content SET metadata = $1, url = $2 WHERE id = $3',
          [JSON.stringify(meta), videoUrl, row.id]
        );
        console.log('[HeyGen Webhook] Video', videoId, 'marked ready_for_review');
      }
    } else if (event_type === 'avatar_video.fail' || event_type === 'video.fail') {
      const error = event_data?.error || event_data?.message || 'Unknown error';
      const result = await pool.query(
        "SELECT id, metadata FROM generated_content WHERE metadata->>'videoId' = $1",
        [videoId]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        let meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        meta.status = 'failed';
        meta.error = error;
        await pool.query(
          'UPDATE generated_content SET metadata = $1 WHERE id = $2',
          [JSON.stringify(meta), row.id]
        );
        console.log('[HeyGen Webhook] Video', videoId, 'FAILED:', error);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[HeyGen Webhook] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
