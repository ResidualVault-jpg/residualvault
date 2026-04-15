const express = require('express');
const router = express.Router();
const pool = require('../db');

// Simple JWT auth middleware inline
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'rv_jwt_super_secret_2026_RV';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Get all posts - only current and future dates
router.get('/posts', authenticateToken, async (req, res) => {
  try {
    // Auto-delete expired unpublished content first
    await pool.query("DELETE FROM content_posts WHERE scheduled_date < CURRENT_DATE AND status NOT IN ('published')");
    const result = await pool.query(
      'SELECT * FROM content_posts WHERE scheduled_date >= CURRENT_DATE ORDER BY scheduled_date ASC, platform ASC'
    );
    res.json({ success: true, posts: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Approve a post
router.put('/posts/:id/approve', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      "UPDATE content_posts SET status = 'approved', updated_at = NOW() WHERE id = $1",
      [req.params.id]
    );
    res.json({ success: true, message: 'Post approved' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reject a post
router.put('/posts/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    await pool.query(
      "UPDATE content_posts SET status = 'rejected', rejection_reason = $2, updated_at = NOW() WHERE id = $1",
      [req.params.id, reason || 'No reason provided']
    );
    res.json({ success: true, message: 'Post rejected' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Edit a post
router.put('/posts/:id/edit', authenticateToken, async (req, res) => {
  try {
    const { content, hashtags } = req.body;
    await pool.query(
      'UPDATE content_posts SET content = $2, hashtags = $3, updated_at = NOW() WHERE id = $1',
      [req.params.id, content, hashtags]
    );
    res.json({ success: true, message: 'Post updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bulk approve by platform
router.put('/posts/bulk/approve', authenticateToken, async (req, res) => {
  try {
    const { platform } = req.body;
    const query = platform
      ? "UPDATE content_posts SET status = 'approved', updated_at = NOW() WHERE platform = $1 AND status = 'pending'"
      : "UPDATE content_posts SET status = 'approved', updated_at = NOW() WHERE status = 'pending'";
    const params = platform ? [platform] : [];
    const result = await pool.query(query, params);
    res.json({ success: true, message: `${result.rowCount} posts approved` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT status, COUNT(*) as count FROM content_posts GROUP BY status'
    );
    res.json({ success: true, stats: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
