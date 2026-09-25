const crypto = require('crypto');
const env = require('../config/env');

// Signe les URLs relatives /uploads/<file> (anciens fichiers antérieurs à la migration Cloudinary,
// voir app.js) avec un jeton à expiration courte, plutôt que de les laisser servies publiquement
// sans aucune vérification. Basé sur une URL signée (et non un header Authorization) pour rester
// compatible avec un usage direct en <img src>/<a href> côté web et mobile, qui ne peuvent pas
// attacher un Bearer token à une simple URL.
const DEFAULT_TTL_SECONDS = 5 * 60;

function signature(relativePath, exp) {
  return crypto.createHmac('sha256', env.jwt.accessSecret).update(`${relativePath}:${exp}`).digest('hex');
}

function sign(relativePath, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signature(relativePath, exp);
  const separator = relativePath.includes('?') ? '&' : '?';
  return `${relativePath}${separator}exp=${exp}&sig=${sig}`;
}

function verify(relativePath, exp, sig) {
  if (!exp || !sig) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = signature(relativePath, exp);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const givenBuf = Buffer.from(String(sig), 'utf8');
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

// Ne signe que les chemins locaux hérités (/uploads/...) — les URLs Cloudinary (ou une valeur
// vide) sont renvoyées telles quelles.
function signIfLocalUpload(value, ttlSeconds) {
  if (!value || typeof value !== 'string' || !value.startsWith('/uploads/')) return value;
  return sign(value, ttlSeconds);
}

module.exports = { sign, verify, signIfLocalUpload };
