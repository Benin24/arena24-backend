const express = require('express');
const router = express.Router();
const { body, query, validationResult } = require('express-validator');

const supabase = require('../config/supabase');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');
const { joinLimiter } = require('../middleware/rateLimiter');
const { sendTournamentConfirmation } = require('../services/email');

const VALID_GAMES = ['BGMI', 'Free Fire', 'COD Mobile', 'Valorant', 'Chess', 'Ludo King', 'FIFA Mobile', 'Tekken', 'PUBG PC', 'Other'];
const VALID_FORMATS = ['bracket', 'round_robin', 'leaderboard'];
const VALID_TYPES = ['solo', 'team'];
const VALID_PLATFORMS = ['mobile', 'pc', 'both'];
const VALID_STATUSES = ['upcoming', 'live', 'completed', 'cancelled'];

// ─── GET /api/tournaments ─────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { game, status, platform, type, page = 1, limit = 12 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let q = supabase
      .from('tournaments')
      .select(`
        id, title, game, platform, format, type, max_players, entry_fee,
        prize_pool, status, start_at, end_at, banner_url, created_at,
        registrations(count)
      `, { count: 'exact' })
      .order('start_at', { ascending: true })
      .range(offset, offset + parseInt(limit) - 1);

    if (game) q = q.eq('game', game);
    if (status) q = q.eq('status', status);
    if (platform) q = q.eq('platform', platform);
    if (type) q = q.eq('type', type);

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({
      success: true,
      data,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('Get tournaments error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch tournaments.' });
  }
});

// ─── GET /api/tournaments/:id ─────────────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { data: tournament, error } = await supabase
      .from('tournaments')
      .select(`
        *,
        registrations(id, user_id, ign, status, users(username, avatar_url))
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    // Only show room ID/pass to admin or registered players
    let responseData = { ...tournament };
    const isAdmin = req.user?.role === 'admin';
    const isRegistered = req.user && tournament.registrations?.some(r => r.user_id === req.user.id && r.status === 'confirmed');

    if (!isAdmin && !isRegistered) {
      delete responseData.room_id;
      delete responseData.room_pass;
    }

    res.json({ success: true, data: responseData });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tournament.' });
  }
});

// ─── POST /api/tournaments — Admin Create ────────────────────────────────────
router.post('/', authenticate, requireAdmin, [
  body('title').trim().isLength({ min: 3, max: 100 }),
  body('game').isIn(VALID_GAMES),
  body('platform').isIn(VALID_PLATFORMS),
  body('format').isIn(VALID_FORMATS),
  body('type').isIn(VALID_TYPES),
  body('max_players').isInt({ min: 2, max: 1000 }),
  body('entry_fee').isFloat({ min: 0 }),
  body('prize_pool').isFloat({ min: 0 }),
  body('start_at').isISO8601(),
  body('end_at').isISO8601()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        ...req.body,
        status: 'upcoming',
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, message: 'Tournament created!', data });
  } catch (err) {
    console.error('Create tournament error:', err);
    res.status(500).json({ success: false, message: 'Failed to create tournament.' });
  }
});

// ─── PUT /api/tournaments/:id — Admin Edit ────────────────────────────────────
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const allowedFields = ['title', 'game', 'platform', 'format', 'type', 'max_players',
      'entry_fee', 'prize_pool', 'status', 'start_at', 'end_at', 'rules',
      'room_id', 'room_pass', 'banner_url'];
    
    const updates = {};
    allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    res.json({ success: true, message: 'Tournament updated.', data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed.' });
  }
});

// ─── DELETE /api/tournaments/:id — Admin Cancel ───────────────────────────────
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('tournaments')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id);

    if (error) throw error;

    res.json({ success: true, message: 'Tournament cancelled.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to cancel tournament.' });
  }
});

// ─── POST /api/tournaments/:id/join — Player Join ────────────────────────────
router.post('/:id/join', authenticate, joinLimiter, [
  body('ign').trim().isLength({ min: 2, max: 50 }).withMessage('In-game name required'),
  body('txn_id').optional().trim().isLength({ min: 5, max: 100 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { ign, txn_id } = req.body;
  const tournamentId = req.params.id;
  const userId = req.user.id;

  try {
    // Get tournament details
    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .select('id, title, game, format, entry_fee, prize_pool, max_players, status, start_at')
      .eq('id', tournamentId)
      .single();

    if (tErr || !tournament) {
      return res.status(404).json({ success: false, message: 'Tournament not found.' });
    }

    if (tournament.status !== 'upcoming') {
      return res.status(400).json({ success: false, message: 'This tournament is no longer open for registration.' });
    }

    // Check already registered
    const { data: existing } = await supabase
      .from('registrations')
      .select('id')
      .eq('user_id', userId)
      .eq('tournament_id', tournamentId)
      .single();

    if (existing) {
      return res.status(409).json({ success: false, message: 'You are already registered for this tournament.' });
    }

    // Check capacity
    const { count } = await supabase
      .from('registrations')
      .select('id', { count: 'exact' })
      .eq('tournament_id', tournamentId)
      .eq('status', 'confirmed');

    if (count >= tournament.max_players) {
      return res.status(400).json({ success: false, message: 'Tournament is full.' });
    }

    // If paid tournament, txn_id is required
    if (tournament.entry_fee > 0 && !txn_id) {
      return res.status(400).json({ success: false, message: 'UPI transaction ID required for paid tournaments.' });
    }

    // Create registration (pending for paid, confirmed for free)
    const registrationStatus = tournament.entry_fee > 0 ? 'pending' : 'confirmed';

    const { data: registration, error: rErr } = await supabase
      .from('registrations')
      .insert({ user_id: userId, tournament_id: tournamentId, ign, status: registrationStatus })
      .select()
      .single();

    if (rErr) throw rErr;

    // Create payment record if paid
    if (tournament.entry_fee > 0 && txn_id) {
      await supabase.from('payments').insert({
        user_id: userId,
        tournament_id: tournamentId,
        registration_id: registration.id,
        amount: tournament.entry_fee,
        txn_id,
        type: 'entry',
        status: 'pending'
      });
    }

    // Create notification
    await supabase.from('notifications').insert({
      user_id: userId,
      message: tournament.entry_fee > 0
        ? `You've joined ${tournament.title}! Your payment is pending admin verification.`
        : `You've successfully joined ${tournament.title}! Good luck! 🎮`,
      type: 'tournament'
    });

    // Send confirmation email (async, don't wait)
    const { data: userRow } = await supabase.from('users').select('email, username').eq('id', userId).single();
    if (userRow) sendTournamentConfirmation(userRow.email, userRow.username, tournament).catch(() => {});

    res.status(201).json({
      success: true,
      message: tournament.entry_fee > 0
        ? 'Registered! Your payment is under review. You\'ll get an email when verified.'
        : 'Successfully joined the tournament! Good luck! 🎮',
      data: { registration_id: registration.id, status: registrationStatus }
    });
  } catch (err) {
    console.error('Join tournament error:', err);
    res.status(500).json({ success: false, message: 'Failed to join tournament.' });
  }
});

// ─── POST /api/tournaments/:id/end — Admin End Tournament ────────────────────
router.post('/:id/end', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tournaments')
      .update({ status: 'completed', end_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, message: 'Tournament ended.', data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to end tournament.' });
  }
});

// ─── GET /api/tournaments/:id/registrations ───────────────────────────────────
router.get('/:id/registrations', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('registrations')
      .select('*, users(username, email, phone, upi_id)')
      .eq('tournament_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch registrations.' });
  }
});

module.exports = router;
