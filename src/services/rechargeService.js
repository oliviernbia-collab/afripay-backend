const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const walletService = require('./walletService');
const transactionService = require('./transactionService');
const kycService = require('./kycService');
const paymentMethodService = require('./paymentMethodService');
const moneyFusionService = require('./moneyFusionService');
const notificationService = require('./notificationService');
const userService = require('./userService');
const { t } = require('../i18n');

const VALID_PROVIDERS = ['wave', 'orange_money', 'moov_money', 'mtn_money', 'djamo', 'visa'];

/**
 * ENCAISSEMENT MOBILE MONEY RÉEL (payin MoneyFusion) — section 3.4 du cahier des charges.
 * ---------------------------------------------------------------------
 * Remplace l'ancien mock (qui créditait le wallet instantanément) par un vrai appel à
 * moneyFusionService.initierPayin : la transaction est créée `en_attente`, le wallet n'est
 * crédité que lorsque le webhook `payin.session.completed` confirme le paiement (voir
 * controllers/paiementWebhookController.js) — MoneyFusion ne débite jamais le client
 * instantanément, il redirige vers une page de paiement hébergée (`paymentUrl` ci-dessous) où le
 * client choisit lui-même son opérateur Mobile Money.
 * `fournisseur` reste purement informatif ici (bouton choisi côté app, utilisé pour le libellé) :
 * MoneyFusion ne nous demande pas de le préciser pour le payin.
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

  const transaction = await transactionService.recordTransaction({
    type: 'recharge',
    walletSourceId: null,
    walletDestinationId: wallet.id,
    montant,
    statut: 'en_attente',
    méthode: fournisseur === 'visa' ? 'carte_visa' : 'mobile_money',
    libelle: t(user.langue, 'tx.rechargeLibelle', { provider: t(user.langue, `providers.${fournisseur}`) }),
  });

  const { token, paymentUrl } = await moneyFusionService.initierPayin({
    montant,
    telephone: user.telephone,
    nomClient: `${user.prenom || ''} ${user.nom || ''}`.trim() || user.telephone,
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
  // une fois le paiement réellement confirmé par MoneyFusion (webhook).
  return { transaction, wallet, paymentUrl };
}

// Appelé par le webhook MoneyFusion (voir controllers/paiementWebhookController.js) — jamais par
// une app mobile. `token` = référence renvoyée par initierPayin, retrouvée dans
// recharge_providers.référence_externe. Ne fait rien (silencieusement) si aucune recharge
// `en_attente` ne correspond : soit déjà traitée (le webhook peut être renvoyé plusieurs fois par
// MoneyFusion, voir leur recommandation de dédupliquer via ce token), soit un token qu'on n'a
// jamais émis — dans les deux cas, pas d'erreur à faire remonter.
async function confirmerPayin(token, { réussi }) {
  const rows = await query(
    "SELECT * FROM recharge_providers WHERE référence_externe = :token AND statut = 'en_attente' LIMIT 1",
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
    const wallet = await walletService.getWalletByOwner(recharge.user_id, 'client');
    await walletService.creditWallet(wallet.id, recharge.montant);
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
