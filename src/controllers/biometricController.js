const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const userService = require('../services/userService');
const biometricService = require('../services/biometricService');

// Enrôlement (étape finale du KYC, section 4.1). Ne peut être (re)fait que par le client authentifié.
async function enroll(req, res, next) {
  try {
    const { palmCode } = await biometricService.enrollPalm(req.auth.id);
    ok(res, { palmCode, message: 'Gabarit biométrique généré et enrôlé avec succès' });
  } catch (e) {
    next(e);
  }
}

async function myPalmCode(req, res, next) {
  try {
    const template = await biometricService.getActiveTemplate(req.auth.id);
    if (!template) throw new ApiError(404, "Aucun enrôlement biométrique actif. Complétez le KYC d'abord.");
    ok(res, { palmCode: template.palm_code });
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

module.exports = { enroll, myPalmCode, status };
