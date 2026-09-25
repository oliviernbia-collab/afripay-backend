const env = require('../config/env');

// Le refresh token de l'admin (back-office web) voyage dans un cookie httpOnly plutôt que dans le
// corps JSON stocké en localStorage — une XSS (même future/hypothétique, aucune trouvée à ce jour
// dans web/src) ne peut alors plus voler un token valable 30 jours en lisant simplement le
// storage. Scindé du flux mobile (`/auth/refresh`, body-based) qui reste inchangé : un client
// natif n'a pas de notion de cookie de navigateur, et expo-secure-store y est déjà l'équivalent
// correct côté mobile.
const COOKIE_NAME = 'afripay_admin_rt';
const COOKIE_PATH = '/api/admin';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // aligné sur JWT_REFRESH_EXPIRES par défaut (30j)

function setAdminRefreshCookie(res, refreshToken) {
  res.cookie(COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    // 'lax' laisse le cookie partir sur une navigation top-level (peu utile ici) mais jamais sur
    // une requête cross-site déclenchée par un tiers (fetch/POST depuis un autre site) — combiné
    // à la liste blanche CORS déjà en place, ça couvre le CSRF pour cette surface (refresh/logout,
    // qui ne mutent aucune donnée sensible directement).
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: MAX_AGE_MS,
  });
}

function clearAdminRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: COOKIE_PATH,
  });
}

function readAdminRefreshCookie(req) {
  return req.cookies?.[COOKIE_NAME] || null;
}

module.exports = { setAdminRefreshCookie, clearAdminRefreshCookie, readAdminRefreshCookie };
