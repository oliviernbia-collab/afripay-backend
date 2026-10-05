const { ok } = require('../utils/response');
const rechargeService = require('../services/rechargeService');
const transferService = require('../services/transferService');
const jekoService = require('../services/jekoService');

/**
 * Réception des confirmations Jèko (payin = encaissement Client, payout = retrait Marchand) — voir
 * services/jekoService.js pour le contexte complet.
 *
 * Route PUBLIQUE (pas de JWT — Jèko nous appelle directement, il n'a pas de session AfriPay) mais
 * SIGNÉE : chaque webhook porte un en-tête `Jeko-Signature` (HMAC-SHA256 du corps brut), vérifié
 * ici avant tout traitement via jekoService.verifyWebhookSignature — `req.rawBody` est capturé par
 * le `verify` d'express.json() dans app.js, seul moyen de retrouver les octets bruts une fois que
 * express.json() a déjà parsé le corps en objet.
 *
 * Répond TOUJOURS 200 une fois la signature validée (sauf payload illisible/événement inattendu) :
 * une erreur 5xx pousserait Jèko à réessayer indéfiniment un webhook qu'on ne pourra de toute façon
 * jamais traiter correctement (ex. référence inconnue) — le détail de chaque cas est simplement
 * loggé côté serveur. Une signature invalide, elle, est rejetée en 401.
 */
async function jekoWebhook(req, res) {
  const signature = req.get('Jeko-Signature');
  if (!jekoService.verifyWebhookSignature(req.rawBody, signature)) {
    console.warn('[jeko webhook] signature absente ou invalide — payload rejeté');
    return res.status(401).json({ received: false });
  }

  const eventType = req.get('Jeko-Event');
  const { status, transactionDetails, transactionType, id } = req.body || {};
  const reference = transactionDetails?.reference;

  if (eventType !== 'TRANSACTION_COMPLETED' || !reference) {
    console.warn(`[jeko webhook] événement ignoré (${eventType || 'inconnu'}, id=${id || '?'})`);
    return ok(res, { received: true });
  }

  const réussi = status === 'success';
  try {
    if (transactionType === 'payment') {
      const traité = await rechargeService.confirmerPayin(reference, { réussi });
      if (!traité && status !== 'pending') {
        console.warn(`[jeko webhook] paiement ${status} : aucune recharge en_attente pour la référence ${reference}`);
      }
    } else if (transactionType === 'transfer') {
      const traité = await transferService.confirmerPayout(reference, { réussi });
      if (!traité) {
        console.warn(`[jeko webhook] transfert ${status} : aucun retrait en_attente pour la référence ${reference}`);
      }
    } else {
      console.warn('[jeko webhook] transactionType inconnu:', transactionType);
    }
  } catch (e) {
    // Ne remonte jamais une 5xx à Jèko pour une erreur de notre côté (voir commentaire d'en-tête) —
    // loggée pour investigation, la transaction reste `en_attente` et pourra être réconciliée
    // manuellement si le webhook n'est jamais retenté avec succès.
    console.error(`[jeko webhook] erreur de traitement (${transactionType}, ${reference}):`, e.message);
  }

  ok(res, { received: true });
}

module.exports = { jekoWebhook };
