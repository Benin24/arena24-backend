const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const supabase = require('../config/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// ─── GET /api/users — All users (Admin) ──────────────────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { search, banned, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let q = supabase
      .from('users')
      .select('id, username, email, phone, role, email_verified, banned, created_at, ign, upi_id', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (search) {
      q = q.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (banned === 'true') q = q.eq('banned', true);
    if (banned === 'false') q = q.eq('banned', false);

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({
      success: true,
      data,
      pagination: { total: count, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(count / parseInt(limit)) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
});

// ─── GET /api/users/:id — User profile ───────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  // Players can only view their own profile; admins can view any
  if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, phone, role, email_verified, banned, created_at, ign, upi_id, avatar_url')
      .eq('id', req.params.id)
      .single();

    if (error || !user) return res.status(404).json({ success: false, message: 'User not found.' });

    // Get stats
    const { data: stats } = await supabase
      .from('leaderboard')
      .select('total_pts, kills, placement_pts, game')
      .eq('user_id', req.params.id);

    const { count: tournamentsJoined } = await supabase
      .from('registrations')
      .select('id', { count: 'exact' })
      .eq('user_id', req.params.id)
      .eq('status', 'confirmed');

    const totalPts = stats?.reduce((sum, r) => sum + (r.total_pts || 0), 0) || 0;
    const totalKills = stats?.reduce((sum, r) => sum + (r.kills || 0), 0) || 0;

    res.json({
      success: true,
      data: {
        ...user,
        stats: { totalPts, totalKills, tournamentsJoined: tournamentsJoined || 0 }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch user.' });
  }
});

// ─── PUT /api/users/:id — Update profile ─────────────────────────────────────
router.put('/:id', authenticate, [
  body('username').optional().trim().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
  body('phone').optional().matches(/^[6-9]\d{9}$/).withMessage('Valid Indian number required'),
  body('upi_id').optional().trim().isLength({ max: 100 }),
  body('ign').optional().trim().isLength({ min: 2, max: 50 })
], async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const allowedFields = ['username', 'phone', 'upi_id', 'ign', 'avatar_url'];
    const updates = {};
    allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    updates.updated_at = new Date().toISOString();

    if (updates.username) {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('username', updates.username)
        .neq('id', req.params.id)
        .single();

      if (existing) return res.status(409).json({ success: false, message: 'Username already taken.' });
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, username, email, phone, upi_id, ign, avatar_url, role')
      .single();

    if (error) throw error;

    res.json({ success: true, message: 'Profile updated.', data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed.' });
  }
});

// ─── PUT /api/users/:id/password — Change password ───────────────────────────
router.put('/:id/password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password needs 8+ chars with uppercase, lowercase, and number')
], async (req, res) => {
  if (req.user.id !== req.params.id) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { currentPassword, newPassword } = req.body;

  try {
    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.params.id)
      .single();

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await supabase.from('users').update({ password_hash: newHash }).eq('id', req.params.id);

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Password change failed.' });
  }
});

// ─── PATCH /api/users/:id/ban — Ban/unban user (Admin) ───────────────────────
router.patch('/:id/ban', authenticate, requireAdmin, [
  body('banned').isBoolean(),
  body('reason').optional().trim().isLength({ max: 200 })
], async (req, res) => {
  const { banned, reason } = req.body;

  // Prevent banning yourself
  if (req.params.id === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot ban yourself.' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .update({ banned, ban_reason: reason || null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('id, username, banned')
      .single();

    if (error || !data) return res.status(404).json({ success: false, message: 'User not found.' });

    if (banned) {
      await supabase.from('notifications').insert({
        user_id: req.params.id,
        message: `Your account has been suspended. Reason: ${reason || 'Violation of platform rules.'}`,
        type: 'system'
      });
    }

    res.json({
      success: true,
      message: `User ${data.username} has been ${banned ? 'banned' : 'unbanned'}.`,
      data
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Ban action failed.' });
  }
});

// ─── GET /api/users/:id/tournaments — User's tournaments ─────────────────────
router.get('/:id/tournaments', authenticate, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
    return res.status(403).json({ success: false, message: 'Access denied.' });
  }

  try {
    const { data, error } = await supabase
      .from('registrations')
      .select('*, tournaments(id, title, game, platform, status, start_at, prize_pool, entry_fee)')
      .eq('user_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tournaments.' });
  }
});

module.exports = router;
