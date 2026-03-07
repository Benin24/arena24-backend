const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const supabase = require('../config/supabase');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

// ─── GET /api/leaderboard — Global rankings ───────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const { data, error } = await supabase
      .from('leaderboard')
      .select(`
        id, kills, placement_pts, total_pts, rank, game,
        users(id, username, avatar_url, ign),
        tournaments(id, title)
      `)
      .order('total_pts', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard.' });
  }
});

// ─── GET /api/leaderboard/global-stats — Aggregated global stats ──────────────
router.get('/global-stats', async (req, res) => {
  try {
    const { data, error } = await supabase
      .rpc('get_global_leaderboard');

    if (error) {
      // Fallback: manual query
      const { data: lb } = await supabase
        .from('leaderboard')
        .select('user_id, total_pts, kills, users(username, avatar_url, ign)')
        .order('total_pts', { ascending: false })
        .limit(100);

      // Aggregate by user
      const aggregated = {};
      lb?.forEach(row => {
        if (!aggregated[row.user_id]) {
          aggregated[row.user_id] = { user_id: row.user_id, ...row.users, total_pts: 0, total_kills: 0, tournaments: 0 };
        }
        aggregated[row.user_id].total_pts += row.total_pts || 0;
        aggregated[row.user_id].total_kills += row.kills || 0;
        aggregated[row.user_id].tournaments += 1;
      });

      const sorted = Object.values(aggregated).sort((a, b) => b.total_pts - a.total_pts);
      return res.json({ success: true, data: sorted.slice(0, 50) });
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch global stats.' });
  }
});

// ─── GET /api/leaderboard/:game — Per-game rankings ──────────────────────────
router.get('/:game', optionalAuth, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const game = decodeURIComponent(req.params.game);

    const { data, error } = await supabase
      .from('leaderboard')
      .select(`
        id, kills, placement_pts, total_pts, rank, placement,
        users(id, username, avatar_url, ign),
        tournaments(id, title, start_at)
      `)
      .eq('game', game)
      .order('total_pts', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    res.json({ success: true, game, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch game leaderboard.' });
  }
});

// ─── POST /api/leaderboard/score — Admin submit score ────────────────────────
router.post('/score', authenticate, requireAdmin, [
  body('user_id').isUUID(),
  body('tournament_id').isUUID(),
  body('game').trim().notEmpty(),
  body('kills').isInt({ min: 0 }),
  body('placement_pts').isInt({ min: 0 }),
  body('rank').optional().isInt({ min: 1 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { user_id, tournament_id, game, kills, placement_pts, rank, placement } = req.body;
  const total_pts = kills + placement_pts;

  try {
    // Upsert score
    const { data, error } = await supabase
      .from('leaderboard')
      .upsert({
        user_id,
        tournament_id,
        game,
        kills,
        placement_pts,
        total_pts,
        rank: rank || null,
        placement: placement || null
      }, { onConflict: 'user_id,tournament_id' })
      .select()
      .single();

    if (error) throw error;

    // Notify player
    await supabase.from('notifications').insert({
      user_id,
      message: `Your score has been recorded: ${kills} kills, ${placement_pts} placement pts (Total: ${total_pts} pts)`,
      type: 'score'
    });

    res.status(201).json({ success: true, message: 'Score submitted.', data });
  } catch (err) {
    console.error('Score submit error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit score.' });
  }
});

module.exports = router;
