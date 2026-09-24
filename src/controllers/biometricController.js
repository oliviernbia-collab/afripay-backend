const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const userService = require('../services/userService');
const biometricService = require('../services/biometricService');
const palmBiometricService = require('../services/palmBiometricService');

// Enrôlement (étape finale du KYC, section 4.1). Ne peut être (re)fait que par le client authentifié.
async function enroll(req, res, next) {
  try {
    const { palmCode } = await biometricService.enrollPalm(req.auth.id);
    ok(res, { palmCode, message: 'Gabarit biométrique généré et enrôlé avec succès' });
  } catch (e) {
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

// Real palm biometric enrolment (Tencent PalmAI) — inert 503 until env.tencentPalm.enabled is
// true (see palmBiometricService.js). The mobile app falls back to the QR-code mock (`enroll`
// above) when this errors out or the feature flag on its side is off.
async function tencentEnrollSession(req, res, next) {
  try {
    const user = await userService.findById(req.auth.id);
    const session = await palmBiometricService.getEnrollmentSession(user);
    ok(res, session);
  } catch (e) {
    next(e);
  }
}

// Called by the mobile app right after the Tencent Palm widget reports a successful
// 'registration' result — see PalmBiometricWebView's onResult handler in KycEnrollScreen.js.
async function tencentConfirmEnrollment(req, res, next) {
  try {
    await palmBiometricService.confirmEnrollment(req.auth.id);
    ok(res, { enrolled: true });
  } catch (e) {
    next(e);
  }
}

module.exports = { enroll, myPalmCode, status, tencentEnrollSession, tencentConfirmEnrollment };
