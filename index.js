require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
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
          <div style="background: linear-gradient(135deg, #6c63ff, #3ecfcf); padding: 24px; border-radius: 12px; margin-bottom: 24px;">
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
