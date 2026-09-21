const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { hash, compare, randomDigits } = require('../utils/crypto');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Mock SMS : le code est loggé côté serveur (et renvoyé dans la réponse si OTP_DEV_ECHO=true).
// À remplacer par un vrai fournisseur SMS (Twilio, Orange SMS API, etc.) en production.
async function generateOtp(telephone, objet) {
  const code = randomDigits(6);
  const codeHash = await hash(code);
  const id = uuidv4();
  const expireA = new Date(Date.now() + env.otp.expiresMin * 60 * 1000);

  await query(
    `INSERT INTO otp_codes (id, telephone, code_hash, objet, expire_a) VALUES (:id, :telephone, :codeHash, :objet, :expireA)`,
    { id, telephone, codeHash, objet, expireA: expireA.toISOString().slice(0, 19).replace('T', ' ') }
  );

  console.log(`[OTP][mock-sms] ${telephone} -> ${code} (objet: ${objet}, expire dans ${env.otp.expiresMin} min)`);

  return { sent: true, devCode: env.otp.devEcho ? code : undefined };
}

async function verifyOtp(telephone, code, objet) {
  const rows = await query(
    `SELECT * FROM otp_codes WHERE telephone = :telephone AND objet = :objet AND utilisé = 0
     ORDER BY date_creation DESC LIMIT 1`,
    { telephone, objet }
  );
  const record = rows[0];
  if (!record) throw new ApiError(400, 'Aucun code OTP en attente pour ce numéro');
  if (new Date(record.expire_a).getTime() < Date.now()) throw new ApiError(400, 'Code OTP expiré');

  const isValid = await compare(code, record.code_hash);
  if (!isValid) throw new ApiError(400, 'Code OTP invalide');

  await query('UPDATE otp_codes SET utilisé = 1 WHERE id = :id', { id: record.id });
  return true;
}

module.exports = { generateOtp, verifyOtp };
