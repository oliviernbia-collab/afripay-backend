const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const ApiError = require('../utils/ApiError');

const VALID_PROVIDERS = ['wave', 'orange_money', 'moov_money', 'mtn_money', 'djamo', 'visa'];

// Moyens de paiement enregistrés par le client (section 5.3 : "endroit pour enregistrer les
// informations du moyen de paiement" avant de recharger). `identifiant` est le numéro Mobile
// Money pour les fournisseurs Mobile Money, ou les 4 derniers chiffres uniquement pour une carte
// Visa — jamais le PAN complet (cf. section 3.4, jamais de donnée de carte en clair).
async function create({ userId, fournisseur, identifiant, libelle }) {
  if (!VALID_PROVIDERS.includes(fournisseur)) {
    throw new ApiError(400, `Fournisseur inconnu: ${fournisseur}`);
  }
  if (!identifiant || !identifiant.trim()) {
    throw new ApiError(400, 'identifiant requis (numéro de téléphone ou 4 derniers chiffres de la carte)');
  }
  if (fournisseur === 'visa' && !/^\d{4}$/.test(identifiant.trim())) {
    throw new ApiError(400, 'Pour une carte Visa, saisissez uniquement les 4 derniers chiffres');
  }

  const id = uuidv4();
  await query(
    `INSERT INTO payment_methods (id, user_id, fournisseur, identifiant, libelle)
     VALUES (:id, :userId, :fournisseur, :identifiant, :libelle)`,
    { id, userId, fournisseur, identifiant: identifiant.trim(), libelle: libelle?.trim() || null }
  );
  return findById(id);
}

async function findById(id) {
  const rows = await query('SELECT * FROM payment_methods WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

async function listForUser(userId, fournisseur) {
  if (fournisseur) {
    return query(
      'SELECT * FROM payment_methods WHERE user_id = :userId AND fournisseur = :fournisseur ORDER BY date_creation DESC',
      { userId, fournisseur }
    );
  }
  return query('SELECT * FROM payment_methods WHERE user_id = :userId ORDER BY date_creation DESC', { userId });
}

async function remove(userId, id) {
  await query('DELETE FROM payment_methods WHERE id = :id AND user_id = :userId', { id, userId });
}

module.exports = { create, findById, listForUser, remove, VALID_PROVIDERS };
