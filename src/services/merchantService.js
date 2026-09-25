const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { signIfLocalUpload } = require('../utils/signedUpload');

async function findByPhone(telephone) {
  const rows = await query('SELECT * FROM merchants WHERE telephone = :telephone LIMIT 1', { telephone });
  return rows[0] || null;
}

async function findById(id) {
  const rows = await query('SELECT * FROM merchants WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

async function createMerchant({ type, raisonSociale, rccm, ncc, telephone, email, motDePasseHash }) {
  const id = uuidv4();
  await query(
    `INSERT INTO merchants (id, type, raison_sociale, rccm, ncc, telephone, email, mot_de_passe_hash, statut_kyb, telephone_verifie)
     VALUES (:id, :type, :raisonSociale, :rccm, :ncc, :telephone, :email, :motDePasseHash, 'en_attente', 1)`,
    {
      id,
      type,
      raisonSociale: raisonSociale || null,
      rccm: rccm || null,
      ncc: ncc || null,
      telephone,
      email: email || null,
      motDePasseHash,
    }
  );
  return findById(id);
}

async function setPin(merchantId, pinHash) {
  await query('UPDATE merchants SET code_pin_hash = :pinHash WHERE id = :merchantId', { merchantId, pinHash });
}

async function setPassword(merchantId, motDePasseHash) {
  await query('UPDATE merchants SET mot_de_passe_hash = :motDePasseHash WHERE id = :merchantId', {
    merchantId,
    motDePasseHash,
  });
}

async function updateKybStatus(merchantId, statut) {
  await query('UPDATE merchants SET statut_kyb = :statut WHERE id = :merchantId', { merchantId, statut });
}

async function updateProfile(merchantId, fields) {
  const allowed = ['raison_sociale', 'email', 'adresse', 'categorie_activite', 'logo_url'];
  const sets = [];
  const params = { merchantId };
  allowed.forEach((f) => {
    if (fields[f] !== undefined) {
      sets.push(`${f} = :${f}`);
      params[f] = fields[f];
    }
  });
  if (!sets.length) return findById(merchantId);
  await query(`UPDATE merchants SET ${sets.join(', ')} WHERE id = :merchantId`, params);
  return findById(merchantId);
}

async function listAllIds() {
  const rows = await query('SELECT id FROM merchants', {});
  return rows.map((r) => r.id);
}

function toPublic(merchant) {
  if (!merchant) return null;
  const { mot_de_passe_hash, code_pin_hash, ...rest } = merchant;
  return { ...rest, logo_url: signIfLocalUpload(rest.logo_url) };
}

module.exports = {
  findByPhone,
  findById,
  createMerchant,
  setPin,
  setPassword,
  updateKybStatus,
  updateProfile,
  listAllIds,
  toPublic,
};
