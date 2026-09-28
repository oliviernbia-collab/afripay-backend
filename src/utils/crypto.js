const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function hash(value) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(value, salt);
}

async function compare(value, hashed) {
  if (!hashed) return false;
  return bcrypt.compare(value, hashed);
}

function randomDigits(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += Math.floor(Math.random() * 10);
  return out;
}

function randomReference(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// Identifiant court de présentation (QR code, repli quand la reconnaissance caméra échoue/est
// indisponible) — ne permet en aucun cas de retrouver le gabarit biométrique réel.
function generatePalmCode() {
  return crypto.randomBytes(9).toString('base64url');
}

const TEMPLATE_ENC_ALGO = 'aes-256-gcm';

// Chiffre le gabarit biométrique (paume) au repos avant stockage en base (colonne
// `gabarit_chiffré`) — AES-256-GCM avec une clé serveur (voir env.security.palmTemplateEncKey),
// jamais l'image brute. `key` doit être un Buffer de 32 octets.
function encryptTemplate(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(TEMPLATE_ENC_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptTemplate(payloadBase64, key) {
  const payload = Buffer.from(payloadBase64, 'base64');
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv(TEMPLATE_ENC_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

module.exports = {
  hash,
  compare,
  randomDigits,
  randomReference,
  generatePalmCode,
  encryptTemplate,
  decryptTemplate,
};
