-- ============================================================
-- ARENA 24 — Supabase PostgreSQL Schema
-- Run this in Supabase SQL Editor (in order)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username              VARCHAR(20) UNIQUE NOT NULL,
  email                 VARCHAR(255) UNIQUE NOT NULL,
  password_hash         TEXT NOT NULL,
  phone                 VARCHAR(15),
  ign                   VARCHAR(50),           -- In-game name
  upi_id                VARCHAR(100),          -- UPI ID for prizes
  avatar_url            TEXT,
  role                  VARCHAR(10) DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  email_verified        BOOLEAN DEFAULT FALSE,
  verify_token          TEXT,
  verify_token_expires  TIMESTAMPTZ,
  reset_token           TEXT,
  reset_token_expires   TIMESTAMPTZ,
  banned                BOOLEAN DEFAULT FALSE,
  ban_reason            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);

-- ─── TOURNAMENTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         VARCHAR(100) NOT NULL,
  game          VARCHAR(50) NOT NULL,
  platform      VARCHAR(10) CHECK (platform IN ('mobile', 'pc', 'both')) DEFAULT 'mobile',
  format        VARCHAR(20) CHECK (format IN ('bracket', 'round_robin', 'leaderboard')) DEFAULT 'leaderboard',
  type          VARCHAR(10) CHECK (type IN ('solo', 'team')) DEFAULT 'solo',
  max_players   INTEGER NOT NULL DEFAULT 100,
  entry_fee     DECIMAL(10,2) DEFAULT 0,         -- INR
  prize_pool    DECIMAL(10,2) DEFAULT 0,         -- INR
  status        VARCHAR(15) DEFAULT 'upcoming'
                CHECK (status IN ('upcoming', 'live', 'completed', 'cancelled')),
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ,
  rules         TEXT,
  room_id       VARCHAR(100),                    -- Shared 30min before start
  room_pass     VARCHAR(100),
  banner_url    TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournaments_game ON tournaments(game);
CREATE INDEX idx_tournaments_start_at ON tournaments(start_at);

-- ─── REGISTRATIONS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS registrations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  ign             VARCHAR(50),                   -- IGN for this specific tournament
  status          VARCHAR(15) DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'rejected', 'disqualified')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tournament_id)
);

CREATE INDEX idx_registrations_user ON registrations(user_id);
CREATE INDEX idx_registrations_tournament ON registrations(tournament_id);
CREATE INDEX idx_registrations_status ON registrations(status);

-- ─── PAYMENTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id   UUID REFERENCES tournaments(id) ON DELETE SET NULL,
  registration_id UUID REFERENCES registrations(id) ON DELETE SET NULL,
  amount          DECIMAL(10,2) NOT NULL,        -- INR
  txn_id          VARCHAR(100) UNIQUE,           -- UPI Transaction ID
  type            VARCHAR(10) CHECK (type IN ('entry', 'prize')) NOT NULL,
  status          VARCHAR(15) DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason   TEXT,
  notes           TEXT,
  verified_by     UUID REFERENCES users(id),
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_txn ON payments(txn_id);

-- ─── LEADERBOARD ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaderboard (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  game            VARCHAR(50) NOT NULL,
  kills           INTEGER DEFAULT 0,
  placement_pts   INTEGER DEFAULT 0,
  total_pts       INTEGER DEFAULT 0,
  rank            INTEGER,
  placement       VARCHAR(20),                   -- "1st", "2nd", "Top 10", etc.
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tournament_id)
);

CREATE INDEX idx_leaderboard_user ON leaderboard(user_id);
CREATE INDEX idx_leaderboard_game ON leaderboard(game);
CREATE INDEX idx_leaderboard_pts ON leaderboard(total_pts DESC);

-- ─── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  type        VARCHAR(20) DEFAULT 'info'
              CHECK (type IN ('info', 'tournament', 'payment', 'prize', 'score', 'system')),
  read        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read);

-- ─── RLS POLICIES ────────────────────────────────────────────
-- Disable RLS (we're using service role key from backend)
-- The backend handles all access control via JWT + middleware

ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments DISABLE ROW LEVEL SECURITY;
ALTER TABLE registrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tournaments_updated_at BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER leaderboard_updated_at BEFORE UPDATE ON leaderboard FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── GLOBAL LEADERBOARD FUNCTION ─────────────────────────────
CREATE OR REPLACE FUNCTION get_global_leaderboard()
RETURNS TABLE(user_id UUID, username VARCHAR, ign VARCHAR, avatar_url TEXT, total_pts BIGINT, total_kills BIGINT, tournaments BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.user_id,
    u.username,
    u.ign,
    u.avatar_url,
    SUM(l.total_pts)::BIGINT AS total_pts,
    SUM(l.kills)::BIGINT AS total_kills,
    COUNT(l.tournament_id)::BIGINT AS tournaments
  FROM leaderboard l
  JOIN users u ON u.id = l.user_id
  GROUP BY l.user_id, u.username, u.ign, u.avatar_url
  ORDER BY total_pts DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql;

-- ─── SAMPLE DATA (Optional — remove in production) ────────────
-- Uncomment to insert a test admin user (password: Admin@1234)
/*
INSERT INTO users (username, email, password_hash, role, email_verified, ign)
VALUES (
  'admin',
  'admin@arena24.in',
  '$2a$12$LbMBkVxELjQRt5iMqPMXxe3ZqRRBPXw.c7Xt1H1K5YWVmYSZq3wHm',
  'admin',
  true,
  'Admin'
);
*/
