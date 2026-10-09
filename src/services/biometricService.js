const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const ApiError = require('../utils/ApiError');
const { generatePalmCode, encryptTemplate, decryptTemplate } = require('../utils/crypto');
const env = require('../config/env');
const palmVisionService = require('./palmVisionService');
const recentPhotoCache = require('../utils/recentPhotoCache');

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

  const palmCode = crypto.randomBytes(9).toString('base64url');
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

// Anti brute-force sur le repli QR, même principe que recognizeByPhoto : un palm_code valide a
// 72 bits d'entropie (quasi impossible à deviner), mais sans ce verrou un script pourrait tenter
// des codes en boucle sans aucun coût ni limite — défense en profondeur si cette hypothèse
// d'entropie venait à être affaiblie (code plus court, RNG compromis, etc.).
async function verifyByPalmCode(palmCode, { merchantId, ip } = {}) {
  const recentFailures = await countRecentPalmCodeFailures(merchantId, env.business.palmLockoutMinutes);
  if (recentFailures >= env.business.palmMaxFailedAttempts) {
    throw new ApiError(
      429,
      `Trop d'échecs récents. Réessayez dans ${env.business.palmLockoutMinutes} minutes ou utilisez la reconnaissance photo.`
    );
  }

  const userId = await findUserIdByPalmCode(palmCode);
  if (!userId) {
    await logAttempt({ merchantId, userId: null, resultat: 'echec', motif: 'palm_code inconnu ou inactif', ip });
    throw new ApiError(404, "Aucun client identifié pour cette présentation de paume");
  }
  await logAttempt({ merchantId, userId, resultat: 'succes', ip });
  return userId;
}

// Échecs récents d'un type donné (hors rejets qualité, voir motif ci-dessous) pour CE marchand —
// base du blocage anti brute-force. Même principe que pinService.assertNotLockedOut/
// securityEventService.countRecentFailures, mais scopé au marchand plutôt qu'au téléphone : avant
// reconnaissance, on ne sait justement pas encore quel compte client est visé.
async function countRecentFailuresByMotif(merchantId, sinceMinutes, motifPattern) {
  if (!merchantId) return 0;
  const rows = await query(
    `SELECT COUNT(*) AS total FROM biometric_scan_logs
     WHERE merchant_id = :merchantId AND resultat = 'echec' AND motif LIKE :motifPattern
       AND date_heure >= DATE_SUB(NOW(), INTERVAL :sinceMinutes MINUTE)`,
    { merchantId, sinceMinutes, motifPattern }
  );
  return Number(rows[0]?.total || 0);
}

async function countRecentRecognitionFailures(merchantId, sinceMinutes) {
  return countRecentFailuresByMotif(merchantId, sinceMinutes, 'reconnaissance photo:%');
}

async function countRecentPalmCodeFailures(merchantId, sinceMinutes) {
  return countRecentFailuresByMotif(merchantId, sinceMinutes, 'palm_code%');
}

// Identification 1:N (photo prise par le marchand à l'encaissement) : extrait le gabarit de la
// photo présentée puis le compare à tous les gabarits actifs issus de la même version d'algo,
// retient le meilleur score ET exige une marge suffisante avec le second meilleur (évite un match
// ambigu entre deux clients aux gabarits proches). Coût O(nombre de clients enrôlés) par tentative
// — acceptable à l'échelle d'un pilote/démo, à revoir (index approximatif, pré-filtrage) avant un
// vrai passage à l'échelle avec une base d'utilisateurs importante.
async function recognizeByPhoto(photoBuffer, { merchantId, ip } = {}) {
  // Anti-rejeu : une photo déjà soumise récemment pour ce marchand est refusée d'emblée, avant de
  // lancer le pipeline (coûteux) — bloque le rejeu trivial d'un fichier capturé/intercepté.
  const photoHash = crypto.createHash('sha256').update(photoBuffer).digest('hex');
  if (merchantId && recentPhotoCache.wasRecentlyUsed(merchantId, photoHash)) {
    throw new ApiError(429, 'Cette photo a déjà été utilisée — présentez à nouveau la paume');
  }

  // Anti brute-force : au-delà de N échecs de reconnaissance récents pour ce marchand, le chemin
  // photo est bloqué temporairement (le repli QR, lui, reste disponible — voir verifyByPalmCode).
  const recentFailures = await countRecentRecognitionFailures(merchantId, env.business.palmLockoutMinutes);
  if (recentFailures >= env.business.palmMaxFailedAttempts) {
    throw new ApiError(
      429,
      `Trop d'échecs de reconnaissance récents. Réessayez dans ${env.business.palmLockoutMinutes} minutes ou utilisez le QR du client.`
    );
  }

  let queryDescriptor;
  try {
    ({ descriptor: queryDescriptor } = await palmVisionService.extractTemplate(photoBuffer));
  } catch (e) {
    // Rejet qualité (photo floue/trop sombre/mal cadrée, ou aucune main détectée) : loggé avec un
    // préfixe distinct de 'reconnaissance photo:' pour NE PAS compter dans le blocage anti
    // brute-force ci-dessus — un marchand dans un lieu mal éclairé ne doit pas se retrouver bloqué
    // à cause de la qualité des photos plutôt que d'un abus réel.
    await logAttempt({ merchantId, userId: null, resultat: 'echec', motif: `qualite photo: ${e.message}`, ip });
    throw e;
  }

  if (merchantId) recentPhotoCache.remember(merchantId, photoHash);

  const rows = await query(
    `SELECT user_id, gabarit_chiffré FROM biometric_palm_templates
     WHERE actif = 1 AND version_algo = :versionAlgo`,
    { versionAlgo: palmVisionService.ALGO_VERSION }
  );

  let bestUserId = null;
  let bestScore = 0;
  let secondBestScore = 0;
  for (const row of rows) {
    let candidateDescriptor;
    try {
      candidateDescriptor = palmVisionService.deserializeTemplate(
        decryptTemplate(row.gabarit_chiffré, env.security.palmTemplateEncKey)
      );
    } catch (e) {
      // Gabarit illisible avec la clé actuelle (le plus souvent : enrôlé avant que
      // PALM_TEMPLATE_ENC_KEY soit fixée dans .env — une clé aléatoire différente était générée à
      // chaque redémarrage). Ignoré plutôt que de faire échouer tout le scan pour les autres
      // candidats, mais signalé ici : sans ce log, un score à 0.000 pour TOUS les candidats est
      // indiscernable d'un vrai "personne ne correspond" — voir logAttempt plus bas.
      console.warn(`[biometrie] gabarit illisible pour user ${row.user_id} (ré-enrôlement requis): ${e.message}`);
      continue;
    }
    const score = palmVisionService.matchScore(queryDescriptor, candidateDescriptor);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestUserId = row.user_id;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  const margin = bestScore - secondBestScore;
  if (!bestUserId || bestScore < env.business.palmCvMinScore || margin < env.business.palmCvMinMargin) {
    await logAttempt({
      merchantId,
      userId: bestUserId,
      resultat: 'echec',
      motif: `reconnaissance photo: score insuffisant ou ambigu (score ${bestScore.toFixed(3)}, marge ${margin.toFixed(3)})`,
      ip,
    });
    throw new ApiError(404, 'Aucun client identifié pour cette présentation de paume — réessayez ou utilisez le QR');
  }

  await logAttempt({
    merchantId,
    userId: bestUserId,
    resultat: 'succes',
    motif: `reconnaissance photo (score ${bestScore.toFixed(3)}, marge ${margin.toFixed(3)})`,
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
