const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const kycService = require('../services/kycService');
const notificationService = require('../services/notificationService');
const securityEventService = require('../services/securityEventService');
const { uploadBuffer, destroyByUrl } = require('../config/cloudinary');

const CLIENT_DOC_TYPES = ['cni', 'passeport', 'carte_sejour', 'selfie'];
const MERCHANT_DOC_TYPES = ['cni', 'passeport', 'carte_sejour', 'selfie', 'rccm', 'ncc', 'justificatif_domicile', 'justificatif_activite'];

function deleteUploadedFile(photoUrl) {
  destroyByUrl(photoUrl, { resourceType: 'image' });
}

async function uploadClientDocument(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, 'Fichier requis (champ "document")');
    const { typeDocument } = req.body;
    if (!CLIENT_DOC_TYPES.includes(typeDocument)) throw new ApiError(400, `typeDocument invalide. Valeurs: ${CLIENT_DOC_TYPES.join(', ')}`);

    const result = await uploadBuffer(req.file.buffer, { folder: 'afripay/kyc/clients' });
    const fichierRef = result.secure_url;
    const docId = await kycService.addDocument({ userId: req.auth.id, typeDocument, fichierRef });

    await userService.updateKycStatus(req.auth.id, 'en_attente');
    ok(res, { id: docId, fichierRef });
  } catch (e) {
    next(e);
  }
}

async function uploadMerchantDocument(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, 'Fichier requis (champ "document")');
    const { typeDocument } = req.body;
    if (!MERCHANT_DOC_TYPES.includes(typeDocument)) throw new ApiError(400, `typeDocument invalide. Valeurs: ${MERCHANT_DOC_TYPES.join(', ')}`);

    const result = await uploadBuffer(req.file.buffer, { folder: 'afripay/kyc/marchands' });
    const fichierRef = result.secure_url;
    const docId = await kycService.addDocument({ merchantId: req.auth.id, typeDocument, fichierRef });

    await merchantService.updateKybStatus(req.auth.id, 'en_attente');
    ok(res, { id: docId, fichierRef });
  } catch (e) {
    next(e);
  }
}

async function myClientDocuments(req, res, next) {
  try {
    const docs = await kycService.listDocumentsForUser(req.auth.id);
    ok(res, docs);
  } catch (e) {
    next(e);
  }
}

async function myMerchantDocuments(req, res, next) {
  try {
    const docs = await kycService.listDocumentsForMerchant(req.auth.id);
    ok(res, docs);
  } catch (e) {
    next(e);
  }
}

async function submitPersonalInfo(req, res, next) {
  try {
    const { nom, prenom, dateNaissance, adresse } = req.body;
    const updated = await userService.updateProfile(req.auth.id, {
      nom,
      prenom,
      date_naissance: dateNaissance,
      adresse,
    });
    await securityEventService.log({
      acteurType: 'client',
      acteurId: req.auth.id,
      telephone: updated.telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'informations_personnelles',
      ip: req.ip,
    });
    ok(res, userService.toPublic(updated));
  } catch (e) {
    next(e);
  }
}

// Photo de profil client (cahier des charges 5.6 "Gestion du profil (nom, téléphone, e-mail,
// photo)") — même schéma que la photo de profil admin.
async function uploadMyPhoto(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, 'Fichier requis (champ "photo")');

    const user = await userService.findById(req.auth.id);
    const result = await uploadBuffer(req.file.buffer, { folder: 'afripay/avatars', resourceType: 'image' });
    const photoUrl = result.secure_url;
    const updated = await userService.updateProfile(req.auth.id, { photo_url: photoUrl });

    deleteUploadedFile(user?.photo_url);

    await securityEventService.log({
      acteurType: 'client',
      acteurId: req.auth.id,
      telephone: updated.telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'photo',
      ip: req.ip,
    });

    ok(res, userService.toPublic(updated));
  } catch (e) {
    next(e);
  }
}

async function removeMyPhoto(req, res, next) {
  try {
    const user = await userService.findById(req.auth.id);
    const updated = await userService.updateProfile(req.auth.id, { photo_url: null });
    deleteUploadedFile(user?.photo_url);

    await securityEventService.log({
      acteurType: 'client',
      acteurId: req.auth.id,
      telephone: updated.telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'photo_supprimée',
      ip: req.ip,
    });

    ok(res, userService.toPublic(updated));
  } catch (e) {
    next(e);
  }
}

async function myKycStatus(req, res, next) {
  try {
    const user = await userService.findById(req.auth.id);
    const cumulative = await kycService.getCumulativeRechargeAmount(req.auth.id);
    ok(res, { statutKyc: user.statut_kyc, rechargeCumulee: cumulative });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  uploadClientDocument,
  uploadMerchantDocument,
  myClientDocuments,
  myMerchantDocuments,
  submitPersonalInfo,
  uploadMyPhoto,
  removeMyPhoto,
  myKycStatus,
};
