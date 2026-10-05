const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

/**
 * CLIENT JÈKO — PASSERELLE MOBILE MONEY RÉELLE
 * ---------------------------------------------------------------------
 * Jèko (developer.jeko.africa) est un agrégateur ivoirien (Wave, Orange Money, MTN, Moov, Djamo,
 * Visa/Mastercard), partenaire technique de Julaya (établissement de paiement agréé BCEAO). Le
 * wallet/la logique métier restent internes à AfriPay, mais déplacer du vrai argent vers/depuis un
 * opérateur Mobile Money passe par ce fournisseur agréé.
 *
 * Spécification confirmée par la doc publique (developer.jeko.africa/docs, et revérifiée via le
 * serveur MCP jeko / get_endpoint) :
 *  - Payin (encaissement) : POST {apiBaseUrl}/partner_api/payment_requests — entièrement documenté
 *    (champs, réponse), voir initierPayin ci-dessous.
 *  - Payout (retrait) : POST {apiBaseUrl}/partner_api/transfers — `amountCents` (PAS `amount`, en
 *    centimes, minimum 500), et bénéficiaire inline Mobile Money = `name` + `paymentMethod` +
 *    `identifier.reference` (PAS un objet `beneficiary`). Voir initierPayout ci-dessous — ancienne
 *    forme (`amount`/`beneficiary`) corrigée, elle ne correspondait à aucune des formes acceptées
 *    par le schéma réel et aurait échoué en 400/422 hors JEKO_MOCK_MODE.
 *  - Webhooks : SIGNÉS (en-tête `Jeko-Signature`, HMAC-SHA256 du corps BRUT). Voir
 *    verifyWebhookSignature.
 *
 * Pour limiter les dépendances à des champs de réponse non confirmés, le token de rapprochement
 * (`token`/`tokenPay`) utilisé pour relier un webhook à SA transaction n'est jamais une valeur
 * renvoyée par Jèko : c'est toujours la `reference` qu'AfriPay a elle-même générée et envoyée dans
 * la requête (voir transactionService.recordTransaction -> reference, format "AFP-..."), que Jèko
 * est censé échoir telle quelle dans `transactionDetails.reference` du webhook — ce champ est
 * explicitement documenté comme le champ de corrélation ("Request ID field").
 * ---------------------------------------------------------------------
 */

function assertConfigured() {
  if (!env.jeko.apiKey || !env.jeko.apiKeyId || !env.jeko.storeId) {
    throw new ApiError(
      503,
      "Paiement Mobile Money indisponible : JEKO_API_KEY / JEKO_API_KEY_ID / JEKO_STORE_ID ne sont pas configurées."
    );
  }
}

// URL de retour (succès/échec) après la page de paiement hébergée par Jèko — simple page statique
// servie par ce backend (voir routes/paiementWebhookRoutes.js), le crédit du wallet se fait par
// webhook, pas par cette redirection. Omise si le backend n'est pas exposé publiquement, mais c'est
// alors une erreur bloquante pour le payin réel (Jèko exige ces URLs, voir initierPayin).
function retourUrl(statut) {
  if (!env.jeko.publicBaseUrl) return undefined;
  return `${env.jeko.publicBaseUrl.replace(/\/$/, '')}/api/paiements/jeko/retour?statut=${statut}`;
}

// MODE SIMULATION LOCALE (env.jeko.mockMode) — remplace l'appel Jèko par une page HTML servie par
// ce backend où on choisit soi-même le résultat à simuler, qui appelle ensuite EXACTEMENT le même
// chemin de confirmation qu'un vrai webhook Jèko (rechargeService.confirmerPayin /
// transferService.confirmerPayout). Jamais actif en production.
function assertSimulationReachable() {
  if (!env.jeko.publicBaseUrl) {
    throw new ApiError(
      503,
      'Mode simulation Jèko actif mais JEKO_PUBLIC_BASE_URL est vide — renseignez-y l’IP locale par laquelle votre téléphone joint déjà ce serveur (ex. http://192.168.1.150:4000, la même que dans mobileclient/mobilepro src/config/api.js).'
    );
  }
}

function simulationUrl(token, type) {
  return `${env.jeko.publicBaseUrl.replace(/\/$/, '')}/dev/paiement-simulation/${token}?type=${type}`;
}

// Mapping des `fournisseur` internes AfriPay -> `paymentMethod` Jèko (doc Checkout, confirmée :
// wave, orange, mtn, moov, djamo, jeko). Jèko EXIGE un paymentMethod précis : on réutilise donc
// directement l'opérateur déjà choisi dans l'app plutôt que de le redemander sur sa page hébergée.
// Visa n'est pas couvert (absent des paymentMethod documentés) — la recharge carte reste hors
// périmètre pour ce cas, voir rechargeService.js.
const PAYMENT_METHOD_BY_FOURNISSEUR = {
  wave: 'wave',
  orange_money: 'orange',
  moov_money: 'moov',
  mtn_money: 'mtn',
  djamo: 'djamo',
};

