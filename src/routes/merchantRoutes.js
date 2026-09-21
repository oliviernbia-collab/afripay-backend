const express = require('express');
const merchantPaymentController = require('../controllers/merchantPaymentController');
const { authenticate, requireType } = require('../middleware/auth');

const router = express.Router();

router.post('/encaisser', authenticate, requireType('marchand'), merchantPaymentController.encaisser);

module.exports = router;
