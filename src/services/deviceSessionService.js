const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { query } = require('../config/db');

// "Gestion des appareils connectés et déconnexion à distance" (cahier des charges 5.6).
// Chaque login crée une ligne devices_sessions dont token_session stocke un hash (SHA-256,
// déterministe — pas bcrypt, qui n'est pas adapté à une recherche exacte) du refresh token
// courant. Rafraîchir un token fait tourner ce hash (rotation) ; révoquer une session met
// actif=0, ce qui invalide la lignée de refresh token au prochain /auth/refresh — c'est ce qui
// rend la "déconnexion à distance" réelle plutôt que cosmétique.

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function ownerColumn(ownerType) {
  return ownerType === 'marchand' ? 'merchant_id' : 'user_id';
}

async function createSession({ ownerType, ownerId, appareil, os, refreshToken }) {
  const id = uuidv4();
  await query(
    `INSERT INTO devices_sessions (id, user_id, merchant_id, appareil, os, token_session, actif)
     VALUES (:id, :userId, :merchantId, :appareil, :os, :tokenHash, 1)`,
    {
      id,
      userId: ownerType === 'client' ? ownerId : null,
      merchantId: ownerType === 'marchand' ? ownerId : null,
      appareil: appareil || null,
      os: os || null,
      tokenHash: hashToken(refreshToken),
    }
  );
  return id;
}

// Fait tourner le hash de session au refresh et distingue trois cas :
// - hash connu + actif=1 -> rotation normale, refresh accepté.
// - hash connu + actif=0 -> session explicitement révoquée ("déconnexion à distance"),
//   refresh rejeté : c'est ce qui rend la révocation réelle.
// - hash inconnu :
//     - aucune session n'existe pour ce compte -> token émis avant l'introduction de ce
//       suivi ; on ne rejette pas un utilisateur déjà connecté pour une lacune d'historique,
//       on crée une session à la volée (self-heal) et le refresh est accepté.
//     - au moins une session existe déjà pour ce compte -> ce token ne correspond à aucune
//       lignée connue (réutilisation d'un refresh token déjà remplacé par une rotation
//       précédente, ou token révoqué) : on rejette plutôt que de risquer d'ignorer un vol de
//       token — ce sont les cas où une vraie protection anti-réutilisation compte le plus.
async function rotateSession({ ownerType, ownerId, appareil, os, oldRefreshToken, newRefreshToken }) {
  const col = ownerColumn(ownerType);
  const oldHash = hashToken(oldRefreshToken);
  const rows = await query(
    `SELECT id, actif FROM devices_sessions WHERE ${col} = :ownerId AND token_session = :oldHash LIMIT 1`,
    { ownerId, oldHash }
  );
  const match = rows[0];

  if (match && !match.actif) return false; // révoquée -> refresh rejeté

  if (match) {
    await query('UPDATE devices_sessions SET token_session = :newHash, date_connexion = NOW() WHERE id = :id', {
      id: match.id,
      newHash: hashToken(newRefreshToken),
    });
    return true;
  }

  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM devices_sessions WHERE ${col} = :ownerId`, { ownerId });
  if (Number(total) > 0) return false; // lignée inconnue alors que des sessions existent -> suspect

  await createSession({ ownerType, ownerId, appareil, os, refreshToken: newRefreshToken });
  return true;
}

async function listSessions(ownerType, ownerId) {
  const col = ownerColumn(ownerType);
  return query(
    `SELECT id, appareil, os, date_connexion FROM devices_sessions
     WHERE ${col} = :ownerId AND actif = 1 ORDER BY date_connexion DESC`,
    { ownerId }
  );
}

async function revokeSession(ownerType, ownerId, sessionId) {
  const col = ownerColumn(ownerType);
  await query(`UPDATE devices_sessions SET actif = 0 WHERE id = :sessionId AND ${col} = :ownerId`, {
    sessionId,
    ownerId,
  });
}

module.exports = { createSession, rotateSession, listSessions, revokeSession };
