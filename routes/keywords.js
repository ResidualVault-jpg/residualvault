const express = require('express');
const router = express.Router();
const pool = require('../db');
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

// Get all keywords
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM keywords ORDER BY priority DESC, keyword ASC');
    res.json({ success: true, keywords: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get active keywords for content agent
router.get('/active', async (req, res) => {
  try {
    const result = await pool.query('SELECT keyword FROM keywords WHERE active = true ORDER BY priority DESC');
    res.json({ success: true, keywords: result.rows.map(r => r.keyword) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add new keyword
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { keyword, category, priority, search_volume, difficulty, notes } = req.body;
    const result = await pool.query(
      `INSERT INTO keywords (keyword, category, priority, search_volume, difficulty, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [keyword, category || 'general', priority || 5, search_volume || '', difficulty || '', notes || '']
    );
    res.json({ success: true, keyword: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update keyword
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { keyword, category, priority, search_volume, difficulty, notes, active } = req.body;
    await pool.query(
      `UPDATE keywords SET keyword=$2, category=$3, priority=$4, search_volume=$5, difficulty=$6, notes=$7, active=$8 WHERE id=$1`,
      [req.params.id, keyword, category, priority, search_volume, difficulty, notes, active]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toggle keyword active/inactive
router.put('/:id/toggle', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE keywords SET active = NOT active WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete keyword
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM keywords WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
