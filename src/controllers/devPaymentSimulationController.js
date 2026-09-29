const env = require('../config/env');
const rechargeService = require('../services/rechargeService');
const transferService = require('../services/transferService');

/**
 * SIMULATEUR LOCAL MONEYFUSION (dev uniquement) — voir services/moneyFusionService.js pour le
 * contexte complet. Remplace la vraie page de paiement MoneyFusion / le vrai webhook par une page
 * HTML minimale servie ici même : on choisit soi-même le résultat, ce qui appelle ENSUITE
 * exactement le même chemin de confirmation qu'un vrai webhook (rechargeService.confirmerPayin /
 * transferService.confirmerPayout) — permet de tester tout le parcours (transaction en_attente,
 * crédit/débit du wallet, notification) sans dépendre d'aucun des deux prérequis externes
 * (MONEYFUSION_PAYIN_URL, IP fixe pour le payout, backend exposé publiquement).
 *
 * Verrouillé derrière env.moneyFusion.mockMode (lui-même verrouillé à false en production, voir
 * config/env.js) — 404 sinon, y compris avec un token valide.
 */

function page(req, res) {
  if (!env.moneyFusion.mockMode) return res.status(404).send('Not found');
  const { token } = req.params;
  const type = req.query.type === 'payout' ? 'payout' : 'payin';
  const label = type === 'payout' ? 'retrait' : 'recharge';

  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulation MoneyFusion (dev)</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;background:#0B0B0F;color:#fff;max-width:480px;margin:0 auto}
  p{color:#B9B9C2;line-height:1.5}
  a{display:block;margin:14px 0;padding:16px;border-radius:12px;text-align:center;text-decoration:none;font-weight:700}
  .ok{background:#39B54A;color:#fff}
  .ko{background:#E30613;color:#fff}
  code{background:#15151C;padding:2px 6px;border-radius:4px}
</style></head>
<body>
  <h2>Simulation de ${label} (mode dev local)</h2>
  <p>Cette page remplace la vraie page MoneyFusion tant que l'intégration réelle n'est pas
  testable en local (<code>MONEYFUSION_MOCK_MODE=true</code>). Choisissez le résultat à simuler —
  ça déclenchera exactement le même traitement qu'un vrai webhook MoneyFusion.</p>
  <a class="ok" href="/dev/paiement-simulation/${token}/confirmer?type=${type}&reussi=1">✅ Simuler un ${label} réussi</a>
  <a class="ko" href="/dev/paiement-simulation/${token}/confirmer?type=${type}&reussi=0">❌ Simuler un échec</a>
</body></html>`);
}

async function confirmer(req, res) {
  if (!env.moneyFusion.mockMode) return res.status(404).send('Not found');
  const { token } = req.params;
  const type = req.query.type === 'payout' ? 'payout' : 'payin';
  const réussi = req.query.reussi === '1';

  const traité =
    type === 'payout'
      ? await transferService.confirmerPayout(token, { réussi })
      : await rechargeService.confirmerPayin(token, { réussi });

  const titre = !traité
    ? '⚠️ Rien à confirmer'
    : réussi
    ? '✅ Simulé : réussi'
    : '❌ Simulé : échoué';
  const detail = !traité
    ? 'Aucune transaction en_attente ne correspond à ce token (déjà traitée, ou token inconnu).'
    : 'Vérifiez le solde et les notifications dans l’app — la transaction a été mise à jour comme un vrai webhook MoneyFusion l’aurait fait.';

  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Résultat simulation</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;background:#0B0B0F;color:#fff;max-width:480px;margin:0 auto}
p{color:#B9B9C2;line-height:1.5}</style></head>
<body><h2>${titre}</h2><p>${detail}</p><p>Vous pouvez fermer cette page.</p></body></html>`);
}

module.exports = { page, confirmer };
