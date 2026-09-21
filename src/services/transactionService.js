const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { randomReference } = require('../utils/crypto');

async function recordTransaction({
  type,
  walletSourceId,
  walletDestinationId,
  montant,
  frais = 0,
  statut,
  méthode,
  libelle,
}) {
  const id = uuidv4();
  const reference = randomReference('AFP');
  await query(
    // NB: mysql2 ne reconnaît pas les caractères accentués dans les noms de paramètres nommés
    // (:méthode) -> le placeholder utilisé ici est ':methodeVal', la colonne SQL reste 'méthode'.
    `INSERT INTO transactions (id, type, wallet_source_id, wallet_destination_id, montant, frais, statut, méthode, libelle, reference)
     VALUES (:id, :type, :walletSourceId, :walletDestinationId, :montant, :frais, :statut, :methodeVal, :libelle, :reference)`,
    {
      id,
      type,
      walletSourceId: walletSourceId || null,
      walletDestinationId: walletDestinationId || null,
      montant,
      frais,
      statut,
      methodeVal: méthode,
      libelle: libelle || null,
      reference,
    }
  );
  return getById(id);
}

async function getById(id) {
  const rows = await query('SELECT * FROM transactions WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

// Historique pour un portefeuille donné (client ou marchand), avec filtres type/statut/période.
async function listForWallet(walletId, { type, statut, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const conditions = ['(wallet_source_id = :walletId OR wallet_destination_id = :walletId)'];
  const params = { walletId, limit, offset };

  if (type) {
    conditions.push('type = :type');
    params.type = type;
  }
  if (statut) {
    conditions.push('statut = :statut');
    params.statut = statut;
  }
  if (dateDebut) {
    conditions.push('date_heure >= :dateDebut');
    params.dateDebut = dateDebut;
  }
  if (dateFin) {
    conditions.push('date_heure <= :dateFin');
    params.dateFin = dateFin;
  }

  return query(
    `SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY date_heure DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function statsForWallet(walletId, period = 'jour') {
  const dateExpr =
    period === 'mois' ? "DATE_FORMAT(date_heure, '%Y-%m-01')" : period === 'semaine' ? 'DATE(date_heure - INTERVAL WEEKDAY(date_heure) DAY)' : 'DATE(date_heure)';
  return query(
    `SELECT ${dateExpr} AS periode, COUNT(*) AS nombre, SUM(montant) AS total
     FROM transactions
     WHERE wallet_destination_id = :walletId AND type = 'achat' AND statut = 'réussi'
     GROUP BY periode ORDER BY periode DESC LIMIT 30`,
    { walletId }
  );
}

module.exports = { recordTransaction, getById, listForWallet, statsForWallet };
