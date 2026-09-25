const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const env = require('./config/env');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { verify: verifyUploadSignature } = require('./utils/signedUpload');
const { perfBudgetMiddleware, perfSnapshot } = require('./middleware/perfBudget');
const { pool } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const walletRoutes = require('./routes/walletRoutes');
const kycRoutes = require('./routes/kycRoutes');
const biometricRoutes = require('./routes/biometricRoutes');
const merchantRoutes = require('./routes/merchantRoutes');
const rechargeRoutes = require('./routes/rechargeRoutes');
const transferRoutes = require('./routes/transferRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS restreint à une liste blanche d'origines (CORS_ALLOWED_ORIGINS). L'essentiel de l'API
// reste en Bearer token (pas de cookie), mais le refresh token du back-office admin voyage
// désormais dans un cookie httpOnly (voir adminController.login/refresh) — `credentials: true`
// est donc nécessaire pour que le navigateur l'envoie/l'accepte, uniquement pour les origines de
// la liste blanche (jamais reflété en `*`, ce qui serait incompatible avec des credentials).
const { allowedOrigins } = env.cors;
if (env.nodeEnv === 'production' && allowedOrigins.length === 0) {
  // eslint-disable-next-line no-console
  console.warn('[cors] CORS_ALLOWED_ORIGINS est vide en production : aucune origine cross-site ne sera autorisée.');
}
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // apps mobiles / curl / server-to-server : pas d'en-tête Origin
      if (allowedOrigins.length === 0) return callback(null, env.nodeEnv !== 'production');
      return callback(null, allowedOrigins.includes(origin));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('dev'));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });
app.use('/api', globalLimiter);
app.use(perfBudgetMiddleware);

// Nouveaux fichiers (photos/documents) vont sur Cloudinary — cette route ne reste que pour
// servir d'anciens fichiers uploadés avant la migration (voir config/cloudinary.js). Ces fichiers
// peuvent inclure d'anciens documents KYC/KYB : plutôt que de les laisser accessibles publiquement
// à quiconque devine/obtient une URL, on exige une signature à expiration courte (voir
// utils/signedUpload.js), attachée par le backend chaque fois qu'un photo_url/logo_url/fichier_ref
// local est renvoyé à un client déjà authentifié — une URL simple reste utilisable en <img src>/
// <a href>, contrairement à un header Authorization.
app.use('/uploads', (req, res, next) => {
  const relativePath = req.baseUrl + req.path;
  if (!verifyUploadSignature(relativePath, req.query.exp, req.query.sig)) {
    return res.status(401).json({ success: false, message: 'Lien expiré ou invalide.' });
  }
  next();
});
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Exigence 9.3 : "disponibilité cible de service de 99,5% minimum" — rien n'observait cela avant.
// Ce endpoint est ce qu'un moniteur externe (UptimeRobot, Better Stack, un cron interne...) doit
// interroger périodiquement pour calculer ce taux ; il vérifie réellement la connexion base de
// données plutôt que de répondre "ok" sans rien tester, et expose au passage l'instantané de
// budget de performance (voir middleware/perfBudget.js) pour la cible "<2s" de la même section.
app.get('/api/health', async (req, res) => {
  const startedAt = Date.now();
  let dbOk = true;
  let dbError = null;
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    dbOk = false;
    dbError = e.message;
  }

  const status = dbOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({
    success: dbOk,
    service: 'afripay-backend',
    status,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: {
      database: { ok: dbOk, checkMs: Date.now() - startedAt, error: dbError },
    },
    performance: perfSnapshot(),
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/wallets', walletRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/biometrie', biometricRoutes);
app.use('/api/marchand', merchantRoutes);
app.use('/api/recharges', rechargeRoutes);
app.use('/api/transferts', transferRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
