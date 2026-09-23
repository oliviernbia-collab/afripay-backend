const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { randomReference } = require('../utils/crypto');
const ApiError = require('../utils/ApiError');
const walletService = require('./walletService');
const transactionService = require('./transactionService');

// Transfert interne AfriPay (Client -> Client, Marchand -> Client, Marchand -> Marchand).
async function internalTransfer({ fromWalletId, toWalletId, montant, libelle }) {
  if (fromWalletId === toWalletId) throw new ApiError(400, 'Impossible de transférer vers le même portefeuille');
  await walletService.transferBetweenWallets({ fromWalletId, toWalletId, montant });
  return transactionService.recordTransaction({
    type: 'transfert',
    walletSourceId: fromWalletId,
    walletDestinationId: toWalletId,
    montant,
    statut: 'réussi',
    méthode: 'interne',
    // No default French fallback here: leaving it null when the sender didn't type a note lets
    // each app render its own translated generic label (txTypeLabel) instead of baking one
    // language into the stored row. `libelle` should only ever hold the sender's own text.
    libelle: libelle || null,
  });
}

const VALID_OPERATORS = ['wave', 'orange_money', 'moov_money', 'mtn_money'];

/**
 * MOCK transfert sortant vers Mobile Money externe (section 6.4). En production, chaque opérateur
 * expose une API de "disbursement" nécessitant un contrat marchand dédié. Ici la simulation réussit
 * immédiatement pour permettre de tester le parcours Marchand de bout en bout.
 */
async function externalTransfer({ merchant, opérateurDestination, numéroDestinataire, montant }) {
  if (!VALID_OPERATORS.includes(opérateurDestination)) {
    throw new ApiError(400, `Opérateur de destination inconnu: ${opérateurDestination}`);
  }

  const wallet = await walletService.getWalletByOwner(merchant.id, 'marchand');
  if (Number(wallet.solde) < Number(montant)) throw new ApiError(400, 'Solde marchand insuffisant');

  await query('UPDATE wallets SET solde = solde - :montant WHERE id = :walletId', { montant, walletId: wallet.id });

  const transaction = await transactionService.recordTransaction({
    type: 'transfert',
    walletSourceId: wallet.id,
    walletDestinationId: null,
    montant,
    statut: 'réussi',
    méthode: 'mobile_money',
    libelle: `Transfert vers ${opérateurDestination} (${numéroDestinataire})`,
  });

  const id = uuidv4();
  await query(
    `INSERT INTO transfer_external (id, merchant_id, transaction_id, opérateur_destination, numéro_destinataire, montant, statut)
     VALUES (:id, :merchantId, :transactionId, :operateurDest, :numeroDest, :montant, 'réussi')`,
    {
      id,
      merchantId: merchant.id,
      transactionId: transaction.id,
      operateurDest: opérateurDestination,
      numeroDest: numéroDestinataire,
      montant,
    }
  );

  const updatedWallet = await walletService.getWalletById(wallet.id);
  return { transaction, wallet: updatedWallet };
}

module.exports = { internalTransfer, externalTransfer, VALID_OPERATORS };
