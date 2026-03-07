const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const supabase = require('../config/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendPaymentApprovedEmail, sendPaymentRejectedEmail, sendPrizePayoutEmail } = require('../services/email');

// ─── GET /api/payments — All payments (Admin) ────────────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let q = supabase
      .from('payments')
      .select(`
        *,
        users(username, email, upi_id, phone),
        tournaments(title, game, entry_fee)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (status) q = q.eq('status', status);
    if (type) q = q.eq('type', type);

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({
      success: true,
      data,
      pagination: { total: count, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(count / parseInt(limit)) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch payments.' });
  }
});

// ─── POST /api/payments/submit — Player submits UPI TxnID ────────────────────
router.post('/submit', authenticate, [
  body('tournament_id').isUUID().withMessage('Valid tournament ID required'),
  body('txn_id').trim().isLength({ min: 5, max: 100 }).withMessage('Valid transaction ID required'),
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { tournament_id, txn_id, amount } = req.body;
  const userId = req.user.id;

  try {
    // Check for duplicate txn_id
    const { data: dupTxn } = await supabase
      .from('payments')
      .select('id')
      .eq('txn_id', txn_id)
      .single();

    if (dupTxn) {
      return res.status(409).json({ success: false, message: 'This transaction ID has already been submitted.' });
    }

    // Get registration
    const { data: registration } = await supabase
      .from('registrations')
      .select('id')
      .eq('user_id', userId)
      .eq('tournament_id', tournament_id)
      .single();

    const { data: payment, error } = await supabase
      .from('payments')
      .insert({
        user_id: userId,
        tournament_id,
        registration_id: registration?.id || null,
        amount,
        txn_id,
        type: 'entry',
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Payment submitted! Admin will verify within 24 hours.',
      data: payment
    });
  } catch (err) {
    console.error('Payment submit error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit payment.' });
  }
});

// ─── PATCH /api/payments/:id/approve — Admin Approve ─────────────────────────
router.patch('/:id/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data: payment, error: pErr } = await supabase
      .from('payments')
      .select('*, users(email, username), tournaments(title)')
      .eq('id', req.params.id)
      .single();

    if (pErr || !payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }

    if (payment.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Payment already ${payment.status}.` });
    }

    // Update payment status
    await supabase
      .from('payments')
      .update({ status: 'approved', verified_by: req.user.id, verified_at: new Date().toISOString() })
      .eq('id', req.params.id);

    // Update registration to confirmed
    if (payment.registration_id) {
      await supabase
        .from('registrations')
        .update({ status: 'confirmed' })
        .eq('id', payment.registration_id);
    }

    // Notify user
    await supabase.from('notifications').insert({
      user_id: payment.user_id,
      message: `Your entry fee for ${payment.tournaments?.title} has been verified! ✅ You are now registered.`,
      type: 'payment'
    });

    // Send email (async)
    sendPaymentApprovedEmail(payment.users.email, payment.users.username, {
      tournament: payment.tournaments?.title,
      amount: payment.amount,
      txn_id: payment.txn_id
    }).catch(() => {});

    res.json({ success: true, message: 'Payment approved and player confirmed.' });
  } catch (err) {
    console.error('Approve payment error:', err);
    res.status(500).json({ success: false, message: 'Failed to approve payment.' });
  }
});

// ─── PATCH /api/payments/:id/reject — Admin Reject ───────────────────────────
router.patch('/:id/reject', authenticate, requireAdmin, [
  body('reason').optional().trim().isLength({ max: 200 })
], async (req, res) => {
  const { reason } = req.body;

  try {
    const { data: payment, error: pErr } = await supabase
      .from('payments')
      .select('*, users(email, username), tournaments(title)')
      .eq('id', req.params.id)
      .single();

    if (pErr || !payment) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }

    await supabase
      .from('payments')
      .update({ status: 'rejected', reject_reason: reason || null, verified_by: req.user.id, verified_at: new Date().toISOString() })
      .eq('id', req.params.id);

    // Keep registration as pending or remove it
    if (payment.registration_id) {
      await supabase
        .from('registrations')
        .update({ status: 'rejected' })
        .eq('id', payment.registration_id);
    }

    await supabase.from('notifications').insert({
      user_id: payment.user_id,
      message: `Your payment for ${payment.tournaments?.title} was rejected. Reason: ${reason || 'Invalid transaction ID'}. Please contact support.`,
      type: 'payment'
    });

    sendPaymentRejectedEmail(payment.users.email, payment.users.username, {
      tournament: payment.tournaments?.title,
      reason
    }).catch(() => {});

    res.json({ success: true, message: 'Payment rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reject payment.' });
  }
});

// ─── POST /api/payments/payout — Admin Record Prize Payout ───────────────────
router.post('/payout', authenticate, requireAdmin, [
  body('user_id').isUUID(),
  body('tournament_id').isUUID(),
  body('amount').isFloat({ min: 1 }),
  body('placement').trim().notEmpty(),
  body('upi_id').trim().notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { user_id, tournament_id, amount, placement, upi_id, notes } = req.body;

  try {
    const { data: user } = await supabase.from('users').select('email, username, upi_id').eq('id', user_id).single();
    const { data: tournament } = await supabase.from('tournaments').select('title').eq('id', tournament_id).single();

    const { data: payout, error } = await supabase
      .from('payments')
      .insert({
        user_id,
        tournament_id,
        amount,
        type: 'prize',
        status: 'approved',
        txn_id: `PAYOUT-${Date.now()}`,
        notes: notes || null,
        verified_by: req.user.id,
        verified_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Update leaderboard placement
    await supabase.from('leaderboard')
      .update({ placement: placement })
      .eq('user_id', user_id)
      .eq('tournament_id', tournament_id);

    await supabase.from('notifications').insert({
      user_id,
      message: `🏆 Congratulations! ₹${amount} prize has been sent to your UPI (${upi_id}) for ${tournament?.title}!`,
      type: 'prize'
    });

    sendPrizePayoutEmail(user.email, user.username, {
      tournament: tournament?.title,
      amount,
      placement,
      upi_id: upi_id || user.upi_id
    }).catch(() => {});

    res.status(201).json({ success: true, message: `Prize of ₹${amount} recorded for ${user.username}.`, data: payout });
  } catch (err) {
    console.error('Payout error:', err);
    res.status(500).json({ success: false, message: 'Failed to record payout.' });
  }
});

// ─── GET /api/payments/my — Player's own payments ────────────────────────────
router.get('/my', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*, tournaments(title, game)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch payments.' });
  }
});

module.exports = router;
