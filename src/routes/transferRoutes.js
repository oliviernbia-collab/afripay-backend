const express = require('express');
const transferController = require('../controllers/transferController');
const { authenticate, requireType } = require('../middleware/auth');

const router = express.Router();

router.post('/interne', authenticate, requireType('client', 'marchand'), transferController.transferToAfripayAccount);
router.post('/externe', authenticate, requireType('marchand'), transferController.transferToExternal);
router.get('/frais-retrait', authenticate, requireType('marchand'), transferController.fraisRetrait);

module.exports = router;
