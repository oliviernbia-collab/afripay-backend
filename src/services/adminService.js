const { query } = require('../config/db');
const { normalizeDateRange } = require('../utils/dateRange');

async function findByEmail(email) {
  const rows = await query('SELECT * FROM admins WHERE email = :email AND actif = 1 LIMIT 1', { email });
  return rows[0] || null;
}

async function findById(id) {
  const rows = await query('SELECT * FROM admins WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

// Comme findByEmail, mais sans filtrer sur actif=1 — utilisé pour vérifier l'unicité
// d'un email (y compris face à un compte désactivé) lors d'une mise à jour de profil.
async function findByEmailAny(email) {
  const rows = await query('SELECT * FROM admins WHERE email = :email LIMIT 1', { email });
  return rows[0] || null;
}

async function updateOwnProfile(id, { nom, email }) {
  const sets = [];
  const params = { id };
  if (nom !== undefined) {
    sets.push('nom = :nom');
    params.nom = nom;
  }
  if (email !== undefined) {
    sets.push('email = :email');
    params.email = email;
  }
  if (!sets.length) return findById(id);
  await query(`UPDATE admins SET ${sets.join(', ')} WHERE id = :id`, params);
  return findById(id);
}

async function setPassword(id, motDePasseHash) {
  await query('UPDATE admins SET mot_de_passe_hash = :motDePasseHash WHERE id = :id', { id, motDePasseHash });
}

async function setPhoto(id, photoUrl) {
  await query('UPDATE admins SET photo_url = :photoUrl WHERE id = :id', { id, photoUrl });
  return findById(id);
}

async function listUsers({ statutKyc, search, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
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
  if (debut) {
    conditions.push('date_creation >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('date_creation <= :dateFin');
    params.dateFin = fin;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(
    `SELECT id, nom, prenom, telephone, email, statut_kyc, date_creation FROM users ${where}
     ORDER BY date_creation DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function listMerchants({ statutKyb, search, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
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
  if (debut) {
    conditions.push('date_creation >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('date_creation <= :dateFin');
    params.dateFin = fin;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(
    `SELECT id, type, raison_sociale, rccm, ncc, telephone, email, statut_kyb, date_creation FROM merchants ${where}
     ORDER BY date_creation DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function listTransactions({ type, statut, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
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
  if (debut) {
    conditions.push('date_heure >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('date_heure <= :dateFin');
    params.dateFin = fin;
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

// ---------------------------------------------------------------------
// KYC / KYB — files d'attente documentaires (sections "KYC" et "KYB")
// ---------------------------------------------------------------------
async function listKycDocuments({ statut, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const conditions = ['kd.user_id IS NOT NULL'];
  const params = { limit, offset };
  if (statut) {
    conditions.push('kd.statut = :statut');
    params.statut = statut;
  }
  if (debut) {
    conditions.push('kd.date_soumission >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('kd.date_soumission <= :dateFin');
    params.dateFin = fin;
  }
  return query(
    `SELECT kd.id, kd.type_document, kd.fichier_ref, kd.statut, kd.motif_rejet, kd.date_soumission,
            u.id AS user_id, u.nom, u.prenom, u.telephone, u.statut_kyc
     FROM kyc_documents kd JOIN users u ON u.id = kd.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY kd.date_soumission DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function listKybDocuments({ statut, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const conditions = ['kd.merchant_id IS NOT NULL'];
  const params = { limit, offset };
  if (statut) {
    conditions.push('kd.statut = :statut');
    params.statut = statut;
  }
  if (debut) {
    conditions.push('kd.date_soumission >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('kd.date_soumission <= :dateFin');
    params.dateFin = fin;
  }
  return query(
    `SELECT kd.id, kd.type_document, kd.fichier_ref, kd.statut, kd.motif_rejet, kd.date_soumission,
            m.id AS merchant_id, m.type, m.raison_sociale, m.telephone, m.statut_kyb
     FROM kyc_documents kd JOIN merchants m ON m.id = kd.merchant_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY kd.date_soumission DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

// ---------------------------------------------------------------------
// Wallets — vue consolidée client + marchand (section "Wallets")
// ---------------------------------------------------------------------
async function listWallets({ type, search, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const params = { limit, offset, search: search ? `%${search}%` : '%%' };
  if (debut) params.dateDebut = debut;
  if (fin) params.dateFin = fin;
  const dateConditions = `${debut ? ' AND w.date_maj >= :dateDebut' : ''}${fin ? ' AND w.date_maj <= :dateFin' : ''}`;

  const clientPart = `
    SELECT w.id, w.propriétaire_id, w.type_propriétaire, w.solde, w.devise, w.date_maj,
           u.nom AS proprietaire_nom, u.prenom AS proprietaire_prenom, u.telephone AS proprietaire_telephone
    FROM wallets w JOIN users u ON u.id = w.propriétaire_id AND w.type_propriétaire = 'client'
    WHERE (u.nom LIKE :search OR u.prenom LIKE :search OR u.telephone LIKE :search)${dateConditions}`;
  const merchantPart = `
    SELECT w.id, w.propriétaire_id, w.type_propriétaire, w.solde, w.devise, w.date_maj,
           m.raison_sociale AS proprietaire_nom, NULL AS proprietaire_prenom, m.telephone AS proprietaire_telephone
    FROM wallets w JOIN merchants m ON m.id = w.propriétaire_id AND w.type_propriétaire = 'marchand'
    WHERE (m.raison_sociale LIKE :search OR m.telephone LIKE :search)${dateConditions}`;

  let sql;
  if (type === 'client') sql = clientPart;
  else if (type === 'marchand') sql = merchantPart;
  else sql = `${clientPart} UNION ALL ${merchantPart}`;

  return query(`${sql} ORDER BY date_maj DESC LIMIT :limit OFFSET :offset`, params);
}

async function walletsTotals() {
  const [row] = await query(
    "SELECT COALESCE(SUM(solde),0) AS total, COUNT(*) AS nombre FROM wallets WHERE type_propriétaire = 'client'"
  );
  const [rowM] = await query(
    "SELECT COALESCE(SUM(solde),0) AS total, COUNT(*) AS nombre FROM wallets WHERE type_propriétaire = 'marchand'"
  );
  return { clients: row, marchands: rowM };
}

// ---------------------------------------------------------------------
// Recharges (section "Recharges")
// ---------------------------------------------------------------------
async function listRecharges({ fournisseur, statut, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const conditions = [];
  const params = { limit, offset };
  if (fournisseur) {
    conditions.push('rp.fournisseur = :fournisseur');
    params.fournisseur = fournisseur;
  }
  if (statut) {
    conditions.push('rp.statut = :statut');
    params.statut = statut;
  }
  if (debut) {
    conditions.push('rp.date_creation >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('rp.date_creation <= :dateFin');
    params.dateFin = fin;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(
    `SELECT rp.*, u.nom, u.prenom, u.telephone
     FROM recharge_providers rp JOIN users u ON u.id = rp.user_id
     ${where} ORDER BY rp.date_creation DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

// ---------------------------------------------------------------------
// Biométrie (section "Biométrie")
// ---------------------------------------------------------------------
async function listBiometricEnrolments({ search, limit = 50, offset = 0 } = {}) {
  const conditions = ['bpt.actif = 1'];
  const params = { limit, offset };
  if (search) {
    conditions.push('(u.nom LIKE :search OR u.prenom LIKE :search OR u.telephone LIKE :search)');
    params.search = `%${search}%`;
  }
  return query(
    `SELECT bpt.id, bpt.palm_code, bpt.version_algo, bpt.date_enrôlement,
            u.id AS user_id, u.nom, u.prenom, u.telephone, u.statut_kyc
     FROM biometric_palm_templates bpt JOIN users u ON u.id = bpt.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY bpt.date_enrôlement DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function listBiometricLogs({ resultat, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const conditions = [];
  const params = { limit, offset };
  if (resultat) {
    conditions.push('bsl.resultat = :resultat');
    params.resultat = resultat;
  }
  if (debut) {
    conditions.push('bsl.date_heure >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('bsl.date_heure <= :dateFin');
    params.dateFin = fin;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(
    `SELECT bsl.*, u.nom AS user_nom, u.prenom AS user_prenom, m.raison_sociale AS marchand_nom, m.telephone AS marchand_telephone
     FROM biometric_scan_logs bsl
     LEFT JOIN users u ON u.id = bsl.user_id
     LEFT JOIN merchants m ON m.id = bsl.merchant_id
     ${where} ORDER BY bsl.date_heure DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function biometricStats() {
  const [enrolled] = await query('SELECT COUNT(*) AS total FROM biometric_palm_templates WHERE actif = 1');
  const [attempts] = await query('SELECT COUNT(*) AS total FROM biometric_scan_logs');
  const [success] = await query("SELECT COUNT(*) AS total FROM biometric_scan_logs WHERE resultat = 'succes'");
  const [failed] = await query("SELECT COUNT(*) AS total FROM biometric_scan_logs WHERE resultat = 'echec'");
  return { enrolled: enrolled.total, attempts: attempts.total, success: success.total, failed: failed.total };
}

// ---------------------------------------------------------------------
// Fraude — signaux composés à partir des échecs biométriques et des comptes suspendus
// ---------------------------------------------------------------------
async function fraudSignals() {
  const echecsRecents = await query(
    `SELECT bsl.*, u.nom AS user_nom, u.prenom AS user_prenom, m.raison_sociale AS marchand_nom
     FROM biometric_scan_logs bsl
     LEFT JOIN users u ON u.id = bsl.user_id
     LEFT JOIN merchants m ON m.id = bsl.merchant_id
     WHERE bsl.resultat = 'echec'
     ORDER BY bsl.date_heure DESC LIMIT 50`
  );
  const echecsRepetes = await query(
    `SELECT adresse_ip, COUNT(*) AS tentatives, MAX(date_heure) AS derniere_tentative
     FROM biometric_scan_logs WHERE resultat = 'echec' AND adresse_ip IS NOT NULL
     GROUP BY adresse_ip HAVING COUNT(*) >= 3 ORDER BY tentatives DESC LIMIT 20`
  );
  const usersSuspendus = await query(
    "SELECT id, nom, prenom, telephone, statut_kyc, date_maj FROM users WHERE statut_kyc = 'suspendu' ORDER BY date_maj DESC"
  );
  const merchantsSuspendus = await query(
    "SELECT id, raison_sociale, telephone, statut_kyb, date_maj FROM merchants WHERE statut_kyb = 'suspendu' ORDER BY date_maj DESC"
  );
  const transactionsEchouees = await query(
    "SELECT * FROM transactions WHERE statut = 'échoué' ORDER BY date_heure DESC LIMIT 30"
  );
  return { echecsRecents, echecsRepetes, usersSuspendus, merchantsSuspendus, transactionsEchouees };
}

// ---------------------------------------------------------------------
// Notifications (vue admin — section "Notifications")
// ---------------------------------------------------------------------
async function listAllNotifications({ type, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const conditions = [];
  const params = { limit, offset };
  if (type) {
    conditions.push('type = :type');
    params.type = type;
  }
  if (debut) {
    conditions.push('date_creation >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('date_creation <= :dateFin');
    params.dateFin = fin;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(`SELECT * FROM notifications ${where} ORDER BY date_creation DESC LIMIT :limit OFFSET :offset`, params);
}

// ---------------------------------------------------------------------
// Utilisateurs internes (comptes admin — section "Utilisateurs internes")
// ---------------------------------------------------------------------
async function listAdmins() {
  return query('SELECT id, nom, email, role, actif, date_creation FROM admins ORDER BY date_creation ASC');
}

async function createAdmin({ id, nom, email, motDePasseHash, role }) {
  await query(
    `INSERT INTO admins (id, nom, email, mot_de_passe_hash, role, actif) VALUES (:id, :nom, :email, :motDePasseHash, :role, 1)`,
    { id, nom, email, motDePasseHash, role }
  );
  return findById(id);
}

async function updateAdmin(id, fields) {
  const sets = [];
  const params = { id };
  if (fields.role !== undefined) {
    sets.push('role = :role');
    params.role = fields.role;
  }
  if (fields.actif !== undefined) {
    sets.push('actif = :actif');
    params.actif = fields.actif ? 1 : 0;
  }
  if (!sets.length) return findById(id);
  await query(`UPDATE admins SET ${sets.join(', ')} WHERE id = :id`, params);
  return findById(id);
}

async function countActiveSuperAdmins(excludeId) {
  const params = { excludeId: excludeId || '' };
  const rows = await query(
    "SELECT COUNT(*) AS total FROM admins WHERE role = 'super_admin' AND actif = 1 AND id <> :excludeId",
    params
  );
  return rows[0].total;
}

module.exports = {
  findByEmail,
  findById,
  listUsers,
  listMerchants,
  listTransactions,
  dashboardStats,
  listKycDocuments,
  listKybDocuments,
  listWallets,
  walletsTotals,
  listRecharges,
  listBiometricEnrolments,
  listBiometricLogs,
  biometricStats,
  fraudSignals,
  listAllNotifications,
  listAdmins,
  createAdmin,
  updateAdmin,
  countActiveSuperAdmins,
  findByEmailAny,
  updateOwnProfile,
  setPassword,
  setPhoto,
};
