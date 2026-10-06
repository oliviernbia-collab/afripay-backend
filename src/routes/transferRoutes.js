const express = require('express');
const transferController = require('../controllers/transferController');
const { authenticate, requireType } = require('../middleware/auth');

const router = express.Router();

router.post('/interne', authenticate, requireType('client', 'marchand'), transferController.transferToAfripayAccount);
router.post('/externe', authenticate, requireType('client', 'marchand'), transferController.transferToExternal);
router.get('/frais-retrait', authenticate, requireType('client', 'marchand'), transferController.fraisRetrait);

module.exports = router;
