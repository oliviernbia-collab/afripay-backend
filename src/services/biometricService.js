const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { generatePalmTemplate } = require('../utils/crypto');
const env = require('../config/env');

/**
 * MOCK BIOMÉTRIE PAUME DE MAIN
 * ---------------------------------------------------------------------
 * Aucun capteur palmaire/veineux réel n'est disponible dans cet environnement.
 * Le flux fonctionnel complet (enrôlement -> capture -> vérification solde -> débit/crédit)
 * est implémenté à l'identique de la section 4 du cahier des charges, mais l'étape de
 * "capture caméra + matching 1:N" (points 6 à 8) est remplacée par un code d'identification
 * (`palm_code`) généré lors de l'enrôlement, affiché sous forme de QR code par l'app Client
 * et lu par la caméra de l'app Marchand (scan QR via expo-camera). Cela permet de tester tout
 * le parcours de paiement de bout en bout avec de vraies caméras, sans dépendre d'un SDK
 * biométrique propriétaire. Pour brancher un vrai capteur : remplacer `verifyByPalmCode`
 * par un appel au SDK (matching 1:N sur `gabarit_chiffré`) — aucune autre couche n'a besoin
 * de changer (le contrat d'API /merchant/encaisser reste identique).
 * ---------------------------------------------------------------------
 */

function expiryTimestamp() {
  return new Date(Date.now() + env.business.palmCodeTtlSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

async function enrollPalm(userId) {
  const { gabarit, palmCode } = generatePalmTemplate(userId);
  const id = uuidv4();

  await query('UPDATE biometric_palm_templates SET actif = 0 WHERE user_id = :userId', { userId });
  await query(
    `INSERT INTO biometric_palm_templates (id, user_id, gabarit_chiffré, palm_code, version_algo, actif, expire_a)
     VALUES (:id, :userId, :gabarit, :palmCode, 'mock-v1', 1, :expireA)`,
    { id, userId, gabarit, palmCode, expireA: expiryTimestamp() }
  );

  return { id, palmCode };
}

async function getActiveTemplate(userId) {
  const rows = await query(
    'SELECT * FROM biometric_palm_templates WHERE user_id = :userId AND actif = 1 ORDER BY date_enrôlement DESC LIMIT 1',
    { userId }
  );
  return rows[0] || null;
}

// Régénère le code de présentation (palm_code) du gabarit actif, avec une nouvelle expiration
// courte — l'ancien code cesse immédiatement de fonctionner. Appelé à chaque fois que l'app
// Client affiche l'écran de paiement (cf. GET /biometrie/mon-code) : contrairement à un code
// statique généré une seule fois à l'enrôlement, cela limite fortement la fenêtre pendant
// laquelle une capture du QR affiché pourrait être réutilisée par un tiers (rejeu).
async function refreshActiveCode(userId) {
  const template = await getActiveTemplate(userId);
  if (!template) return null;

  const palmCode = require('crypto').randomBytes(9).toString('base64url');
  const expireA = expiryTimestamp();
  await query('UPDATE biometric_palm_templates SET palm_code = :palmCode, expire_a = :expireA WHERE id = :id', {
    id: template.id,
    palmCode,
    expireA,
  });
  return { ...template, palm_code: palmCode, expire_a: expireA };
}

async function findUserIdByPalmCode(palmCode) {
  const rows = await query(
    `SELECT user_id FROM biometric_palm_templates
     WHERE palm_code = :palmCode AND actif = 1 AND (expire_a IS NULL OR expire_a > NOW())
     LIMIT 1`,
    { palmCode }
  );
  return rows[0] ? rows[0].user_id : null;
}

async function logAttempt({ merchantId, userId, resultat, motif, ip }) {
  const id = uuidv4();
  await query(
    `INSERT INTO biometric_scan_logs (id, merchant_id, user_id, resultat, motif, adresse_ip)
     VALUES (:id, :merchantId, :userId, :resultat, :motif, :ip)`,
    { id, merchantId: merchantId || null, userId: userId || null, resultat, motif: motif || null, ip: ip || null }
  );
}

async function verifyByPalmCode(palmCode, { merchantId, ip } = {}) {
  const userId = await findUserIdByPalmCode(palmCode);
  if (!userId) {
    await logAttempt({ merchantId, userId: null, resultat: 'echec', motif: 'palm_code inconnu ou inactif', ip });
    throw new ApiError(404, "Aucun client identifié pour cette présentation de paume");
  }
  await logAttempt({ merchantId, userId, resultat: 'succes', ip });
  return userId;
}

module.exports = {
  enrollPalm,
  getActiveTemplate,
  refreshActiveCode,
  findUserIdByPalmCode,
  verifyByPalmCode,
  logAttempt,
};
