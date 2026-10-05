const express = require('express');
const paiementWebhookController = require('../controllers/paiementWebhookController');

const router = express.Router();

// Publique et volontairement SANS middleware `authenticate` : Jèko appelle cette route
// directement (voir controllers/paiementWebhookController.js pour la vérification de signature).
router.post('/jeko/webhook', paiementWebhookController.jekoWebhook);

// Page de retour statique après la page de paiement hébergée par Jèko (successUrl/errorUrl exigées
// par leur API, voir services/jekoService.js) — purement cosmétique : le crédit réel du wallet se
// fait par le webhook ci-dessus, jamais par cette redirection (que le client peut fermer avant même
// qu'elle ne s'affiche, cf. recommandation de la doc Jèko de ne jamais se fier au retour navigateur).
router.get('/jeko/retour', (req, res) => {
  const succes = req.query.statut !== 'echec';
  const titre = succes ? '✅ Paiement en cours de confirmation' : '❌ Paiement annulé ou échoué';
  const detail = succes
    ? 'Votre solde AfriPay sera mis à jour dès la confirmation — en général quelques secondes.'
    : "Le paiement n'a pas abouti. Vous pouvez réessayer depuis l'application AfriPay.";
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AfriPay — Paiement</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;background:#0B0B0F;color:#fff;max-width:480px;margin:0 auto}
p{color:#B9B9C2;line-height:1.5}</style></head>
<body><h2>${titre}</h2><p>${detail}</p><p>Vous pouvez fermer cette page et retourner dans l'application AfriPay.</p></body></html>`);
});

module.exports = router;
