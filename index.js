require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const JWT_SECRET_MAIN = process.env.JWT_SECRET || 'rv_jwt_secret_2026';
const cors = require('cors');
const morgan = require('morgan');
const redis = require('redis');
const pool = require('./db');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'API rate limit exceeded, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));

const paymentsRouter = require('./payments');
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

const authRoutes = require('./auth');
const webhookRoutes = require('./webhooks');
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/webhooks', apiLimiter, webhookRoutes);
app.use('/api/payments', paymentsRouter);
app.get('/rv-control', (req, res) => { res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"); res.sendFile('dashboard.html', { root: '/home/vaultadmin/residualvault/' }); });
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/keywords', require('./routes/keywords'));

const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.get('/api/protocols', async (req, res) => {
  try {
    const cached = await redisClient.get('protocols');
    if (cached) return res.json(JSON.parse(cached));
    const result = await pool.query('SELECT * FROM protocols ORDER BY name');
    await redisClient.setEx('protocols', 300, JSON.stringify(result.rows));
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/rewards', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.name, p.chain, p.category, p.slug,
        vr.apy, vr.token, vr.fetched_at
      FROM protocols p
      JOIN vault_rewards vr ON vr.protocol_id = p.id
      ORDER BY p.id, vr.fetched_at DESC
    `);
    const sorted = result.rows.sort((a, b) => b.apy - a.apy);
    res.json(sorted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/rewards/:slug', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vr.apy, vr.fetched_at
      FROM vault_rewards vr
      JOIN protocols p ON p.id = vr.protocol_id
      WHERE p.slug = $1
      ORDER BY vr.fetched_at DESC
      LIMIT 48
    `, [req.params.slug]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// SEO Pre-rendering for frontend pages
const { seoPrerender } = require("./seo-prerender");
app.use(seoPrerender);

app.listen(PORT, () => console.log(`ResidualVault API running on port ${PORT}`));
module.exports = { pool, redisClient };

app.get('/api/protocols/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.name, p.chain, p.category, p.slug,
        COALESCE(vr.apy, 0) as apy,
        vr.token, vr.fetched_at
      FROM protocols p
      LEFT JOIN vault_rewards vr ON vr.protocol_id = p.id
      ORDER BY p.id, vr.fetched_at DESC NULLS LAST
    `);
    const sorted = result.rows.sort((a, b) => b.apy - a.apy);
    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/blog/posts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM content_queue 
      WHERE platform='blog' AND status='approved'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/blog/posts', async (req, res) => {
  try {
    const { title, content, agent } = req.body;
    await pool.query(
      'INSERT INTO content_queue (agent, platform, content, status, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [agent || 'Agent3', 'blog', content, 'approved']
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: 'Missing required fields' });
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: process.env.NOTIFY_EMAIL,
      from: process.env.EMAIL_FROM,
      subject: `Contact form: ${subject || 'New message'} from ${name}`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px;">
          <h2>New contact form submission</h2>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subject || 'N/A'}</p>
          <p><strong>Message:</strong></p>
          <p>${message}</p>
        </div>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Contact]', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

const compatRoutes = require('./compat');
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1', apiLimiter, compatRoutes);

app.get('/api/protocols/:slug', async (req, res) => {
  try {
    const protocol = await pool.query(
      'SELECT * FROM protocols WHERE slug=$1', [req.params.slug]
    );
    if (!protocol.rows.length) return res.status(404).json({ error: 'Protocol not found' });
    
    const rewards = await pool.query(`
      SELECT apy, token, fetched_at FROM vault_rewards
      WHERE protocol_id=$1
      ORDER BY fetched_at DESC LIMIT 48
    `, [protocol.rows[0].id]);

    const latest = rewards.rows[0];
    const high = Math.max(...rewards.rows.map(r => parseFloat(r.apy)));
    const low = Math.min(...rewards.rows.map(r => parseFloat(r.apy)));
    const avg = rewards.rows.reduce((s, r) => s + parseFloat(r.apy), 0) / rewards.rows.length;

    res.json({
      ...protocol.rows[0],
      current_apy: latest?.apy || 0,
      token: latest?.token,
      high_apy: high,
      low_apy: low,
      avg_apy: avg.toFixed(4),
      history: rewards.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

const { generateSitemap } = require('./sitemap');
app.get('/sitemap.xml', async (req, res) => {
  try {
    const xml = await generateSitemap();
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    res.status(500).send('Error generating sitemap');
  }
});

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const { email, firstName, source } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const existing = await pool.query('SELECT id FROM newsletter_subscribers WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'Already subscribed' });

    await pool.query(
      'INSERT INTO newsletter_subscribers (email, first_name, source) VALUES ($1, $2, $3)',
      [email.toLowerCase(), firstName || '', source || 'website']
    );

    await sgMail.send({
      to: email,
      from: process.env.EMAIL_FROM,
      subject: '🎉 Welcome to ResidualVault — You\'re subscribed!',
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f13; padding: 24px; border-radius: 16px;">
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%); border: 1px solid #2a2a3a; border-radius: 16px 16px 0 0; padding: 32px 24px; text-align: center;"><img src="https://residualvault.com/images/rv-shield.png" alt="ResidualVault" width="48" height="48" style="display: block; margin: 0 auto 12px;">
            <h1 style="color: white; margin: 0; font-size: 22px;">ResidualVault</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 4px 0 0;">Welcome to the community!</p>
          </div>
          <div style="background: #16161d; border: 1px solid #2a2a3a; border-radius: 12px; padding: 24px; margin-bottom: 20px;">
            <p style="color: #ccc; margin: 0 0 16px;">Hi ${firstName || 'there'}! 👋</p>
            <p style="color: #ccc; margin: 0 0 16px;">You're now subscribed to ResidualVault — your source for the best crypto staking rates, DeFi guides, and passive income strategies.</p>
            <p style="color: #ccc; margin: 0 0 20px;">Here's what you'll get:</p>
            <ul style="color: #aaa; margin: 0 0 20px; padding-left: 20px; line-height: 2;">
              <li>📊 Weekly APY rate updates across 156+ protocols</li>
              <li>📚 In-depth staking guides and tutorials</li>
              <li>🚨 APY change alerts for your favorite protocols</li>
              <li>💡 DeFi strategies to maximize your returns</li>
            </ul>
            <a href="https://residualvault.com/staking" style="display: block; text-align: center; background: #6c63ff; color: white; padding: 14px; border-radius: 10px; text-decoration: none; font-weight: 600;">
              Explore 156+ Staking Protocols →
            </a>
          </div>
          <p style="text-align: center; color: #444; font-size: 12px;">
            You can unsubscribe at any time by replying to this email.
          </p>
        </div>
      `
    });

    await sgMail.send({
      to: process.env.NOTIFY_EMAIL,
      from: process.env.EMAIL_FROM,
      subject: `📧 New newsletter subscriber: ${email}`,
      html: `<p>New subscriber: <strong>${email}</strong>${firstName ? ` (${firstName})` : ''} via ${source || 'website'}</p>`
    });

    res.json({ success: true, message: 'Successfully subscribed!' });
  } catch (err) {
    console.error('[Newsletter]', err.message);
    res.status(500).json({ error: 'Subscription failed' });
  }
});

app.get('/api/newsletter/count', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM newsletter_subscribers WHERE status=$1', ['active']);
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

// Admin middleware
const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};


// ─── AUTH MIDDLEWARE FOR GATING ─────────────────────────────────────────────

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try { req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_MAIN); } catch (e) {}
  }
  next();
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', upgrade: true });
  }
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_MAIN);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token', upgrade: true });
  }
}

