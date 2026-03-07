const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// ─── Verify connection on startup ─────────────────────────────────────────────
transporter.verify((err) => {
  if (err) {
    console.error('❌ Email service error:', err.message);
  } else {
    console.log('✅ Email service connected (Gmail SMTP)');
  }
});

// ─── Templates ────────────────────────────────────────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Inter, Arial, sans-serif; background: #080b12; color: #fff; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .logo { font-family: Orbitron, monospace; font-size: 28px; color: #ff6b00; font-weight: 900; letter-spacing: 2px; }
    .logo span { color: #ff0040; }
    .card { background: #0d1117; border: 1px solid #1a2035; border-radius: 12px; padding: 32px; margin-top: 24px; }
    .btn { display: inline-block; background: linear-gradient(135deg, #ff6b00, #ff0040); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: bold; font-size: 16px; margin: 20px 0; }
    .footer { margin-top: 32px; font-size: 12px; color: #666; }
    h2 { color: #ff6b00; margin-top: 0; }
    p { color: #ccc; line-height: 1.6; }
    .code { background: #1a2035; padding: 12px 20px; border-radius: 6px; font-size: 20px; font-weight: bold; color: #ff6b00; text-align: center; letter-spacing: 4px; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">ARENA<span>24</span></div>
    <div class="card">${content}</div>
    <div class="footer">
      <p>© 2025 Arena 24 — India's Premier Gaming Tournament Platform</p>
      <p>This email was sent to you because you registered on Arena 24. If you did not register, please ignore this email.</p>
    </div>
  </div>
</body>
</html>
`;

// ─── Send Email Verification ───────────────────────────────────────────────────
const sendVerificationEmail = async (email, username, token) => {
  const verifyUrl = `${process.env.APP_URL}/api/auth/verify/${token}`;
  
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: '🎮 Verify your Arena 24 account',
    html: baseTemplate(`
      <h2>Welcome to Arena 24, ${username}!</h2>
      <p>You're one step away from joining India's most competitive gaming tournament platform.</p>
      <p>Click the button below to verify your email address:</p>
      <a href="${verifyUrl}" class="btn">✅ Verify Email</a>
      <p>Or copy this link: <br><small style="color:#888">${verifyUrl}</small></p>
      <p><strong>This link expires in 24 hours.</strong></p>
    `)
  });
};

// ─── Send Password Reset ───────────────────────────────────────────────────────
const sendPasswordResetEmail = async (email, username, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${token}`;
  
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: '🔑 Reset your Arena 24 password',
    html: baseTemplate(`
      <h2>Password Reset Request</h2>
      <p>Hi ${username}, we received a request to reset your Arena 24 password.</p>
      <a href="${resetUrl}" class="btn">🔑 Reset Password</a>
      <p>Or copy this link: <br><small style="color:#888">${resetUrl}</small></p>
      <p><strong>This link expires in 1 hour.</strong></p>
      <p>If you did not request this, ignore this email — your account is safe.</p>
    `)
  });
};

// ─── Tournament Registration Confirmation ────────────────────────────────────
const sendTournamentConfirmation = async (email, username, tournament) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `🏆 Registered for ${tournament.title} — Arena 24`,
    html: baseTemplate(`
      <h2>Tournament Registration Confirmed!</h2>
      <p>Hi ${username}, you have successfully registered for:</p>
      <h3 style="color:#fff">${tournament.title}</h3>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="color:#888;padding:8px 0">Game</td><td style="color:#fff">${tournament.game}</td></tr>
        <tr><td style="color:#888;padding:8px 0">Format</td><td style="color:#fff">${tournament.format}</td></tr>
        <tr><td style="color:#888;padding:8px 0">Start Time</td><td style="color:#fff">${new Date(tournament.start_at).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})}</td></tr>
        <tr><td style="color:#888;padding:8px 0">Prize Pool</td><td style="color:#ff6b00;font-weight:bold">₹${tournament.prize_pool}</td></tr>
      </table>
      <p>Room ID and password will be shared <strong>30 minutes before the tournament starts</strong>.</p>
      <p>Good luck! 🎮</p>
    `)
  });
};

// ─── Payment Approved ─────────────────────────────────────────────────────────
const sendPaymentApprovedEmail = async (email, username, details) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `✅ Payment Verified — ${details.tournament} — Arena 24`,
    html: baseTemplate(`
      <h2>Payment Verified! ✅</h2>
      <p>Hi ${username}, your entry fee payment has been verified by our admin.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="color:#888;padding:8px 0">Tournament</td><td style="color:#fff">${details.tournament}</td></tr>
        <tr><td style="color:#888;padding:8px 0">Amount</td><td style="color:#ff6b00;font-weight:bold">₹${details.amount}</td></tr>
        <tr><td style="color:#888;padding:8px 0">Txn ID</td><td style="color:#fff">${details.txn_id}</td></tr>
      </table>
      <p>Your registration is now <strong style="color:#00ff88">confirmed</strong>. See you in the arena! 🏆</p>
    `)
  });
};

// ─── Payment Rejected ─────────────────────────────────────────────────────────
const sendPaymentRejectedEmail = async (email, username, details) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `❌ Payment Rejected — ${details.tournament} — Arena 24`,
    html: baseTemplate(`
      <h2>Payment Could Not Be Verified</h2>
      <p>Hi ${username}, unfortunately we could not verify your payment for:</p>
      <p><strong style="color:#fff">${details.tournament}</strong></p>
      <p>Reason: <span style="color:#ff0040">${details.reason || 'Invalid or duplicate transaction ID'}</span></p>
      <p>Please contact us on Discord or retry with the correct UPI transaction ID.</p>
    `)
  });
};

// ─── Prize Payout Notification ────────────────────────────────────────────────
const sendPrizePayoutEmail = async (email, username, details) => {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: `💰 Prize Money Sent — Arena 24`,
    html: baseTemplate(`
      <h2>Congratulations! 🏆 Prize Money Sent</h2>
      <p>Hi ${username}, your prize money has been sent to your UPI ID!</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="color:#888;padding:8px 0">Tournament</td><td style="color:#fff">${details.tournament}</td></tr>
        <tr><td style="color:#888;padding:8px 0">Placement</td><td style="color:#ff6b00;font-weight:bold">${details.placement}</td></tr>
        <tr><td style="color:#888;padding:8px 0">Prize Amount</td><td style="color:#00ff88;font-weight:bold;font-size:20px">₹${details.amount}</td></tr>
        <tr><td style="color:#888;padding:8px 0">Sent to UPI</td><td style="color:#fff">${details.upi_id}</td></tr>
      </table>
      <p>Check your UPI app for the payment. Thank you for playing on Arena 24! 🎮</p>
    `)
  });
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendTournamentConfirmation,
  sendPaymentApprovedEmail,
  sendPaymentRejectedEmail,
  sendPrizePayoutEmail
};
