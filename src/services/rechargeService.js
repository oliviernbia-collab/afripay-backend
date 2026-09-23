const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { randomReference } = require('../utils/crypto');
const walletService = require('./walletService');
const transactionService = require('./transactionService');
const kycService = require('./kycService');
const paymentMethodService = require('./paymentMethodService');
const { t } = require('../i18n');

const VALID_PROVIDERS = ['wave', 'orange_money', 'moov_money', 'mtn_money', 'djamo', 'visa'];

/**
 * MOCK AGRÉGATEURS DE PAIEMENT (section 3.4)
 * En production, chaque fournisseur nécessite une intégration API dédiée avec contrat marchand
 * (Wave Business, Orange Money Merchant API, Moov Africa Money, MTN MoMo Collection, Djamo, PSP Visa
 * certifié PCI-DSS). Ici, la recharge est simulée : elle réussit immédiatement (statut 'réussi') et
 * crédite le portefeuille, afin de permettre de tester tout le parcours utilisateur. Remplacer
 * `simulateProviderCharge` par les appels réels ne change pas le reste du flux (mêmes tables,
 * mêmes endpoints).
 */
async function simulateProviderCharge(fournisseur, montant) {
  if (!VALID_PROVIDERS.includes(fournisseur)) {
    const ApiError = require('../utils/ApiError');
    throw new ApiError(400, `Fournisseur de recharge inconnu: ${fournisseur}`);
  }
  return { statut: 'réussi', référenceExterne: randomReference(fournisseur.toUpperCase()) };
}

async function rechargeWallet({ user, fournisseur, montant, moyenPaiementId }) {
  await kycService.assertRechargeAllowed(user, montant);

  // Ne rattache le moyen de paiement que s'il appartient bien à l'utilisateur — sinon on l'ignore
  // silencieusement plutôt que de faire échouer toute la recharge pour un id invalide/périmé.
  let safeMoyenPaiementId = null;
  if (moyenPaiementId) {
    const method = await paymentMethodService.findById(moyenPaiementId);
    if (method && method.user_id === user.id) safeMoyenPaiementId = moyenPaiementId;
  }

  const wallet = await walletService.getWalletByOwner(user.id, 'client');
  const { statut, référenceExterne } = await simulateProviderCharge(fournisseur, montant);

  const transaction = await transactionService.recordTransaction({
    type: 'recharge',
    walletSourceId: null,
    walletDestinationId: wallet.id,
    montant,
    statut,
    méthode: fournisseur === 'visa' ? 'carte_visa' : 'mobile_money',
    libelle: t(user.langue, 'tx.rechargeLibelle', { provider: t(user.langue, `providers.${fournisseur}`) }),
  });

  const rechargeId = uuidv4();
  await query(
    `INSERT INTO recharge_providers (id, user_id, transaction_id, moyen_paiement_id, fournisseur, référence_externe, montant, statut)
     VALUES (:id, :userId, :transactionId, :moyenPaiementId, :fournisseur, :refExterne, :montant, :statut)`,
    {
      id: rechargeId,
      userId: user.id,
      transactionId: transaction.id,
      moyenPaiementId: safeMoyenPaiementId,
      fournisseur,
      refExterne: référenceExterne,
      montant,
      statut,
    }
  );

  if (statut === 'réussi') {
    await walletService.creditWallet(wallet.id, montant);
  }

  const updatedWallet = await walletService.getWalletById(wallet.id);
  return { transaction, wallet: updatedWallet, référenceExterne };
}

async function listForUser(userId, { limit = 50, offset = 0 } = {}) {
  return query(
    'SELECT * FROM recharge_providers WHERE user_id = :userId ORDER BY date_creation DESC LIMIT :limit OFFSET :offset',
    { userId, limit, offset }
  );
}

module.exports = { rechargeWallet, listForUser, VALID_PROVIDERS };
