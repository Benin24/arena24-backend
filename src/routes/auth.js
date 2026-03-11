const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

const supabase = require('../config/supabase');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');
const { loginLimiter, registerLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');

// ─── Helper: Generate JWT ─────────────────────────────────────────────────────
const generateToken = (user) => jwt.sign(
  { id: user.id, email: user.email, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', registerLimiter, [
  body('username').trim().isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/).withMessage('Username must be 3-20 chars, letters/numbers/underscore only'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must be 8+ chars with uppercase, lowercase, and number'),
  body('phone').optional().matches(/^[6-9]\d{9}$/).withMessage('Valid Indian mobile number required'),
  body('ign').trim().isLength({ min: 2, max: 30 }).withMessage('In-game name required (2-30 chars)')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { username, email, password, phone, ign, upi_id } = req.body;

  try {
    // Check existing user
    const { data: existingEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    const { data: existingUsername } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existingEmail || existingUsername) {
      return res.status(409).json({ success: false, message: 'Email or username already registered.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Check if admin email
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    const role = adminEmails.includes(email.toLowerCase()) ? 'admin' : 'player';

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        username,
        email,
        password_hash: passwordHash,
        phone: phone || null,
        ign,
        upi_id: upi_id || null,
        role,
        email_verified: false,
        verify_token: verifyToken,
        verify_token_expires: verifyExpires,
        banned: false
      })
      .select('id, username, email, role')
      .single();

    if (error) throw error;

    // ─── FIX: Send email AFTER insert, but DELETE user on failure ─────────────
    try {
      await sendVerificationEmail(email, username, verifyToken);
    } catch (emailErr) {
      console.error('Email send failed, rolling back user creation:', emailErr.message);
      // Delete the just-created user so they can retry registration
      await supabase.from('users').delete().eq('id', user.id);
      return res.status(500).json({
        success: false,
        message: 'Registration failed: could not send verification email. Please try again or contact support.'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful! Check your email to verify your account.',
      data: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});

// ─── GET /api/auth/verify/:token ─────────────────────────────────────────────
router.get('/verify/:token', async (req, res) => {
  const { token } = req.params;
  const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:3000';

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email_verified, verify_token_expires')
      .eq('verify_token', token)
      .maybeSingle();  // FIX: use maybeSingle instead of single to avoid PGRST116 errors

    if (error || !user) {
      return res.redirect(`${FRONTEND}/login.html?error=invalid_token`);
    }

    if (user.email_verified) {
      return res.redirect(`${FRONTEND}/login.html?message=already_verified`);
    }

    if (new Date(user.verify_token_expires) < new Date()) {
      return res.redirect(`${FRONTEND}/login.html?error=token_expired`);
    }

    await supabase
      .from('users')
      .update({ email_verified: true, verify_token: null, verify_token_expires: null })
      .eq('id', user.id);

    res.redirect(`${FRONTEND}/login.html?message=email_verified`);
  } catch (err) {
    console.error('Verify error:', err);
    res.redirect(`${FRONTEND}/login.html?error=server_error`);
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Invalid email or password.' });
  }

  const { email, password } = req.body;

  try {
    // ─── FIX: use maybeSingle() — .single() throws PGRST116 on no rows
    // which can cause inconsistent behaviour; maybeSingle returns null cleanly
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, password_hash, role, email_verified, banned, upi_id, phone, ign, avatar_url, created_at')
      .eq('email', email)
      .maybeSingle();

    // ─── FIX: explicit null check — don't rely on error alone
    if (error) {
      console.error('Login DB error:', error);
      return res.status(500).json({ success: false, message: 'Login failed. Try again.' });
    }

    if (!user) {
      // Use a timing-safe delay to prevent user enumeration
      await bcrypt.hash('dummy_prevent_timing_attack', 12);
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (user.banned) {
      return res.status(403).json({ success: false, message: 'Account banned. Contact support.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email first. Check your inbox.',
        requiresVerification: true
      });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: `Welcome back, ${user.username}! 🎮`,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        ign: user.ign,
        upi_id: user.upi_id,
        phone: user.phone,
        avatar_url: user.avatar_url,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed. Try again.' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', authenticate, (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', forgotPasswordLimiter, [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Valid email required.' });
  }

  const { email } = req.body;

  // Always return success to prevent email enumeration
  res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, username')
      .eq('email', email)
      .maybeSingle();

    if (!user) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await supabase
      .from('users')
      .update({ reset_token: resetToken, reset_token_expires: resetExpires })
      .eq('id', user.id);

    await sendPasswordResetEmail(email, user.username, resetToken);
  } catch (err) {
    console.error('Forgot password error:', err);
  }
});

// ─── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be 8+ chars with uppercase, lowercase, and number')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { token, password } = req.body;

  try {
    const { data: user } = await supabase
      .from('users')
      .select('id, reset_token_expires')
      .eq('reset_token', token)
      .maybeSingle();

    if (!user || new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or expired.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await supabase
      .from('users')
      .update({ password_hash: passwordHash, reset_token: null, reset_token_expires: null })
      .eq('id', user.id);

    res.json({ success: true, message: 'Password reset successful. Please log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Reset failed. Try again.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
