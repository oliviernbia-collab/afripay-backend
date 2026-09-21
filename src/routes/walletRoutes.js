const express = require('express');
const walletController = require('../controllers/walletController');
const { authenticate, requireType } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authenticate, requireType('client', 'marchand'), walletController.getMyWallet);
router.get('/me/historique', authenticate, requireType('client', 'marchand'), walletController.getMyHistory);
router.get('/me/stats', authenticate, requireType('client', 'marchand'), walletController.getMyStats);

module.exports = router;
