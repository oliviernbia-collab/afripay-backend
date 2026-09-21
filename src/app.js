const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { uploadDir } = require('./middleware/upload');

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
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });
app.use('/api', globalLimiter);

app.use('/uploads', express.static(uploadDir));

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
