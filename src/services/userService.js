const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');

async function findByPhone(telephone) {
  const rows = await query('SELECT * FROM users WHERE telephone = :telephone LIMIT 1', { telephone });
  return rows[0] || null;
}

async function findById(id) {
  const rows = await query('SELECT * FROM users WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

async function createUser({ nom, prenom, telephone, email, motDePasseHash }) {
  const id = uuidv4();
  await query(
    `INSERT INTO users (id, nom, prenom, telephone, email, mot_de_passe_hash, statut_kyc, telephone_verifie)
     VALUES (:id, :nom, :prenom, :telephone, :email, :motDePasseHash, 'en_attente', 1)`,
    { id, nom, prenom, telephone, email: email || null, motDePasseHash }
  );
  return findById(id);
}

async function setPin(userId, pinHash) {
  await query('UPDATE users SET code_pin_hash = :pinHash WHERE id = :userId', { userId, pinHash });
}

async function updateKycStatus(userId, statut) {
  await query('UPDATE users SET statut_kyc = :statut WHERE id = :userId', { userId, statut });
}

async function updateProfile(userId, fields) {
  const allowed = ['nom', 'prenom', 'email', 'adresse', 'date_naissance', 'photo_url', 'langue'];
  const sets = [];
  const params = { userId };
  allowed.forEach((f) => {
    if (fields[f] !== undefined) {
      sets.push(`${f} = :${f}`);
      params[f] = fields[f];
    }
  });
  if (!sets.length) return findById(userId);
  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = :userId`, params);
  return findById(userId);
}

function toPublic(user) {
  if (!user) return null;
  const { mot_de_passe_hash, code_pin_hash, ...rest } = user;
  return rest;
}

module.exports = { findByPhone, findById, createUser, setPin, updateKycStatus, updateProfile, toPublic };
