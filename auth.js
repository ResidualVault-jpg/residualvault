const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'rv_jwt_secret_2026';
const EMAIL_FROM = process.env.EMAIL_FROM || 'support@residualvault.com';

router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });
    const password_hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, plan, first_name, last_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, plan, created_at',
      [email.toLowerCase(), password_hash, 'free', firstName || '', lastName || '']
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });

    const lowerEmail = email.toLowerCase();
    const displayName = firstName || 'there';

    // Auto-add to newsletter_subscribers so they receive weekly newsletters
    try {
      const existingSub = await pool.query('SELECT id FROM newsletter_subscribers WHERE email=$1', [lowerEmail]);
      if (!existingSub.rows.length) {
        await pool.query(
          'INSERT INTO newsletter_subscribers (email, first_name, source) VALUES ($1, $2, $3)',
          [lowerEmail, firstName || '', 'registration']
        );
        console.log(`[Auth] Auto-subscribed ${lowerEmail} to newsletter`);
      }
    } catch (subErr) {
      console.error(`[Auth] Newsletter auto-subscribe failed for ${lowerEmail}:`, subErr.message);
    }

    // Send welcome email with onboarding
    try {
      await sgMail.send({
        to: lowerEmail,
        from: EMAIL_FROM,
        subject: 'Welcome to ResidualVault — Start Comparing Staking Yields',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0f; padding: 0;">
            <div style="background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%); border: 1px solid #2a2a3a; border-radius: 16px 16px 0 0; padding: 32px 24px; text-align: center;">
              <img src="https://residualvault.com/images/rv-shield.png" alt="ResidualVault" width="48" height="48" style="display: block; margin: 0 auto 12px;">
              <h1 style="color: #ffffff; font-size: 22px; margin: 0; font-weight: 700;">Welcome to ResidualVault</h1>
              <p style="color: #3ecfcf; font-size: 13px; margin: 4px 0 0; text-transform: uppercase; letter-spacing: 1.5px;">Your Staking Intelligence Platform</p>
            </div>
            <div style="background: #16161d; border-left: 1px solid #2a2a3a; border-right: 1px solid #2a2a3a; padding: 24px;">
              <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">Hi ${displayName},</p>
              <p style="color: #ccc; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">You now have access to live APY data across 156+ staking protocols. Here's how to get the most out of ResidualVault:</p>
              <div style="background: #1a1a2e; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                <p style="color: #3ecfcf; font-size: 14px; font-weight: 600; margin: 0 0 12px;">3 THINGS TO DO RIGHT NOW:</p>
                <p style="color: #ccc; font-size: 14px; line-height: 1.8; margin: 0;">
                  <strong style="color: #fff;">1.</strong> <a href="https://residualvault.com/staking" style="color: #6c63ff; text-decoration: none;">Browse all 156+ protocols</a> — sorted by APY, chain, and risk level<br>
                  <strong style="color: #fff;">2.</strong> <a href="https://residualvault.com/calculator" style="color: #6c63ff; text-decoration: none;">Use the staking calculator</a> — see exactly what your stake would earn<br>
                  <strong style="color: #fff;">3.</strong> <a href="https://residualvault.com/leaderboard" style="color: #6c63ff; text-decoration: none;">Check the leaderboard</a> — find which protocols are trending this week
                </p>
              </div>
              <a href="https://residualvault.com/staking" style="display: block; text-align: center; background: linear-gradient(135deg, #3ecfcf, #6c63ff); color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; margin-bottom: 20px;">Start Comparing Protocols</a>
              <p style="color: #888; font-size: 13px; line-height: 1.6; margin: 0;">You'll also receive our weekly Staking Intelligence newsletter with APY updates, market analysis, and actionable staking strategies. Reply to this email anytime — we read every message.</p>
            </div>
            <div style="background: #0f0f1a; border: 1px solid #2a2a3a; border-radius: 0 0 16px 16px; padding: 16px 24px; text-align: center;">
              <p style="color: #555; font-size: 12px; margin: 0;">ResidualVault, LLC | Albuquerque, NM</p>
            </div>
          </div>`
      });
      console.log(`[Auth] Welcome email sent to ${lowerEmail}`);
    } catch (emailErr) {
      console.error(`[Auth] Welcome email failed for ${lowerEmail}:`, emailErr.message);
    }

    res.status(201).json({ token, user: { id: user.id, email: user.email, plan: user.plan } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, plan: user.plan } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT id, email, plan, created_at, last_login FROM users WHERE id=$1', [decoded.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
