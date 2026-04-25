const express = require('express');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'rv_jwt_secret_2026';

const getStripe = () => require('stripe')(process.env.STRIPE_SECRET_KEY);

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No token provided' } });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
  }
};

router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) return res.status(400).json({ error: { message: 'Email and password required' } });
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: { message: 'Email already registered' } });
    const password_hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, plan, first_name, last_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, plan, first_name, last_name, created_at',
      [email.toLowerCase(), password_hash, 'free', firstName || '', lastName || '']
    );
    const user = result.rows[0];
    const accessToken = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ data: { tokens: { accessToken, refreshToken: accessToken }, user: { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, plan: user.plan, tier: user.plan } } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: { message: 'Email and password required' } });
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!result.rows.length) return res.status(401).json({ error: { message: 'Invalid credentials' } });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: { message: 'Invalid credentials' } });
    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const accessToken = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ data: { tokens: { accessToken, refreshToken: accessToken }, user: { id: user.id, email: user.email, firstName: user.first_name || '', lastName: user.last_name || '', plan: user.plan, tier: user.plan } } });
  } catch (err) {
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

router.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'No refresh token' } });
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const accessToken = jwt.sign({ id: decoded.id, email: decoded.email, plan: decoded.plan }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ data: { accessToken } });
  } catch (err) {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid refresh token' } });
  }
});

