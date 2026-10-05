const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const walletService = require('./walletService');
const transactionService = require('./transactionService');
const kycService = require('./kycService');
const paymentMethodService = require('./paymentMethodService');
const jekoService = require('./jekoService');
const notificationService = require('./notificationService');
const userService = require('./userService');
const { calculerFrais } = require('../utils/amount');
const env = require('../config/env');
const { t } = require('../i18n');

const VALID_PROVIDERS = ['wave', 'orange_money', 'moov_money', 'mtn_money', 'djamo', 'visa'];

/**
 * ENCAISSEMENT MOBILE MONEY RÉEL (payin Jèko) — section 3.4 du cahier des charges.
 * ---------------------------------------------------------------------
 * Remplace l'ancien mock (qui créditait le wallet instantanément) par un vrai appel à
 * jekoService.initierPayin : la transaction est créée `en_attente`, le wallet n'est crédité que
 * lorsque le webhook `TRANSACTION_COMPLETED` confirme le paiement (voir
 * controllers/paiementWebhookController.js) — Jèko ne débite jamais le client instantanément, il
 * redirige vers une page de paiement hébergée (`paymentUrl` ci-dessous).
 * `fournisseur` (opérateur déjà choisi côté app) est transmis tel quel à Jèko, qui exige un
 * paymentMethod précis — voir jekoService.PAYMENT_METHOD_BY_FOURNISSEUR.
 * ---------------------------------------------------------------------
 */
async function rechargeWallet({ user, fournisseur, montant, moyenPaiementId }) {
  await kycService.assertRechargeAllowed(user, montant);

  if (!VALID_PROVIDERS.includes(fournisseur)) {
    const ApiError = require('../utils/ApiError');
    throw new ApiError(400, `Fournisseur de recharge inconnu: ${fournisseur}`);
  }

  // Ne rattache le moyen de paiement que s'il appartient bien à l'utilisateur — sinon on l'ignore
  // silencieusement plutôt que de faire échouer toute la recharge pour un id invalide/périmé.
  let safeMoyenPaiementId = null;
  if (moyenPaiementId) {
    const method = await paymentMethodService.findById(moyenPaiementId);
    if (method && method.user_id === user.id) safeMoyenPaiementId = moyenPaiementId;
  }

  const wallet = await walletService.getWalletByOwner(user.id, 'client');

  // Le client paie le plein `montant` via Jèko (voir initierPayin plus bas, inchangé) ; AfriPay
  // retient `frais` (2,5%) sur ce qui est réellement crédité au wallet à la confirmation
  // (confirmerPayin ci-dessous) — voir réponse à la question posée : frais déduit du montant.
  const frais = calculerFrais(montant, env.business.fraisRechargeTaux);

  const transaction = await transactionService.recordTransaction({
    type: 'recharge',
    walletSourceId: null,
    walletDestinationId: wallet.id,
    montant,
    frais,
    statut: 'en_attente',
    méthode: fournisseur === 'visa' ? 'carte_visa' : 'mobile_money',
    libelle: t(user.langue, 'tx.rechargeLibelle', { provider: t(user.langue, `providers.${fournisseur}`) }),
  });

  const { token, paymentUrl } = await jekoService.initierPayin({
    montant,
    fournisseur,
    referenceInterne: transaction.reference,
  });

  const rechargeId = uuidv4();
  await query(
    `INSERT INTO recharge_providers (id, user_id, transaction_id, moyen_paiement_id, fournisseur, référence_externe, montant, statut)
     VALUES (:id, :userId, :transactionId, :moyenPaiementId, :fournisseur, :refExterne, :montant, 'en_attente')`,
    {
      id: rechargeId,
      userId: user.id,
      transactionId: transaction.id,
      moyenPaiementId: safeMoyenPaiementId,
      fournisseur,
      refExterne: token,
      montant,
    }
  );

  // Le wallet n'est PAS crédité ici — voir confirmerPayin ci-dessous, seul endroit qui crédite,
  // une fois le paiement réellement confirmé par Jèko (webhook).
  return { transaction, wallet, paymentUrl };
}

// Appelé par le webhook Jèko (voir controllers/paiementWebhookController.js) — jamais par une app
// mobile. `token` = référence AfriPay (transaction.reference) renvoyée telle quelle par
// jekoService.initierPayin, retrouvée dans recharge_providers.référence_externe. Ne fait rien
// (silencieusement) si aucune recharge `en_attente` ne correspond : soit déjà traitée (un webhook
// peut être renvoyé plusieurs fois), soit un token qu'on n'a jamais émis — dans les deux cas, pas
// d'erreur à faire remonter.
async function confirmerPayin(token, { réussi }) {
  // JOIN sur transactions pour récupérer `frais` (calculé à l'initiation dans rechargeWallet,
  // voir plus haut) — recharge_providers ne stocke que le montant brut demandé.
  const rows = await query(
    `SELECT rp.*, t.frais AS frais
     FROM recharge_providers rp
     LEFT JOIN transactions t ON t.id = rp.transaction_id
     WHERE rp.référence_externe = :token AND rp.statut = 'en_attente' LIMIT 1`,
    { token }
  );
  const recharge = rows[0];
  if (!recharge) return false;

  const nouveauStatut = réussi ? 'réussi' : 'échoué';
  await query('UPDATE recharge_providers SET statut = :statut WHERE id = :id', { statut: nouveauStatut, id: recharge.id });
  if (recharge.transaction_id) {
    await query('UPDATE transactions SET statut = :statut WHERE id = :id', { statut: nouveauStatut, id: recharge.transaction_id });
  }
  if (réussi) {
    // recharge_providers ne stocke pas le wallet_id (seulement user_id) — le retrouver via le
    // wallet Client, comme partout ailleurs dans le projet (walletService.getWalletByOwner).
    // Crédité : montant demandé moins le frais AfriPay (2,5%, déjà retenu par Jèko côté payin —
    // le client, lui, a payé le plein montant via son opérateur Mobile Money).
    const wallet = await walletService.getWalletByOwner(recharge.user_id, 'client');
    const montantNet = Number(recharge.montant) - Number(recharge.frais || 0);
    await walletService.creditWallet(wallet.id, montantNet);
  }

  // L'app promet "vous serez notifié dès la confirmation" (écran Recharge) — ce webhook est le
  // seul endroit qui sait réellement quand ça arrive, potentiellement bien après que l'app ait
  // été fermée.
  const user = await userService.findById(recharge.user_id);
  if (user) {
    const cle = réussi ? 'notif.rechargeConfirmed' : 'notif.rechargeFailed';
    await notificationService.notify({
      destinataireId: user.id,
      typeDestinataire: 'client',
      type: 'transaction',
      titre: t(user.langue, `${cle}.title`),
      contenu: t(user.langue, `${cle}.body`, { montant: recharge.montant }),
      titreCle: `${cle}.title`,
      contenuCle: `${cle}.body`,
      params: { montant: recharge.montant },
    });
  }

  return true;
}

async function listForUser(userId, { limit = 50, offset = 0 } = {}) {
  return query(
    'SELECT * FROM recharge_providers WHERE user_id = :userId ORDER BY date_creation DESC LIMIT :limit OFFSET :offset',
    { userId, limit, offset }
  );
}

module.exports = { rechargeWallet, confirmerPayin, listForUser, VALID_PROVIDERS };
