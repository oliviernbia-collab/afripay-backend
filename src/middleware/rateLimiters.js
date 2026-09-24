const rateLimit = require('express-rate-limit');

// Limiteurs dédiés, plus stricts que le limiteur global (600 req/15min sur toute l'API) — les
// endpoints d'authentification et d'OTP sont des cibles privilégiées de brute-force et de spam
// (coût réel en SMS pour l'OTP en production), donc traités à part (exigence 9.1).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de tentatives de connexion. Réessayez plus tard.' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Trop de demandes de code. Réessayez plus tard." },
});

module.exports = { loginLimiter, otpLimiter };