router.get('/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, plan, first_name, last_name, created_at, last_login FROM users WHERE id=$1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: { message: 'User not found' } });
    const user = result.rows[0];
    res.json({ data: { user: { ...user, firstName: user.first_name, lastName: user.last_name, tier: user.plan } } });
  } catch (err) {
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

router.post('/auth/logout', authMiddleware, (req, res) => {
  res.json({ data: { message: 'Logged out successfully' } });
});

router.put('/auth/profile', authMiddleware, async (req, res) => {
  try {
    res.json({ data: { user: { id: req.user.id, email: req.user.email, plan: req.user.plan, tier: req.user.plan } } });
  } catch (err) {
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

router.get('/staking/options', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.name, p.slug, p.chain as network, p.category,
        COALESCE(vr.apy, 0) as apy,
        COALESCE(vr.apy, 0) as current_apy,
        vr.token, vr.fetched_at as last_updated,
        p.name as provider,
        p.description, p.website, p.stake_url,
        p.lock_period, p.min_deposit, p.logo_url,
        p.audit, p.rewards, p.network as chain_network,
        COALESCE(p.risk_level, CASE p.category
          WHEN 'native-staking' THEN 'low'
          WHEN 'liquid-staking' THEN 'medium'
          WHEN 'defi-yield' THEN 'high'
          ELSE 'medium'
        END) as risk_level
      FROM protocols p
      LEFT JOIN vault_rewards vr ON vr.protocol_id = p.id
      ORDER BY p.id, vr.fetched_at DESC NULLS LAST
    `);
    const sorted = result.rows.sort((a, b) => parseFloat(b.apy) - parseFloat(a.apy)).map(r => ({
      ...r,
      symbol: r.token || r.network || '',
      stakeUrl: r.stake_url,
      riskLevel: r.risk_level,
      lockPeriod: r.lock_period,
      minDeposit: r.min_deposit,
      logoUrl: r.logo_url,
      current_apy: r.apy
    }));
    res.json({ data: { options: sorted, total: sorted.length } });
  } catch (err) {
    res.status(500).json({ error: { message: 'Database error' } });
  }
});

router.post('/staking/compare', async (req, res) => {
  try {
    const { optionIds } = req.body;
    if (!optionIds || !optionIds.length) return res.status(400).json({ error: { message: 'No options provided' } });
    const result = await pool.query(`
      SELECT DISTINCT ON (p.id)
        p.id, p.name, p.slug, p.chain as network, p.category,
        COALESCE(vr.apy, 0) as apy, vr.token
      FROM protocols p
      LEFT JOIN vault_rewards vr ON vr.protocol_id = p.id
      WHERE p.id = ANY($1)
      ORDER BY p.id, vr.fetched_at DESC NULLS LAST
    `, [optionIds]);
    res.json({ data: { comparison: result.rows } });
  } catch (err) {
    res.status(500).json({ error: { message: 'Database error' } });
  }
});

router.post('/staking/track-click', (req, res) => {
  res.json({ data: { tracked: true } });
});

router.get('/portfolio', authMiddleware, async (req, res) => {
  res.json({ data: { positions: [], totalValue: 0, totalRewards: 0 } });
});

router.delete('/portfolio/positions/:id', authMiddleware, async (req, res) => {
  res.json({ data: { deleted: true } });
});

router.get('/education/courses', async (req, res) => {
  const COURSES = [
    { id: 1, title: 'Crypto Staking 101', category: 'Beginner', duration: '15 min', lessonsCount: 5, tier: 'free', level: 'beginner', description: 'Learn the fundamentals of crypto staking, how it works, and why it generates passive income.', thumbnail: null, totalLessons: 5 },
    { id: 2, title: 'Understanding APY vs APR', category: 'Beginner', duration: '10 min', lessonsCount: 3, tier: 'free', level: 'beginner', description: 'Understand the difference between APY and APR and why it matters for your staking returns.', thumbnail: null, totalLessons: 3 },
    { id: 3, title: 'Liquid Staking Deep Dive', category: 'Intermediate', duration: '20 min', lessonsCount: 6, tier: 'free', level: 'intermediate', description: 'Explore liquid staking protocols like Lido and Rocket Pool, and how liquid staking tokens work.', thumbnail: null, totalLessons: 6 },
    { id: 4, title: 'ATOM & Cosmos Staking Guide', category: 'Intermediate', duration: '18 min', lessonsCount: 5, tier: 'free', level: 'intermediate', description: 'A complete guide to staking ATOM on the Cosmos Hub, choosing validators, and maximizing rewards.', thumbnail: null, totalLessons: 5 },
    { id: 5, title: 'DeFi Yield Strategies', category: 'Advanced', duration: '25 min', lessonsCount: 7, tier: 'pro', level: 'advanced', description: 'Advanced DeFi yield strategies including liquidity provision, yield farming, and risk management.', thumbnail: null, totalLessons: 7 },
    { id: 6, title: 'Building a Staking Portfolio', category: 'Advanced', duration: '30 min', lessonsCount: 8, tier: 'pro', level: 'advanced', description: 'Build a diversified staking portfolio that balances risk, liquidity, and returns.', thumbnail: null, totalLessons: 8 }
  ];
  res.json({ data: { courses: COURSES }, success: true, total: COURSES.length });
});

router.get('/education/courses/:id', async (req, res) => {
  res.status(404).json({ error: { message: 'Course not found' } });
});

router.get('/education/lessons/:id', async (req, res) => {
  res.status(404).json({ error: { message: 'Lesson not found' } });
});

router.get('/education/progress', authMiddleware, async (req, res) => {
  res.json({ data: { progress: [] } });
});

router.post('/education/courses/:id/enroll', authMiddleware, async (req, res) => {
  res.json({ data: { enrolled: true } });
});

router.post('/education/lessons/:id/complete', authMiddleware, async (req, res) => {
  res.json({ data: { completed: true } });
});

router.post('/subscriptions/checkout', authMiddleware, async (req, res) => {
  try {
    const stripe = getStripe();
    const { priceId } = req.body;
    const user = await pool.query('SELECT email FROM users WHERE id=$1', [req.user.id]);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: user.rows[0].email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'http://residualvault.com/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://residualvault.com/pricing',
    });
    res.json({ data: { url: session.url, sessionId: session.id } });
  } catch (err) {
    console.error('[Stripe]', err.message);
    res.status(500).json({ error: { message: 'Failed to create checkout session' } });
  }
});

module.exports = router;

router.get('/staking/options/:slug', async (req, res) => {
  try {
    const protocol = await pool.query(
      'SELECT * FROM protocols WHERE slug=$1', [req.params.slug]
    );
    if (!protocol.rows.length) return res.status(404).json({ error: { message: 'Protocol not found' } });

    const rewards = await pool.query(`
      SELECT apy, token, fetched_at FROM vault_rewards
      WHERE protocol_id=$1
      ORDER BY fetched_at DESC LIMIT 48
    `, [protocol.rows[0].id]);

    const latest = rewards.rows[0];
    const apys = rewards.rows.map(r => parseFloat(r.apy));
    const high = apys.length ? Math.max(...apys) : 0;
    const low = apys.length ? Math.min(...apys) : 0;
    const avg = apys.length ? apys.reduce((s, a) => s + a, 0) / apys.length : 0;

    res.json({
      data: {
        option: {
          ...protocol.rows[0],
          apy: latest?.apy || 0,
          current_apy: latest?.apy || 0,
          token: latest?.token,
          network: protocol.rows[0].chain,
          stakeUrl: protocol.rows[0].stake_url,
          riskLevel: protocol.rows[0].risk_level || (protocol.rows[0].category === 'native-staking' ? 'low' : protocol.rows[0].category === 'liquid-staking' ? 'medium' : 'high'),
          risk_level: protocol.rows[0].risk_level || (protocol.rows[0].category === 'native-staking' ? 'low' : protocol.rows[0].category === 'liquid-staking' ? 'medium' : 'high'),
          lockPeriod: protocol.rows[0].lock_period,
          minDeposit: protocol.rows[0].min_deposit,
          high_apy: high,
          low_apy: low,
          avg_apy: avg.toFixed(4),
          history: rewards.rows
        }
      }
    });
  } catch (err) {
    res.status(500).json({ error: { message: 'Database error' } });
  }
});
