# 🎮 Arena 24 — Backend API

India's premier gaming tournament platform backend.
Built with Node.js + Express + Supabase.

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
cd arena24-backend
npm install
```

### 2. Setup Environment

```bash
cp .env.example .env
# Fill in your values (see below)
```

### 3. Setup Supabase Database

1. Go to [supabase.com](https://supabase.com) → Create new project
2. Open **SQL Editor**
3. Paste the contents of `sql/schema.sql` and run it
4. Copy your **Project URL** and **service_role key** into `.env`

### 4. Setup Gmail SMTP

1. Go to Google Account → Security → 2-Step Verification (enable it)
2. Go to Google Account → Security → App Passwords
3. Create an app password for "Mail"
4. Use that 16-character password as `GMAIL_APP_PASSWORD` in `.env`

### 5. Run Locally

```bash
npm run dev    # Development with auto-reload
npm start      # Production
```

API runs at: `http://localhost:5000`

---

## 📁 Project Structure

```
arena24-backend/
├── src/
│   ├── server.js              # Express app entry point
│   ├── config/
│   │   └── supabase.js        # Supabase client
│   ├── middleware/
│   │   ├── auth.js            # JWT auth middleware
│   │   ├── rateLimiter.js     # Rate limiting
│   │   └── errorHandler.js    # Global error handler
│   ├── routes/
│   │   ├── auth.js            # Register, login, verify email
│   │   ├── tournaments.js     # CRUD, join, room details
│   │   ├── payments.js        # UPI submit, admin verify, payout
│   │   ├── leaderboard.js     # Global & per-game rankings
│   │   ├── users.js           # Profile, ban, password
│   │   └── notifications.js   # Player notifications
│   ├── services/
│   │   └── email.js           # Nodemailer email templates
│   └── api-client.js          # Frontend JS (copy to js/api.js)
├── sql/
│   └── schema.sql             # Complete DB schema
├── .env.example               # Environment template
├── render.yaml                # Render.com deployment config
└── package.json
```

---

## 🌐 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| GET | `/api/auth/verify/:token` | Verify email |
| POST | `/api/auth/login` | Login → JWT |
| POST | `/api/auth/logout` | Logout |
| POST | `/api/auth/forgot-password` | Send reset email |
| POST | `/api/auth/reset-password` | Reset password |
| GET | `/api/auth/me` | Get current user |

### Tournaments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tournaments` | List all (with filters) |
| GET | `/api/tournaments/:id` | Single tournament |
| POST | `/api/tournaments` | Create (admin) |
| PUT | `/api/tournaments/:id` | Edit (admin) |
| DELETE | `/api/tournaments/:id` | Cancel (admin) |
| POST | `/api/tournaments/:id/join` | Player join |
| POST | `/api/tournaments/:id/end` | End (admin) |
| GET | `/api/tournaments/:id/registrations` | Get registrations (admin) |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/payments` | All payments (admin) |
| GET | `/api/payments/my` | My payments |
| POST | `/api/payments/submit` | Submit UPI TxnID |
| PATCH | `/api/payments/:id/approve` | Approve (admin) |
| PATCH | `/api/payments/:id/reject` | Reject (admin) |
| POST | `/api/payments/payout` | Record prize payout (admin) |

### Leaderboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leaderboard` | Global rankings |
| GET | `/api/leaderboard/global-stats` | Aggregated user stats |
| GET | `/api/leaderboard/:game` | Per-game rankings |
| POST | `/api/leaderboard/score` | Submit score (admin) |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | All users (admin) |
| GET | `/api/users/:id` | User profile |
| PUT | `/api/users/:id` | Update profile |
| PUT | `/api/users/:id/password` | Change password |
| PATCH | `/api/users/:id/ban` | Ban/unban (admin) |
| GET | `/api/users/:id/tournaments` | User's tournaments |

---

## 🚢 Deploy to Render.com (Free)

1. Push this folder to GitHub (as a separate repo or subfolder)
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Set **Root Directory** to `arena24-backend`
5. Build Command: `npm install`
6. Start Command: `node src/server.js`
7. Add all environment variables from `.env`

Your API will be live at: `https://arena24-backend.onrender.com`

---

## 🖥️ Connect Frontend

1. Copy `src/api-client.js` to your frontend as `js/api.js`
2. Update `API_URL` to your Render URL
3. Add `<script src="/js/api.js"></script>` to all HTML pages (before other JS files)
4. Replace all mock/static JS with the API calls

### Example: Login page
```javascript
// In js/auth.js — replace mock login with:
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await AuthAPI.login({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value
    });
    showToast(`Welcome back, ${data.user.username}! 🎮`, 'success');
    setTimeout(() => {
      window.location.href = data.user.role === 'admin' ? '/admin-dashboard.html' : '/dashboard.html';
    }, 1000);
  } catch (err) {
    showToast(err.message, 'error');
  }
});
```

---

## 🔒 Security Features

- ✅ JWT authentication on all protected routes
- ✅ Email verification required before tournament access
- ✅ bcrypt password hashing (12 salt rounds)
- ✅ Rate limiting (login: 5/min, register: 3/5min)
- ✅ Helmet.js security headers
- ✅ XSS input sanitization
- ✅ CORS configured for your domain only
- ✅ Admin role middleware on all admin routes
- ✅ SQL injection prevention (Supabase parameterized queries)
- ✅ Duplicate UPI transaction ID detection

---

## 💰 Payment Flow (UPI)

```
Player joins tournament
    → Submits UPI TxnID via POST /api/tournaments/:id/join
    → Registration created with status: "pending"
    → Admin sees pending payment in admin-payments.html
    → Admin verifies TxnID manually in UPI app
    → Admin clicks Approve → PATCH /api/payments/:id/approve
    → Registration updated to "confirmed"
    → Player gets email + notification ✅

For prizes:
    → Tournament ends
    → Admin submits scores via POST /api/leaderboard/score
    → Admin sends UPI payment manually
    → Admin records payout via POST /api/payments/payout
    → Player gets email + notification with prize details 💰
```

---

## 📧 Email Service

Uses Gmail SMTP (free). Emails sent for:
- Email verification on register
- Password reset
- Tournament registration confirmation
- Payment approved/rejected
- Prize payout notification

---

*Arena 24 — Built for Indian gamers 🇮🇳*
