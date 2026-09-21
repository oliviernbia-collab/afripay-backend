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

// Génère un gabarit biométrique chiffré factice (mock) à partir d'un secret serveur.
// Ne stocke jamais d'image brute : uniquement un hash non réversible + un palm_code
// public court qui sert d'identifiant de présentation (cf. README biométrie).
function generatePalmTemplate(userId) {
  const raw = `${userId}-${crypto.randomBytes(16).toString('hex')}`;
  const gabarit = crypto.createHash('sha256').update(raw).digest('hex');
  const palmCode = crypto.randomBytes(9).toString('base64url'); // identifiant court, unique, non réversible vers l'image
  return { gabarit, palmCode };
}

module.exports = { hash, compare, randomDigits, randomReference, generatePalmTemplate };
