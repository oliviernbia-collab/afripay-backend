const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, otpLimiter, otpConsumeLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Client
router.post('/client/otp', otpLimiter, authController.clientRequestOtp);
router.post('/client/register', otpConsumeLimiter, authController.clientRegister);
router.post('/client/login', loginLimiter, authController.clientLogin);
router.post('/client/pin', authenticate, authController.clientSetPin);
router.post('/client/password', authenticate, authController.clientChangePassword);
router.post('/client/otp-reset', otpLimiter, authController.clientRequestResetOtp);
router.post('/client/reset-pin', otpConsumeLimiter, authController.clientResetPin);
router.post('/client/reset-password', otpConsumeLimiter, authController.clientResetPassword);
router.patch('/client/langue', authenticate, authController.clientUpdateLanguage);

// Marchand
router.post('/marchand/otp', otpLimiter, authController.merchantRequestOtp);
router.post('/marchand/register', otpConsumeLimiter, authController.merchantRegister);
router.post('/marchand/login', loginLimiter, authController.merchantLogin);
router.post('/marchand/pin', authenticate, authController.merchantSetPin);
router.post('/marchand/otp-reset', otpLimiter, authController.merchantRequestResetOtp);
router.post('/marchand/reset-pin', otpConsumeLimiter, authController.merchantResetPin);
router.post('/marchand/reset-password', otpConsumeLimiter, authController.merchantResetPassword);

// Commun
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);
router.get('/sessions', authenticate, authController.listMySessions);
router.delete('/sessions/:id', authenticate, authController.revokeMySession);

module.exports = router;
