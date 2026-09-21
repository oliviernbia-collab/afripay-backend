const { query } = require('../config/db');

async function findByEmail(email) {
  const rows = await query('SELECT * FROM admins WHERE email = :email AND actif = 1 LIMIT 1', { email });
  return rows[0] || null;
}

async function findById(id) {
  const rows = await query('SELECT * FROM admins WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

async function listUsers({ statutKyc, search, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = { limit, offset };
  if (statutKyc) {
    conditions.push('statut_kyc = :statutKyc');
    params.statutKyc = statutKyc;
  }
  if (search) {
    conditions.push('(nom LIKE :search OR prenom LIKE :search OR telephone LIKE :search OR email LIKE :search)');
    params.search = `%${search}%`;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(
    `SELECT id, nom, prenom, telephone, email, statut_kyc, date_creation FROM users ${where}
     ORDER BY date_creation DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function listMerchants({ statutKyb, search, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = { limit, offset };
  if (statutKyb) {
    conditions.push('statut_kyb = :statutKyb');
    params.statutKyb = statutKyb;
  }
  if (search) {
    conditions.push('(raison_sociale LIKE :search OR telephone LIKE :search OR email LIKE :search)');
    params.search = `%${search}%`;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(
    `SELECT id, type, raison_sociale, rccm, ncc, telephone, email, statut_kyb, date_creation FROM merchants ${where}
     ORDER BY date_creation DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function listTransactions({ type, statut, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = { limit, offset };
  if (type) {
    conditions.push('type = :type');
    params.type = type;
  }
  if (statut) {
    conditions.push('statut = :statut');
    params.statut = statut;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(`SELECT * FROM transactions ${where} ORDER BY date_heure DESC LIMIT :limit OFFSET :offset`, params);
}

async function dashboardStats() {
  const [users] = await query('SELECT COUNT(*) AS total FROM users');
  const [usersValides] = await query("SELECT COUNT(*) AS total FROM users WHERE statut_kyc = 'validé'");
  const [merchants] = await query('SELECT COUNT(*) AS total FROM merchants');
  const [merchantsValides] = await query("SELECT COUNT(*) AS total FROM merchants WHERE statut_kyb = 'validé'");
  const [txStats] = await query(
    "SELECT COUNT(*) AS nombre, COALESCE(SUM(montant),0) AS volume FROM transactions WHERE statut = 'réussi'"
  );
  const [txAchats] = await query(
    "SELECT COUNT(*) AS nombre, COALESCE(SUM(montant),0) AS volume FROM transactions WHERE statut='réussi' AND type='achat'"
  );
  const [kycPending] = await query("SELECT COUNT(*) AS total FROM users WHERE statut_kyc = 'en_attente'");
  const [kybPending] = await query("SELECT COUNT(*) AS total FROM merchants WHERE statut_kyb = 'en_attente'");

  return {
    utilisateurs: { total: users.total, kycValides: usersValides.total },
    marchands: { total: merchants.total, kybValides: merchantsValides.total },
    transactions: { nombre: txStats.nombre, volumeFcfa: txStats.volume },
    achats: { nombre: txAchats.nombre, volumeFcfa: txAchats.volume },
    dossiersEnAttente: { kyc: kycPending.total, kyb: kybPending.total },
  };
}

module.exports = { findByEmail, findById, listUsers, listMerchants, listTransactions, dashboardStats };
