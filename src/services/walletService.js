const { v4: uuidv4 } = require('uuid');
const { query, pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const realtime = require('../realtime/socket');

function emitBalance(wallet) {
  realtime.emitToOwner(wallet.type_propriétaire, wallet.propriétaire_id, 'wallet:updated', {
    walletId: wallet.id,
    solde: wallet.solde,
  });
  // Même information, diffusée en plus à tout le back-office (voir web/src/pages/Wallets.jsx) —
  // sans ça, un solde qui change côté mobile ne se voyait sur le web qu'au prochain rechargement
  // manuel de la page.
  realtime.emitToAdmins('admin:wallet_updated', {
    walletId: wallet.id,
    ownerId: wallet.propriétaire_id,
    ownerType: wallet.type_propriétaire,
    solde: wallet.solde,
  });
}

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
  // Garde-fou défensif au niveau service (en plus de la validation faite par les contrôleurs
  // appelants) : Number("abc") vaut NaN, et NaN < x est toujours faux, ce qui contournerait
  // silencieusement la vérification de solde ci-dessous si on ne le rejetait pas explicitement.
  const amount = Number(montant);
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'Montant invalide');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [sourceRows] = await conn.query('SELECT * FROM wallets WHERE id = ? FOR UPDATE', [fromWalletId]);
    const source = sourceRows[0];
    if (!source) throw new ApiError(404, 'Portefeuille source introuvable');
    if (Number(source.solde) < amount) throw new ApiError(400, 'Solde insuffisant');

    const [destRows] = await conn.query('SELECT * FROM wallets WHERE id = ? FOR UPDATE', [toWalletId]);
    const dest = destRows[0];
    if (!dest) throw new ApiError(404, 'Portefeuille destinataire introuvable');

    await conn.query('UPDATE wallets SET solde = solde - ? WHERE id = ?', [amount, fromWalletId]);
    await conn.query('UPDATE wallets SET solde = solde + ? WHERE id = ?', [amount, toWalletId]);

    await conn.commit();
    // Nouveaux soldes calculés en JS plutôt que re-sélectionnés : sans risque puisqu'on est encore
    // sous les verrous de ligne pris ci-dessus (SELECT ... FOR UPDATE), aucune écriture concurrente
    // n'a pu passer entre-temps.
    const newSource = { ...source, solde: Number(source.solde) - amount };
    const newDest = { ...dest, solde: Number(dest.solde) + amount };
    emitBalance(newSource);
    emitBalance(newDest);
    return { source: newSource, dest: newDest };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function creditWallet(walletId, montant) {
  await query('UPDATE wallets SET solde = solde + :montant WHERE id = :walletId', { walletId, montant });
  const wallet = await getWalletById(walletId);
  if (wallet) emitBalance(wallet);
}

module.exports = { createWallet, getWalletByOwner, getWalletById, transferBetweenWallets, creditWallet };
