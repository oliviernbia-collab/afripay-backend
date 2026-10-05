const express = require('express');
const rechargeController = require('../controllers/rechargeController');
const { authenticate, requireType } = require('../middleware/auth');

const router = express.Router();

router.get('/fournisseurs', rechargeController.providers);
router.get('/frais', authenticate, requireType('client'), rechargeController.frais);
router.post('/', authenticate, requireType('client'), rechargeController.recharge);
router.get('/mes-recharges', authenticate, requireType('client'), rechargeController.myRecharges);

router.get('/moyens-paiement', authenticate, requireType('client'), rechargeController.listPaymentMethods);
router.post('/moyens-paiement', authenticate, requireType('client'), rechargeController.addPaymentMethod);
router.delete('/moyens-paiement/:id', authenticate, requireType('client'), rechargeController.removePaymentMethod);

module.exports = router;
