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
    // `dateFin` is a plain date ('YYYY-MM-DD'); comparing date_heure <= dateFin would implicitly
    // compare against midnight and exclude the entire day (including "today" filters — the bug
    // behind "today's" figures looking frozen). Compare against the start of the *next* day instead.
    conditions.push('date_heure < DATE_ADD(:dateFin, INTERVAL 1 DAY)');
    params.dateFin = dateFin;
  }

  return query(
    `SELECT * FROM transactions WHERE ${conditions.join(' AND ')} ORDER BY date_heure DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

// Masque partiellement un nom/prénom ("Awa Diop" -> "A. D.") et un numéro de téléphone
// ("+2250700000012" -> "+225••••••12") — anonymisation du client dans l'historique marchand
// (cahier des charges 6.5 : "client anonymisé selon la réglementation"). Ne s'applique qu'à la
// personne physique cliente vue par un marchand, jamais à l'identité d'un marchand (raison
// sociale) ni à la vue d'un client sur son propre historique.
function maskName(nom) {
  if (!nom) return nom;
  return nom
    .trim()
    .split(/\s+/)
    .map((part) => (part ? `${part[0].toUpperCase()}.` : part))
    .join(' ');
}

function maskPhone(telephone) {
  if (!telephone || telephone.length <= 4) return '••••';
  const prefixLen = Math.min(4, telephone.length - 2);
  return `${telephone.slice(0, prefixLen)}${'•'.repeat(Math.max(3, telephone.length - prefixLen - 2))}${telephone.slice(-2)}`;
}

// Resolves the "other side" of a transaction (the counterparty) so the app can show a phone
// number in the transaction detail — e.g. the client's number for a merchant's "achat", or the
// recipient's number for a transfer. `wallet_source_id`/`wallet_destination_id` only carry an
// AfriPay wallet id, not a name/phone, hence the extra lookups here. `viewerType` ('client' |
// 'marchand') anonymise l'identité du client quand le spectateur est un marchand.
async function resolveCounterparty(tx, walletId, viewerType) {
  const otherWalletId = tx.wallet_source_id === walletId ? tx.wallet_destination_id : tx.wallet_source_id;

  if (!otherWalletId) {
    // No AfriPay wallet on the other side: either an external mobile-money transfer (the
    // recipient's number is stored on transfer_external) or a recharge (money comes from the
    // provider, not from another AfriPay account — no counterparty to show).
    if (tx.type === 'transfert') {
      const rows = await query(
        'SELECT numéro_destinataire, opérateur_destination FROM transfer_external WHERE transaction_id = :id LIMIT 1',
        { id: tx.id }
      );
      if (rows[0]) return { telephone: rows[0].numéro_destinataire, fournisseur: rows[0].opérateur_destination, externe: true };
    }
    return null;
  }

  const walletRows = await query(
    'SELECT propriétaire_id, type_propriétaire FROM wallets WHERE id = :id LIMIT 1',
    { id: otherWalletId }
  );
  const otherWallet = walletRows[0];
  if (!otherWallet) return null;

  if (otherWallet.type_propriétaire === 'marchand') {
    const rows = await query('SELECT raison_sociale, telephone FROM merchants WHERE id = :id LIMIT 1', {
      id: otherWallet.propriétaire_id,
    });
    if (!rows[0]) return null;
    return { telephone: rows[0].telephone, nom: rows[0].raison_sociale };
  }

  const rows = await query('SELECT nom, prenom, telephone FROM users WHERE id = :id LIMIT 1', {
    id: otherWallet.propriétaire_id,
  });
  if (!rows[0]) return null;
  const fullName = `${rows[0].prenom} ${rows[0].nom}`.trim();
  if (viewerType === 'marchand') {
    return { telephone: maskPhone(rows[0].telephone), nom: maskName(fullName), anonymisé: true };
  }
  return { telephone: rows[0].telephone, nom: fullName };
}

async function attachCounterparties(transactions, walletId, viewerType) {
  return Promise.all(
    transactions.map(async (tx) => ({ ...tx, contrepartie: await resolveCounterparty(tx, walletId, viewerType) }))
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

module.exports = { recordTransaction, getById, listForWallet, statsForWallet, attachCounterparties, maskName, maskPhone };