// ─── USER APY ALERTS ────────────────────────────────────────────────────────

app.get('/api/alerts', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ua.*, p.name as protocol_name, p.slug, p.chain,
        (SELECT vr.apy FROM vault_rewards vr WHERE vr.protocol_id = ua.protocol_id ORDER BY vr.fetched_at DESC LIMIT 1) as current_apy
      FROM user_apy_alerts ua
      JOIN protocols p ON p.id = ua.protocol_id
      WHERE ua.user_id = $1
      ORDER BY ua.created_at DESC
    `, [req.user.id]);
    res.json({ alerts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

app.post('/api/alerts', requireAuth, async (req, res) => {
  try {
    const { protocol_id, direction, threshold } = req.body;
    if (!protocol_id || !direction || !threshold) {
      return res.status(400).json({ error: 'protocol_id, direction, and threshold are required' });
    }
    const user = await pool.query('SELECT plan FROM users WHERE id=$1', [req.user.id]);
    const plan = user.rows[0]?.plan || 'free';
    if (plan === 'free') {
      const count = await pool.query('SELECT COUNT(*) FROM user_apy_alerts WHERE user_id=$1 AND is_active=true', [req.user.id]);
      if (parseInt(count.rows[0].count) >= 1) {
        return res.status(403).json({
          error: 'Free plan allows 1 active alert. Upgrade to Starter for unlimited alerts.',
          upgrade: true, limit: 1, current: parseInt(count.rows[0].count)
        });
      }
    }
    const result = await pool.query(
      `INSERT INTO user_apy_alerts (user_id, protocol_id, direction, threshold)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, protocol_id, direction) DO UPDATE SET threshold=$4, is_active=true
       RETURNING *`,
      [req.user.id, protocol_id, direction, threshold]
    );
    res.status(201).json({ alert: result.rows[0] });
  } catch (err) {
    console.error('[Alerts]', err.message);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

app.delete('/api/alerts/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE user_apy_alerts SET is_active=false WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

// ─── GATED PROTOCOL DETAIL ─────────────────────────────────────────────────

app.get('/api/protocols/:slug/detail', optionalAuth, async (req, res) => {
  try {
    const protocol = await pool.query('SELECT * FROM protocols WHERE slug=$1', [req.params.slug]);
    if (!protocol.rows.length) return res.status(404).json({ error: 'Protocol not found' });
    const rewards = await pool.query(
      'SELECT apy, token, fetched_at FROM vault_rewards WHERE protocol_id=$1 ORDER BY fetched_at DESC LIMIT 48',
      [protocol.rows[0].id]
    );
    const latest = rewards.rows[0];
    const high = rewards.rows.length ? Math.max(...rewards.rows.map(r => parseFloat(r.apy))) : 0;
    const low = rewards.rows.length ? Math.min(...rewards.rows.map(r => parseFloat(r.apy))) : 0;
    const avg = rewards.rows.length ? (rewards.rows.reduce((s, r) => s + parseFloat(r.apy), 0) / rewards.rows.length) : 0;
    const base = { ...protocol.rows[0], current_apy: latest?.apy || 0, token: latest?.token };

    if (!req.user) {
      return res.json({
        ...base,
        high_apy: null, low_apy: null, avg_apy: null,
        history: rewards.rows.slice(0, 3),
        gated: true,
        gatedFields: ['high_apy', 'low_apy', 'avg_apy', 'full_history'],
        message: 'Create a free account to see full APY history, highs, lows, and averages.'
      });
    }
    const userRow = await pool.query('SELECT plan FROM users WHERE id=$1', [req.user.id]);
    const plan = userRow.rows[0]?.plan || 'free';
    const historyLimit = plan === 'free' ? 12 : 48;
    res.json({
      ...base, high_apy: high, low_apy: low, avg_apy: avg.toFixed(4),
      history: rewards.rows.slice(0, historyLimit), gated: false, plan
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── PLAN LIMITS ────────────────────────────────────────────────────────────

app.get('/api/plan/limits', optionalAuth, async (req, res) => {
  if (!req.user) {
    return res.json({
      authenticated: false, plan: null,
      limits: { comparisons: 2, alerts: 0, historyDepth: 3, riskAnalysis: false, taxReporting: false, apiAccess: false },
      upgradeMessage: 'Create a free account to compare protocols, set alerts, and track your staking portfolio.'
    });
  }
  const user = await pool.query('SELECT plan FROM users WHERE id=$1', [req.user.id]);
  const plan = user.rows[0]?.plan || 'free';
  const planLimits = {
    free:    { comparisons: 3, alerts: 1, historyDepth: 12, riskAnalysis: false, taxReporting: false, apiAccess: false },
    starter: { comparisons: -1, alerts: -1, historyDepth: 48, riskAnalysis: false, taxReporting: false, apiAccess: false },
    pro:     { comparisons: -1, alerts: -1, historyDepth: 48, riskAnalysis: true,  taxReporting: true,  apiAccess: false },
    premium: { comparisons: -1, alerts: -1, historyDepth: 48, riskAnalysis: true,  taxReporting: true,  apiAccess: true  },
  };
  res.json({ authenticated: true, plan, limits: planLimits[plan] || planLimits.free });
});

// Admin stats
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const [users, protocols, subscribers, uptime, alerts, rewards] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM protocols'),
      pool.query('SELECT COUNT(*) FROM newsletter_subscribers WHERE status=$1', ['active']),
      pool.query('SELECT status, COUNT(*) FROM uptime_logs GROUP BY status'),
      pool.query('SELECT COUNT(*) FROM apy_alerts WHERE created_at > NOW() - INTERVAL \'24 hours\''),
      pool.query('SELECT COUNT(*) FROM vault_rewards'),
    ]);
    res.json({
      users: parseInt(users.rows[0].count),
      protocols: parseInt(protocols.rows[0].count),
      subscribers: parseInt(subscribers.rows[0].count),
      uptime: uptime.rows,
      alertsToday: parseInt(alerts.rows[0].count),
      apyRecords: parseInt(rewards.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin users list
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, plan, created_at, last_login FROM users ORDER BY created_at DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin protocols list
app.get('/api/admin/protocols', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, vr.apy, vr.fetched_at
      FROM protocols p
      LEFT JOIN LATERAL (
        SELECT apy, fetched_at FROM vault_rewards
        WHERE protocol_id = p.id
        ORDER BY fetched_at DESC LIMIT 1
      ) vr ON true
      ORDER BY p.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin update protocol APY
app.patch('/api/admin/protocols/:id', adminAuth, async (req, res) => {
  try {
    const { apy } = req.body;
    const { id } = req.params;
    await pool.query(
      'INSERT INTO vault_rewards (protocol_id, apy, token, fetched_at) VALUES ($1, $2, (SELECT chain FROM protocols WHERE id=$1), NOW())',
      [id, apy]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin subscribers list
app.get('/api/admin/subscribers', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, first_name, source, status, created_at FROM newsletter_subscribers ORDER BY created_at DESC LIMIT 100'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin uptime logs
app.get('/api/admin/uptime', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM uptime_logs ORDER BY checked_at DESC LIMIT 50'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin APY alerts
app.get('/api/admin/apy-alerts', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, p.name as protocol_name, p.chain
      FROM apy_alerts a
      JOIN protocols p ON p.id = a.protocol_id
      ORDER BY a.created_at DESC LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const { category, limit = 20 } = req.query;
    let query = `
      SELECT DISTINCT ON (p.id)
        p.id, p.name, p.slug, p.chain, p.category,
        vr.apy, vr.fetched_at
      FROM protocols p
      JOIN vault_rewards vr ON vr.protocol_id = p.id
      WHERE vr.apy > 0
    `;
    const params = [];
    if (category && category !== 'all') {
      params.push(category);
      query += ` AND p.category = $${params.length}`;
    }
    query += ` ORDER BY p.id, vr.fetched_at DESC`;
    query = `SELECT * FROM (${query}) sub ORDER BY apy DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error('[Leaderboard]', err.message);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.get('/api/protocols/:slug/related', async (req, res) => {
  try {
    const protocol = await pool.query('SELECT * FROM protocols WHERE slug=$1', [req.params.slug]);
    if (!protocol.rows.length) return res.status(404).json({ error: 'Not found' });
    const p = protocol.rows[0];

    const related = await pool.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.name, p.slug, p.chain, p.category,
        vr.apy
      FROM protocols p
      JOIN vault_rewards vr ON vr.protocol_id = p.id
      WHERE p.id != $1
        AND (p.category = $2 OR p.chain = $3)
        AND vr.apy > 0
      ORDER BY p.id, vr.fetched_at DESC
      LIMIT 4
    `, [p.id, p.category, p.chain]);

    res.json({ data: related.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/top-movers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id, a.previous_apy, a.new_apy, a.change_percent, a.direction, a.created_at,
        p.name, p.slug, p.chain, p.category
      FROM apy_alerts a
      JOIN protocols p ON p.id = a.protocol_id
      WHERE a.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY ABS(a.change_percent) DESC
      LIMIT 8
    `);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LinkedIn OAuth callback
app.get('/api/auth/linkedin/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');
  try {
    const axios = require('axios');
    const tokenRes = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
      params: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://64.23.240.10/api/auth/linkedin/callback',
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      }
    });
    const accessToken = tokenRes.data.access_token;
    res.send(`<h2>LinkedIn Connected!</h2><p>Add this to your .env:</p><pre>LINKEDIN_ACCESS_TOKEN=${accessToken}</pre>`);
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// Temporary logo download route
app.get('/rv-logo', (req, res) => {
  res.download('/home/vaultadmin/residualvault/rv-logo-1024.png', 'rv-logo-1024.png');
});