// Encaissement (payin) — section Checkout de la doc Jèko. `referenceInterne` sert à la fois de
// `reference` envoyée à Jèko ET de token de rapprochement renvoyé ici (voir commentaire d'en-tête :
// on ne dépend d'aucun champ de réponse Jèko pour le rapprochement webhook).
async function initierPayin({ montant, fournisseur, referenceInterne }) {
  if (env.jeko.mockMode) {
    assertSimulationReachable();
    const token = `mock-payin-${uuidv4()}`;
    return { token, paymentUrl: simulationUrl(token, 'payin') };
  }

  const paymentMethod = PAYMENT_METHOD_BY_FOURNISSEUR[fournisseur];
  if (!paymentMethod) {
    throw new ApiError(400, `Fournisseur de recharge non pris en charge par Jèko: ${fournisseur}`);
  }

  assertConfigured();
  const successUrl = retourUrl('succes');
  const errorUrl = retourUrl('echec');
  if (!successUrl || !errorUrl) {
    throw new ApiError(
      503,
      "Recharge Mobile Money indisponible : JEKO_PUBLIC_BASE_URL n'est pas configurée (requise par Jèko pour les URLs de retour)."
    );
  }

  const res = await fetch(`${env.jeko.apiBaseUrl}/partner_api/payment_requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': env.jeko.apiKey,
      'X-API-KEY-ID': env.jeko.apiKeyId,
    },
    body: JSON.stringify({
      storeId: env.jeko.storeId,
      amountCents: Math.round(Number(montant) * 100),
      currency: 'XOF',
      reference: referenceInterne,
      paymentDetails: {
        type: 'redirect',
        data: { paymentMethod, successUrl, errorUrl },
      },
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.redirectUrl) {
    throw new ApiError(502, json?.errorReason || `Échec de l'initiation du paiement Jèko (${res.status})`, json);
  }
  return { token: referenceInterne, paymentUrl: json.redirectUrl };
}

// Retrait (payout) — `montant` ici est le montant NET déjà envoyé par transferService
// (montant demandé par le marchand moins le frais AfriPay de 2,5%, voir externalTransfer) : c'est
// ce qui part réellement vers le Mobile Money du bénéficiaire. Forme confirmée via
// mcp__jeko__get_endpoint + review (Transfers_createTransfer, variante "inline mobile money
// beneficiary") : `amountCents` (centimes, pas `amount`), et `name` + `paymentMethod` +
// `identifier.reference` (pas d'objet `beneficiary`).
async function initierPayout({ montant, telephone, opérateur, nomBeneficiaire }) {
  const paymentMethod = PAYMENT_METHOD_BY_FOURNISSEUR[opérateur];
  if (!paymentMethod) throw new ApiError(400, `Opérateur de retrait non pris en charge par Jèko: ${opérateur}`);

  if (env.jeko.mockMode) {
    assertSimulationReachable();
    const tokenPay = `mock-payout-${uuidv4()}`;
    return { tokenPay, simulationUrl: simulationUrl(tokenPay, 'payout') };
  }

  assertConfigured();
  const reference = `AFP-OUT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const res = await fetch(`${env.jeko.apiBaseUrl}/partner_api/transfers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': env.jeko.apiKey,
      'X-API-KEY-ID': env.jeko.apiKeyId,
    },
    body: JSON.stringify({
      storeId: env.jeko.storeId,
      amountCents: Math.round(Number(montant) * 100),
      currency: 'XOF',
      reference,
      name: nomBeneficiaire || telephone,
      paymentMethod,
      identifier: { reference: telephone },
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    throw new ApiError(502, json?.errorReason || json?.message || `Échec de l'initiation du retrait Jèko (${res.status})`, json);
  }
  return { tokenPay: reference };
}

// Vérifie la signature HMAC-SHA256 d'un webhook Jèko (en-tête `Jeko-Signature`, hex, calculée sur
// le corps BRUT — voir app.js qui conserve `req.rawBody` via le `verify` d'express.json()
// spécifiquement pour cette route). `rawBody` doit être un Buffer, pas une chaîne déjà re-sérialisée
// (l'ordre des clés/espaces d'un JSON.stringify ne reproduit pas forcément les octets d'origine).
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!env.jeko.webhookSecret || !signatureHeader || !rawBody) return false;
  const expectedHex = crypto.createHmac('sha256', env.jeko.webhookSecret).update(rawBody).digest('hex');
  const expected = Buffer.from(expectedHex, 'hex');
  let received;
  try {
    received = Buffer.from(signatureHeader, 'hex');
  } catch {
    return false;
  }
  // Comparaison à temps constant — une comparaison `===` naïve laisserait fuir la signature
  // attendue octet par octet via le temps de réponse.
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

module.exports = { initierPayin, initierPayout, verifyWebhookSignature, PAYMENT_METHOD_BY_FOURNISSEUR };
