const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

// ─── Verify JWT ───────────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. Please log in.' 
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user from DB (to catch banned users, role changes)
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, email, role, email_verified, banned')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ success: false, message: 'Invalid session. Please log in again.' });
    }

    if (user.banned) {
      return res.status(403).json({ success: false, message: 'Your account has been banned. Contact support.' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ success: false, message: 'Please verify your email before continuing.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

// ─── Require Admin Role ───────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: 'Admin access required.' 
    });
  }
  next();
};

// ─── Optional Auth (for public routes that also serve logged-in users) ────────
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: user } = await supabase
      .from('users')
      .select('id, username, email, role, email_verified, banned')
      .eq('id', decoded.id)
      .single();
    req.user = (user && !user.banned) ? user : null;
  } catch {
    req.user = null;
  }
  next();
};

module.exports = { authenticate, requireAdmin, optionalAuth };