// ─── EDUCATION COURSES API ────────────────────────────────────────
const COURSES = [
  { id: 1, title: 'Crypto Staking 101', category: 'Beginner', duration: '15 min', lessonsCount: 5, tier: 'free', level: 'beginner', description: 'Learn the fundamentals of crypto staking, how it works, and why it generates passive income.', thumbnail: null, totalLessons: 5 },
  { id: 2, title: 'Understanding APY vs APR', category: 'Beginner', duration: '10 min', lessonsCount: 3, tier: 'free', level: 'beginner', description: 'Understand the difference between APY and APR and why it matters for your staking returns.', thumbnail: null, totalLessons: 3 },
  { id: 3, title: 'Liquid Staking Deep Dive', category: 'Intermediate', duration: '20 min', lessonsCount: 6, tier: 'free', level: 'intermediate', description: 'Explore liquid staking protocols like Lido and Rocket Pool, and how liquid staking tokens work.', thumbnail: null, totalLessons: 6 },
  { id: 4, title: 'ATOM & Cosmos Staking Guide', category: 'Intermediate', duration: '18 min', lessonsCount: 5, tier: 'free', level: 'intermediate', description: 'A complete guide to staking ATOM on the Cosmos Hub, choosing validators, and maximizing rewards.', thumbnail: null, totalLessons: 5 },
  { id: 5, title: 'DeFi Yield Strategies', category: 'Advanced', duration: '25 min', lessonsCount: 7, tier: 'pro', level: 'advanced', description: 'Advanced DeFi yield strategies including liquidity provision, yield farming, and risk management.', thumbnail: null, totalLessons: 7 },
  { id: 6, title: 'Building a Staking Portfolio', category: 'Advanced', duration: '30 min', lessonsCount: 8, tier: 'pro', level: 'advanced', description: 'Build a diversified staking portfolio that balances risk, liquidity, and returns.', thumbnail: null, totalLessons: 8 }
];
app.get('/api/v1/education/courses', (req, res) => { res.json({ success: true, data: COURSES, total: COURSES.length }); });
app.get('/api/v1/education/courses/:courseId', (req, res) => { const c = COURSES.find(x => x.id === parseInt(req.params.courseId)); if (!c) return res.status(404).json({ success: false }); res.json({ success: true, data: c }); });
app.post('/api/v1/education/courses/:courseId/enroll', (req, res) => { res.json({ success: true, message: 'Enrolled' }); });
app.get('/api/v1/education/progress', (req, res) => { res.json({ success: true, data: { completedCourses: 0, totalCourses: 6, completedLessons: 0 } }); });
app.get('/api/v1/education/certificates', (req, res) => { res.json({ success: true, data: [] }); });
app.get('/api/v1/education/leaderboard', (req, res) => { res.json({ success: true, data: [] }); });

