const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Client
router.post('/client/otp', authController.clientRequestOtp);
router.post('/client/register', authController.clientRegister);
router.post('/client/login', authController.clientLogin);
router.post('/client/pin', authenticate, authController.clientSetPin);

// Marchand
router.post('/marchand/otp', authController.merchantRequestOtp);
router.post('/marchand/register', authController.merchantRegister);
router.post('/marchand/login', authController.merchantLogin);
router.post('/marchand/pin', authenticate, authController.merchantSetPin);

// Commun
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);
router.get('/sessions', authenticate, authController.listMySessions);
router.delete('/sessions/:id', authenticate, authController.revokeMySession);

module.exports = router;
