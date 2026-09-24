const { v4: uuidv4 } = require('uuid');
const { query, pool } = require('../config/db');
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
  const amount = Number(montant);
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'Montant invalide');

  // Débit verrouillé dans une transaction SQL (SELECT ... FOR UPDATE), comme le transfert interne
  // (walletService.transferBetweenWallets) : sans ce verrou, deux appels concurrents pouvaient lire
  // le même solde initial et débiter chacun séparément, faisant passer le solde marchand en négatif.
  const conn = await pool.getConnection();
  let wallet;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM wallets WHERE propriétaire_id = ? AND type_propriétaire = ? FOR UPDATE', [
      merchant.id,
      'marchand',
    ]);
    wallet = rows[0];
    if (!wallet) throw new ApiError(404, 'Portefeuille marchand introuvable');
    if (Number(wallet.solde) < amount) throw new ApiError(400, 'Solde marchand insuffisant');

    await conn.query('UPDATE wallets SET solde = solde - ? WHERE id = ?', [amount, wallet.id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  const transaction = await transactionService.recordTransaction({
    type: 'transfert',
    walletSourceId: wallet.id,
    walletDestinationId: null,
    montant: amount,
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
      montant: amount,
    }
  );

  const updatedWallet = await walletService.getWalletById(wallet.id);
  return { transaction, wallet: updatedWallet };
}

module.exports = { internalTransfer, externalTransfer, VALID_OPERATORS };
