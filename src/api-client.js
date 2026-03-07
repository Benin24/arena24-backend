// ============================================================
// Arena 24 — Frontend API Client
// Save as: js/api.js  (include in every HTML page)
// ============================================================

const API_URL = 'https://your-backend.onrender.com/api';
// Development: const API_URL = 'http://localhost:5000/api';

// ─── Token Management ─────────────────────────────────────────────────────────
const Auth = {
  getToken: () => localStorage.getItem('arena24_token'),
  getUser: () => {
    const u = localStorage.getItem('arena24_user');
    return u ? JSON.parse(u) : null;
  },
  save: (token, user) => {
    localStorage.setItem('arena24_token', token);
    localStorage.setItem('arena24_user', JSON.stringify(user));
  },
  clear: () => {
    localStorage.removeItem('arena24_token');
    localStorage.removeItem('arena24_user');
  },
  isLoggedIn: () => !!localStorage.getItem('arena24_token'),
  isAdmin: () => {
    const user = Auth.getUser();
    return user?.role === 'admin';
  }
};

// ─── Core Fetch Wrapper ───────────────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json();

  if (response.status === 401) {
    Auth.clear();
    window.location.href = '/login.html?session=expired';
    return;
  }

  if (!response.ok) {
    throw new Error(data.message || 'Something went wrong');
  }

  return data;
}

// ─── Auth API ─────────────────────────────────────────────────────────────────
const AuthAPI = {
  register: (body) => apiFetch('/auth/register', { method: 'POST', body }),
  login: async (body) => {
    const data = await apiFetch('/auth/login', { method: 'POST', body });
    if (data?.token) Auth.save(data.token, data.user);
    return data;
  },
  logout: async () => {
    try { await apiFetch('/auth/logout', { method: 'POST' }); } catch {}
    Auth.clear();
    window.location.href = '/login.html';
  },
  forgotPassword: (email) => apiFetch('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (token, password) => apiFetch('/auth/reset-password', { method: 'POST', body: { token, password } }),
  me: () => apiFetch('/auth/me')
};

// ─── Tournaments API ──────────────────────────────────────────────────────────
const TournamentAPI = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/tournaments?${qs}`);
  },
  get: (id) => apiFetch(`/tournaments/${id}`),
  create: (body) => apiFetch('/tournaments', { method: 'POST', body }),
  update: (id, body) => apiFetch(`/tournaments/${id}`, { method: 'PUT', body }),
  delete: (id) => apiFetch(`/tournaments/${id}`, { method: 'DELETE' }),
  join: (id, body) => apiFetch(`/tournaments/${id}/join`, { method: 'POST', body }),
  end: (id) => apiFetch(`/tournaments/${id}/end`, { method: 'POST' }),
  getRegistrations: (id) => apiFetch(`/tournaments/${id}/registrations`)
};

// ─── Payments API ─────────────────────────────────────────────────────────────
const PaymentAPI = {
  all: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/payments?${qs}`);
  },
  myPayments: () => apiFetch('/payments/my'),
  submit: (body) => apiFetch('/payments/submit', { method: 'POST', body }),
  approve: (id) => apiFetch(`/payments/${id}/approve`, { method: 'PATCH' }),
  reject: (id, reason) => apiFetch(`/payments/${id}/reject`, { method: 'PATCH', body: { reason } }),
  payout: (body) => apiFetch('/payments/payout', { method: 'POST', body })
};

// ─── Leaderboard API ──────────────────────────────────────────────────────────
const LeaderboardAPI = {
  global: () => apiFetch('/leaderboard/global-stats'),
  byGame: (game) => apiFetch(`/leaderboard/${encodeURIComponent(game)}`),
  submitScore: (body) => apiFetch('/leaderboard/score', { method: 'POST', body })
};

// ─── Users API ────────────────────────────────────────────────────────────────
const UserAPI = {
  all: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/users?${qs}`);
  },
  get: (id) => apiFetch(`/users/${id}`),
  update: (id, body) => apiFetch(`/users/${id}`, { method: 'PUT', body }),
  changePassword: (id, body) => apiFetch(`/users/${id}/password`, { method: 'PUT', body }),
  ban: (id, banned, reason) => apiFetch(`/users/${id}/ban`, { method: 'PATCH', body: { banned, reason } }),
  myTournaments: (id) => apiFetch(`/users/${id}/tournaments`)
};

// ─── Notifications API ────────────────────────────────────────────────────────
const NotificationAPI = {
  get: () => apiFetch('/notifications'),
  markRead: (id) => apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => apiFetch('/notifications/read-all', { method: 'PATCH' })
};

// ─── Page Guard: Redirect if not logged in ────────────────────────────────────
function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = `/login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
  }
}

function requireAdminPage() {
  if (!Auth.isLoggedIn() || !Auth.isAdmin()) {
    window.location.href = '/login.html';
  }
}

// ─── Toast notification helper ────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `arena-toast arena-toast--${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:${type === 'success' ? '#00ff88' : type === 'error' ? '#ff0040' : '#ff6b00'};
    color:#000; padding:14px 24px; border-radius:8px;
    font-family:Inter,sans-serif; font-weight:600; font-size:14px;
    box-shadow:0 4px 20px rgba(0,0,0,0.4);
    animation: slideIn 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// Export for use across pages
window.Auth = Auth;
window.AuthAPI = AuthAPI;
window.TournamentAPI = TournamentAPI;
window.PaymentAPI = PaymentAPI;
window.LeaderboardAPI = LeaderboardAPI;
window.UserAPI = UserAPI;
window.NotificationAPI = NotificationAPI;
window.requireAuth = requireAuth;
window.requireAdminPage = requireAdminPage;
window.showToast = showToast;
