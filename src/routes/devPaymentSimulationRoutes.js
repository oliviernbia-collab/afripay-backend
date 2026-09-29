const express = require('express');
const controller = require('../controllers/devPaymentSimulationController');

const router = express.Router();

// Publiques (pas de JWT — ouvertes depuis le navigateur du téléphone/PC, pas depuis l'app) et
// verrouillées derrière env.moneyFusion.mockMode côté contrôleur (404 sinon, y compris en
// production où mockMode est toujours false) — voir controllers/devPaymentSimulationController.js.
router.get('/paiement-simulation/:token', controller.page);
router.get('/paiement-simulation/:token/confirmer', controller.confirmer);

module.exports = router;
