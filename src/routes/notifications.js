const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticate } = require('../middleware/auth');

// ─── GET /api/notifications — Get my notifications ───────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    const unread = data.filter(n => !n.read).length;
    res.json({ success: true, data, unread });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
});

// ─── PATCH /api/notifications/:id/read ───────────────────────────────────────
router.patch('/:id/read', authenticate, async (req, res) => {
  try {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ─── PATCH /api/notifications/read-all ───────────────────────────────────────
router.patch('/read-all', authenticate, async (req, res) => {
  try {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', req.user.id)
      .eq('read', false);

    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
