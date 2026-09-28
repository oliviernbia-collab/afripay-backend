const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { generatePalmCode, encryptTemplate, decryptTemplate } = require('../utils/crypto');
const env = require('../config/env');
const palmVisionService = require('./palmVisionService');

/**
 * BIOMÉTRIE PAUME DE MAIN
 * ---------------------------------------------------------------------
 * Reconnaissance réelle, calculée localement (voir palmVisionService.js — détection de main +
 * extraction/comparaison de gabarits LBP), sans aucune API/fournisseur externe payant. Le
 * `palm_code` (QR affiché par l'app Client) reste généré à chaque enrôlement comme repli : si la
 * caméra du marchand échoue à identifier le client (mauvais éclairage, angle...), l'app peut
 * toujours scanner ce code — voir verifyByPalmCode plus bas, chemin inchangé.
 * ---------------------------------------------------------------------
 */

function expiryTimestamp() {
  return new Date(Date.now() + env.business.palmCodeTtlSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

async function enrollPalm(userId, photoBuffer) {
  const { descriptor } = await palmVisionService.extractTemplate(photoBuffer);
  const serialized = palmVisionService.serializeTemplate(descriptor);
  const gabarit = encryptTemplate(serialized, env.security.palmTemplateEncKey);
  const palmCode = generatePalmCode();
  const id = uuidv4();

  await query('UPDATE biometric_palm_templates SET actif = 0 WHERE user_id = :userId', { userId });
  await query(
    `INSERT INTO biometric_palm_templates (id, user_id, gabarit_chiffré, palm_code, version_algo, actif, expire_a)
     VALUES (:id, :userId, :gabarit, :palmCode, :versionAlgo, 1, :expireA)`,
    { id, userId, gabarit, palmCode, versionAlgo: palmVisionService.ALGO_VERSION, expireA: expiryTimestamp() }
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

// Identification 1:N (photo prise par le marchand à l'encaissement) : extrait le gabarit de la
// photo présentée puis le compare à tous les gabarits actifs issus de la même version d'algo,
// retient le meilleur score. Coût O(nombre de clients enrôlés) par tentative — acceptable à
// l'échelle d'un pilote/démo, à revoir (index approximatif, pré-filtrage) avant un vrai passage
// à l'échelle avec une base d'utilisateurs importante.
async function recognizeByPhoto(photoBuffer, { merchantId, ip } = {}) {
  const { descriptor: queryDescriptor } = await palmVisionService.extractTemplate(photoBuffer);

  const rows = await query(
    `SELECT user_id, gabarit_chiffré FROM biometric_palm_templates
     WHERE actif = 1 AND version_algo = :versionAlgo`,
    { versionAlgo: palmVisionService.ALGO_VERSION }
  );

  let bestUserId = null;
  let bestScore = 0;
  for (const row of rows) {
    let candidateDescriptor;
    try {
      candidateDescriptor = palmVisionService.deserializeTemplate(
        decryptTemplate(row.gabarit_chiffré, env.security.palmTemplateEncKey)
      );
    } catch {
      continue; // gabarit illisible (ancienne version/clé différente) — ignoré plutôt que de faire échouer tout le scan
    }
    const score = palmVisionService.matchScore(queryDescriptor, candidateDescriptor);
    if (score > bestScore) {
      bestScore = score;
      bestUserId = row.user_id;
    }
  }

  if (!bestUserId || bestScore < env.business.palmCvMinScore) {
    await logAttempt({
      merchantId,
      userId: bestUserId,
      resultat: 'echec',
      motif: `reconnaissance photo: score insuffisant (${bestScore.toFixed(3)})`,
      ip,
    });
    throw new ApiError(404, 'Aucun client identifié pour cette présentation de paume — réessayez ou utilisez le QR');
  }

  await logAttempt({
    merchantId,
    userId: bestUserId,
    resultat: 'succes',
    motif: `reconnaissance photo (score ${bestScore.toFixed(3)})`,
    ip,
  });
  return bestUserId;
}

module.exports = {
  enrollPalm,
  getActiveTemplate,
  refreshActiveCode,
  findUserIdByPalmCode,
  verifyByPalmCode,
  recognizeByPhoto,
  logAttempt,
};
