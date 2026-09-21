const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');

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

async function updateKybStatus(merchantId, statut) {
  await query('UPDATE merchants SET statut_kyb = :statut WHERE id = :merchantId', { merchantId, statut });
}

function toPublic(merchant) {
  if (!merchant) return null;
  const { mot_de_passe_hash, code_pin_hash, ...rest } = merchant;
  return rest;
}

module.exports = { findByPhone, findById, createMerchant, setPin, updateKybStatus, toPublic };
