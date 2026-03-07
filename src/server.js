require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const xssClean = require('xss-clean');

const authRoutes = require('./routes/auth');
const tournamentRoutes = require('./routes/tournaments');
const paymentRoutes = require('./routes/payments');
const leaderboardRoutes = require('./routes/leaderboard');
const userRoutes = require('./routes/users');
const notificationRoutes = require('./routes/notifications');

const { globalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'https://arena24.in',
    'https://www.arena24.in'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ─── XSS & Rate Limit ─────────────────────────────────────────────────────────
app.use(xssClean());
app.use(globalLimiter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    platform: 'Arena 24',
    timestamp: new Date().toISOString(),
    timezone: 'Asia/Kolkata'
  });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/notifications', notificationRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    message: `Route ${req.originalUrl} not found` 
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🎮  Arena 24 Backend Running       ║
  ║   Port   : ${PORT}                      ║
  ║   Mode   : ${process.env.NODE_ENV || 'development'}             ║
  ║   URL    : http://localhost:${PORT}    ║
  ╚══════════════════════════════════════╝
  `);
});

module.exports = app;
