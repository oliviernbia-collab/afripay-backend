const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const env = require('./config/env');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

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

// CORS restreint à une liste blanche d'origines (CORS_ALLOWED_ORIGINS) — l'authentification se
// fait par Bearer token (pas de cookie), donc l'enjeu principal n'est pas le CSRF classique mais
// d'éviter qu'un site tiers quelconque puisse piloter l'API depuis le navigateur d'un utilisateur.
// En développement (liste vide), on reflète l'origine de la requête pour rester pratique en local.
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
  })
);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });
app.use('/api', globalLimiter);

// Nouveaux fichiers (photos/documents) vont sur Cloudinary — cette route ne reste que pour
// servir d'anciens fichiers uploadés avant la migration (voir config/cloudinary.js).
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => res.json({ success: true, service: 'afripay-backend', status: 'ok' }));

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