// ─── PROTOCOL WATCHLIST & APY ALERTS ──────────────────────────────
app.post('/api/watchlist/add', async (req, res) => {
  try {
    const { email, protocolId, alertThreshold, alertDirection } = req.body;
    if (!email || !protocolId) return res.status(400).json({ error: 'Email and protocolId required' });

    const existing = await pool.query(
      'SELECT id FROM protocol_watchlist WHERE email=$1 AND protocol_id=$2',
      [email.toLowerCase(), protocolId]
    );
    if (existing.rows.length) {
      await pool.query(
        'UPDATE protocol_watchlist SET alert_threshold=$1, alert_direction=$2 WHERE email=$3 AND protocol_id=$4',
        [alertThreshold || 5.0, alertDirection || 'both', email.toLowerCase(), protocolId]
      );
      return res.json({ success: true, message: 'Watchlist updated' });
    }

    await pool.query(
      'INSERT INTO protocol_watchlist (email, protocol_id, alert_threshold, alert_direction) VALUES ($1, $2, $3, $4)',
      [email.toLowerCase(), protocolId, alertThreshold || 5.0, alertDirection || 'both']
    );

    // Auto-subscribe to newsletter if not already
    const sub = await pool.query('SELECT id FROM newsletter_subscribers WHERE email=$1', [email.toLowerCase()]);
    if (!sub.rows.length) {
      await pool.query(
        'INSERT INTO newsletter_subscribers (email, first_name, source) VALUES ($1, $2, $3)',
        [email.toLowerCase(), '', 'watchlist']
      );
    }

    res.json({ success: true, message: 'Protocol added to watchlist' });
  } catch (err) {
    console.error('[Watchlist]', err.message);
    res.status(500).json({ error: 'Failed to add to watchlist' });
  }
});

