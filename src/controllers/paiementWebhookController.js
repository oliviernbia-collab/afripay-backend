const { ok } = require('../utils/response');
const rechargeService = require('../services/rechargeService');
const transferService = require('../services/transferService');

/**
 * Réception des confirmations MoneyFusion (payin = encaissement Client, payout = retrait
 * Marchand) — voir services/moneyFusionService.js pour le contexte complet (IP fixe requise pour
 * le payout, backend qui doit être exposé publiquement pour recevoir ces appels).
 *
 * Route PUBLIQUE (pas de JWT — MoneyFusion nous appelle directement, il n'a pas de session
 * AfriPay). Aucun mécanisme de signature n'est documenté par MoneyFusion : la seule vérification
 * possible est que le token du webhook corresponde à une transaction `en_attente` que NOUS avons
 * nous-mêmes initiée (voir rechargeService.confirmerPayin / transferService.confirmerPayout) — pas
 * une preuve cryptographique d'authenticité. À renforcer si MoneyFusion documente une signature un
 * jour.
 *
 * Répond TOUJOURS 200 (sauf payload complètement illisible) : une erreur 5xx pousserait
 * MoneyFusion à réessayer indéfiniment un webhook qu'on ne pourra de toute façon jamais traiter
 * correctement (ex. token inconnu) — le détail de chaque cas est simplement loggé côté serveur.
 */
async function moneyFusionWebhook(req, res) {
  const { event } = req.body || {};
  // La doc utilise `token` pour le payin et `tokenPay` pour le payout (nommage incohérent côté
  // MoneyFusion, pas une erreur ici) — on accepte les deux.
  const reference = req.body?.tokenPay || req.body?.token;

  if (!event || !reference) {
    console.warn('[moneyfusion webhook] payload invalide ou incomplet:', JSON.stringify(req.body));
    return ok(res, { received: true });
  }

  try {
    if (event.startsWith('payin.')) {
      const traité = await rechargeService.confirmerPayin(reference, { réussi: event === 'payin.session.completed' });
      if (!traité && event !== 'payin.session.pending') {
        console.warn(`[moneyfusion webhook] payin ${event} : aucune recharge en_attente pour le token ${reference}`);
      }
    } else if (event.startsWith('payout.')) {
      const traité = await transferService.confirmerPayout(reference, { réussi: event === 'payout.session.completed' });
      if (!traité) {
        console.warn(`[moneyfusion webhook] payout ${event} : aucun retrait en_attente pour le token ${reference}`);
      }
    } else {
      console.warn('[moneyfusion webhook] event inconnu:', event);
    }
  } catch (e) {
    // Ne remonte jamais une 5xx à MoneyFusion pour une erreur de notre côté (voir commentaire
    // d'en-tête) — loggée pour investigation, la transaction reste `en_attente` et pourra être
    // réconciliée manuellement si le webhook n'est jamais retenté avec succès.
    console.error(`[moneyfusion webhook] erreur de traitement (${event}, ${reference}):`, e.message);
  }

  ok(res, { received: true });
}

module.exports = { moneyFusionWebhook };
