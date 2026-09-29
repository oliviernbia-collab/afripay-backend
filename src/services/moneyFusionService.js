const ApiError = require('../utils/ApiError');
const env = require('../config/env');

/**
 * CLIENT MONEYFUSION — PASSERELLE MOBILE MONEY RÉELLE
 * ---------------------------------------------------------------------
 * Remplace les mocks instantanés de rechargeService.js (encaissement/payin) et
 * transferService.js (retrait/payout). Contrairement au reste du pipeline biométrique de ce
 * projet, cette intégration est un VRAI appel à une API externe payante — assumé, c'est
 * exactement ce pour quoi une passerelle de paiement existe (voir la distinction posée par
 * l'utilisateur lui-même en tout début de projet : le wallet/la logique métier peuvent être
 * internes, mais déplacer du vrai argent vers/depuis un opérateur Mobile Money nécessite un
 * fournisseur agréé).
 *
 * Deux limites externes, documentées ici plutôt que découvertes en production :
 *  - Le payout exige une IP sortante FIXE, whitelistée dans le tableau de bord MoneyFusion —
 *    ne fonctionnera pas depuis un poste de dev derrière un routeur grand public/XAMPP tel quel.
 *  - Les deux sens sont confirmés de façon ASYNCHRONE par webhook (voir
 *    controllers/paiementWebhookController.js) — sans backend exposé publiquement
 *    (MONEYFUSION_WEBHOOK_BASE_URL), une transaction reste indéfiniment "en_attente".
 *  - Aucun mécanisme de signature de webhook n'est documenté par MoneyFusion : la vérification
 *    d'authenticité se limite donc à "le token du webhook correspond-il à une transaction que
 *    NOUS avons initiée et qui est encore en attente" (voir paiementWebhookController.js) — pas
 *    une preuve cryptographique. À renforcer si MoneyFusion documente un jour une signature.
 * ---------------------------------------------------------------------
 */

function assertConfigured() {
  if (!env.moneyFusion.apiKey) {
    throw new ApiError(503, "Paiement Mobile Money indisponible : MONEYFUSION_API_KEY n'est pas configurée.");
  }
}

// URL que MoneyFusion doit appeler pour confirmer une transaction — omise si le backend n'est pas
// exposé publiquement (voir env.moneyFusion.webhookBaseUrl) plutôt que d'envoyer une URL
// inatteignable (localhost) qui ferait échouer silencieusement toute confirmation.
function webhookUrl(path) {
  if (!env.moneyFusion.webhookBaseUrl) return undefined;
  return `${env.moneyFusion.webhookBaseUrl.replace(/\/$/, '')}${path}`;
}

// Encaissement (payin) — le client choisit lui-même son opérateur Mobile Money sur la page de
// paiement hébergée par MoneyFusion (`url` de la réponse) ; on ne précise pas l'opérateur ici.
async function initierPayin({ montant, telephone, nomClient, referenceInterne }) {
  assertConfigured();
  if (!env.moneyFusion.payinUrl) {
    throw new ApiError(
      503,
      "Recharge Mobile Money indisponible : MONEYFUSION_PAYIN_URL n'est pas configurée (à récupérer dans le tableau de bord MoneyFusion)."
    );
  }

  const res = await fetch(env.moneyFusion.payinUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      totalPrice: montant,
      article: [{ [`Recharge AfriPay ${referenceInterne}`]: montant }],
      numeroSend: telephone,
      nomclient: nomClient,
      webhook_url: webhookUrl('/api/paiements/moneyfusion/webhook'),
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.statut !== true) {
    throw new ApiError(502, json?.message || `Échec de l'initiation du paiement MoneyFusion (${res.status})`, json);
  }
  return { token: json.token, paymentUrl: json.url };
}

// Mapping des clés opérateur internes AfriPay -> `withdraw_mode` MoneyFusion. Spécifique à la
// Côte d'Ivoire (suffixe -ci, comme env.moneyFusion.countryCode) — à généraliser si AfriPay
// s'étend à d'autres pays un jour.
const WITHDRAW_MODE_BY_OPERATEUR = {
  wave: 'wave-ci',
  orange_money: 'orange-money-ci',
  moov_money: 'moov-ci',
  mtn_money: 'mtn-ci',
};

// Retrait (payout) — nécessite une IP fixe whitelistée côté MoneyFusion, voir commentaire d'en-tête.
async function initierPayout({ montant, telephone, opérateur }) {
  assertConfigured();
  const withdrawMode = WITHDRAW_MODE_BY_OPERATEUR[opérateur];
  if (!withdrawMode) throw new ApiError(400, `Opérateur de retrait non pris en charge par MoneyFusion: ${opérateur}`);

  const res = await fetch(env.moneyFusion.payoutUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'moneyfusion-private-key': env.moneyFusion.apiKey,
    },
    body: JSON.stringify({
      countryCode: env.moneyFusion.countryCode,
      phone: telephone,
      amount: montant,
      withdraw_mode: withdrawMode,
      webhook_url: webhookUrl('/api/paiements/moneyfusion/webhook'),
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.statut !== true) {
    throw new ApiError(502, json?.message || `Échec de l'initiation du retrait MoneyFusion (${res.status})`, json);
  }
  return { tokenPay: json.tokenPay };
}

module.exports = { initierPayin, initierPayout, WITHDRAW_MODE_BY_OPERATEUR };
