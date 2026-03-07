const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});

const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { success: false, message: 'Too many login attempts. Wait 1 minute.' }
});

const registerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3,
  message: { success: false, message: 'Too many registration attempts. Wait 5 minutes.' }
});

const joinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many join attempts. Slow down.' }
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { success: false, message: 'Too many password reset requests. Wait 15 minutes.' }
});

module.exports = { globalLimiter, loginLimiter, registerLimiter, joinLimiter, forgotPasswordLimiter };
