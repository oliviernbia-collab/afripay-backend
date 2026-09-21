const { v4: uuidv4 } = require('uuid');
const { query, pool } = require('../config/db');
const ApiError = require('../utils/ApiError');

async function createWallet(ownerId, ownerType) {
  const id = uuidv4();
  await query(
    'INSERT INTO wallets (id, propriétaire_id, type_propriétaire, solde, devise) VALUES (:id, :ownerId, :ownerType, 0, "FCFA")',
    { id, ownerId, ownerType }
  );
  return getWalletByOwner(ownerId, ownerType);
}

async function getWalletByOwner(ownerId, ownerType) {
  const rows = await query(
    'SELECT * FROM wallets WHERE propriétaire_id = :ownerId AND type_propriétaire = :ownerType LIMIT 1',
    { ownerId, ownerType }
  );
  return rows[0] || null;
}

async function getWalletById(id) {
  const rows = await query('SELECT * FROM wallets WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

// Débite `fromWallet` et crédite `toWallet` de façon atomique (transaction SQL avec verrous de ligne).
async function transferBetweenWallets({ fromWalletId, toWalletId, montant }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sourceRows] = await conn.query('SELECT * FROM wallets WHERE id = ? FOR UPDATE', [fromWalletId]);
    const source = sourceRows[0];
    if (!source) throw new ApiError(404, 'Portefeuille source introuvable');
    if (Number(source.solde) < Number(montant)) throw new ApiError(400, 'Solde insuffisant');

    const [destRows] = await conn.query('SELECT * FROM wallets WHERE id = ? FOR UPDATE', [toWalletId]);
    const dest = destRows[0];
    if (!dest) throw new ApiError(404, 'Portefeuille destinataire introuvable');

    await conn.query('UPDATE wallets SET solde = solde - ? WHERE id = ?', [montant, fromWalletId]);
    await conn.query('UPDATE wallets SET solde = solde + ? WHERE id = ?', [montant, toWalletId]);

    await conn.commit();
    return { source, dest };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function creditWallet(walletId, montant) {
  await query('UPDATE wallets SET solde = solde + :montant WHERE id = :walletId', { walletId, montant });
}

module.exports = { createWallet, getWalletByOwner, getWalletById, transferBetweenWallets, creditWallet };
