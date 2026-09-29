const express = require('express');
const paiementWebhookController = require('../controllers/paiementWebhookController');

const router = express.Router();

// Publique et volontairement SANS middleware `authenticate` : MoneyFusion appelle cette route
// directement (voir controllers/paiementWebhookController.js pour la vérification d'authenticité
// disponible en l'absence de signature documentée par MoneyFusion).
router.post('/moneyfusion/webhook', paiementWebhookController.moneyFusionWebhook);

module.exports = router;
