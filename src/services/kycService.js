const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const env = require('../config/env');

async function addDocument({ userId, merchantId, typeDocument, fichierRef }) {
  const id = uuidv4();
  await query(
    `INSERT INTO kyc_documents (id, user_id, merchant_id, type_document, fichier_ref, statut)
     VALUES (:id, :userId, :merchantId, :typeDocument, :fichierRef, 'en_attente')`,
    { id, userId: userId || null, merchantId: merchantId || null, typeDocument, fichierRef }
  );
  return id;
}

async function listDocumentsForUser(userId) {
  return query('SELECT * FROM kyc_documents WHERE user_id = :userId ORDER BY date_soumission DESC', { userId });
}

async function listDocumentsForMerchant(merchantId) {
  return query('SELECT * FROM kyc_documents WHERE merchant_id = :merchantId ORDER BY date_soumission DESC', {
    merchantId,
  });
}

async function setDocumentStatus(docId, statut, motifRejet) {
  await query('UPDATE kyc_documents SET statut = :statut, motif_rejet = :motifRejet WHERE id = :docId', {
    docId,
    statut,
    motifRejet: motifRejet || null,
  });
}

// Somme des recharges réussies d'un client non-KYC, pour appliquer le plafond de 10 000 FCFA (section 5.3/7.2).
async function getCumulativeRechargeAmount(userId) {
  const rows = await query(
    `SELECT COALESCE(SUM(montant), 0) AS total FROM recharge_providers
     WHERE user_id = :userId AND statut = 'réussi'`,
    { userId }
  );
  return Number(rows[0].total);
}

async function assertRechargeAllowed(user, montant) {
  if (user.statut_kyc === 'validé') return;
  const cumulative = await getCumulativeRechargeAmount(user.id);
  const cap = env.business.kycRechargeCapFcfa;
  if (cumulative + Number(montant) > cap) {
    const ApiError = require('../utils/ApiError');
    throw new ApiError(
      403,
      `Plafond de recharge de ${cap} FCFA atteint tant que le KYC n'est pas validé (déjà rechargé : ${cumulative} FCFA)`
    );
  }
}

module.exports = {
  addDocument,
  listDocumentsForUser,
  listDocumentsForMerchant,
  setDocumentStatus,
  getCumulativeRechargeAmount,
  assertRechargeAllowed,
};
