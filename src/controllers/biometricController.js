const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const biometricService = require('../services/biometricService');

// Enrôlement (étape finale du KYC, section 4.1). Ne peut être (re)fait que par le client authentifié.
// Nécessite une vraie photo de la paume (multipart, voir middleware/upload.js uploadPhoto) —
// l'extraction du gabarit se fait localement, voir palmVisionService.js.
async function enroll(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, 'Photo de la paume requise pour l’enrôlement');
    const { palmCode } = await biometricService.enrollPalm(req.auth.id, req.file.buffer);
    ok(res, { palmCode, message: 'Gabarit biométrique généré et enrôlé avec succès' });
  } catch (e) {
    // Rejet qualité (422, voir palmVisionService.extractTemplate) : journalisé pour pouvoir
    // diagnostiquer a posteriori QUELLE porte a été franchie (flou/luminosité/cadrage/aucune main)
    // — contrairement à recognizeByPhoto, l'enrôlement n'écrit rien dans biometric_scan_logs.
    if (e.statusCode === 422) {
      console.warn(`[biometrie] enrôlement rejeté pour user ${req.auth.id}: ${e.message}`);
    }
    next(e);
  }
}

// Régénère le code de présentation à chaque consultation (écran "Payer" de l'app Client) plutôt
// que de renvoyer un code statique — limite la fenêtre de rejeu si le QR affiché est capturé
// par un tiers (voir biometricService.refreshActiveCode).
async function myPalmCode(req, res, next) {
  try {
    const template = await biometricService.refreshActiveCode(req.auth.id);
    if (!template) throw new ApiError(404, "Aucun enrôlement biométrique actif. Complétez le KYC d'abord.");
    ok(res, { palmCode: template.palm_code, expireA: template.expire_a });
  } catch (e) {
    next(e);
  }
}

async function status(req, res, next) {
  try {
    const template = await biometricService.getActiveTemplate(req.auth.id);
    ok(res, { enrolled: !!template });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  enroll,
  myPalmCode,
  status,
};