app.get('/api/watchlist/:email', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.id, w.protocol_id, w.alert_threshold, w.alert_direction,
             p.name, p.slug, p.chain, COALESCE(vr.apy, 0) as current_apy
      FROM protocol_watchlist w
      JOIN protocols p ON p.id = w.protocol_id
      LEFT JOIN LATERAL (
        SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1
      ) vr ON true
      WHERE w.email = $1
      ORDER BY p.name
    `, [req.params.email.toLowerCase()]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

app.delete('/api/watchlist/:email/:protocolId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM protocol_watchlist WHERE email=$1 AND protocol_id=$2',
      [req.params.email.toLowerCase(), req.params.protocolId]
    );
    res.json({ success: true, message: 'Removed from watchlist' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from watchlist' });
  }
});

// ─── SHAREABLE CALCULATOR RESULTS ─────────────────────────────────
app.get('/api/calculator/share', async (req, res) => {
  try {
    const { protocols: protocolIds, amounts, years, compound } = req.query;
    if (!protocolIds) return res.status(400).json({ error: 'protocols param required' });

    const ids = protocolIds.split(',').map(Number);
    const amts = (amounts || '1000').split(',').map(Number);
    const yrs = parseInt(years) || 1;
    const comp = compound || 'monthly';

    const result = await pool.query(`
      SELECT p.id, p.name, p.slug, p.chain, COALESCE(vr.apy, 0) as apy
      FROM protocols p
      LEFT JOIN LATERAL (
        SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1
      ) vr ON true
      WHERE p.id = ANY($1)
    `, [ids]);

    const compN = { daily: 365, monthly: 12, yearly: 1, none: 0 };
    const n = compN[comp] || 12;

    const calculations = result.rows.map((p, i) => {
      const amount = amts[i] || amts[0] || 1000;
      const rate = parseFloat(p.apy) / 100;
      let total;
      if (comp === 'none') {
        total = amount + (amount * rate * yrs);
      } else {
        total = amount * Math.pow(1 + rate / n, n * yrs);
      }
      return {
        protocol: p.name,
        chain: p.chain,
        apy: parseFloat(p.apy).toFixed(2),
        invested: amount,
        totalValue: total.toFixed(2),
        earnings: (total - amount).toFixed(2),
        dailyEarnings: ((total - amount) / (yrs * 365)).toFixed(2)
      };
    });

    const totalInvested = calculations.reduce((s, c) => s + c.invested, 0);
    const totalValue = calculations.reduce((s, c) => s + parseFloat(c.totalValue), 0);

    res.json({
      success: true,
      data: {
        calculations,
        summary: {
          totalInvested,
          totalValue: totalValue.toFixed(2),
          totalEarnings: (totalValue - totalInvested).toFixed(2),
          years: yrs,
          compounding: comp
        },
        shareText: `I'd earn $${(totalValue - totalInvested).toFixed(2)} staking $${totalInvested.toLocaleString()} over ${yrs} year${yrs > 1 ? 's' : ''} — check yours at residualvault.com/calculator`
      }
    });
  } catch (err) {
    console.error('[Calculator Share]', err.message);
    res.status(500).json({ error: 'Failed to generate share data' });
  }
});

// ─── TOP COIN SEO PAGES ──────────────────────────────────────────
app.get('/api/staking/:coin', async (req, res) => {
  try {
    const coin = req.params.coin.toLowerCase();
    const result = await pool.query(`
      SELECT p.id, p.name, p.slug, p.chain, p.category,
             COALESCE(vr.apy, 0) as apy
      FROM protocols p
      LEFT JOIN LATERAL (
        SELECT apy FROM vault_rewards WHERE protocol_id = p.id ORDER BY fetched_at DESC LIMIT 1
      ) vr ON true
      WHERE LOWER(p.chain) = $1 OR LOWER(p.name) LIKE $2
      ORDER BY vr.apy DESC
    `, [coin, '%' + coin + '%']);

    if (!result.rows.length) return res.status(404).json({ error: 'No protocols found for ' + coin });

    res.json({
      success: true,
      coin: coin,
      protocolCount: result.rows.length,
      data: result.rows.map(r => ({
        name: r.name,
        slug: r.slug,
        chain: r.chain,
        category: r.category,
        apy: parseFloat(r.apy).toFixed(2)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coin data' });
  }
});
