const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, otpLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Client
router.post('/client/otp', otpLimiter, authController.clientRequestOtp);
router.post('/client/register', authController.clientRegister);
router.post('/client/login', loginLimiter, authController.clientLogin);
router.post('/client/pin', authenticate, authController.clientSetPin);
router.post('/client/password', authenticate, authController.clientChangePassword);
router.post('/client/otp-reset', otpLimiter, authController.clientRequestResetOtp);
router.post('/client/reset-pin', authController.clientResetPin);
router.post('/client/reset-password', authController.clientResetPassword);
router.patch('/client/langue', authenticate, authController.clientUpdateLanguage);

// Marchand
router.post('/marchand/otp', otpLimiter, authController.merchantRequestOtp);
router.post('/marchand/register', authController.merchantRegister);
router.post('/marchand/login', loginLimiter, authController.merchantLogin);
router.post('/marchand/pin', authenticate, authController.merchantSetPin);

// Commun
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);
router.get('/sessions', authenticate, authController.listMySessions);
router.delete('/sessions/:id', authenticate, authController.revokeMySession);

module.exports = router;
