const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const { compare } = require('../utils/crypto');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const adminService = require('../services/adminService');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const kycService = require('../services/kycService');
const notificationService = require('../services/notificationService');

async function login(req, res, next) {
  try {
    const { email, motDePasse } = req.body;
    const admin = await adminService.findByEmail(email);
    if (!admin) throw new ApiError(401, 'Identifiants invalides');
    const valid = await compare(motDePasse, admin.mot_de_passe_hash);
    if (!valid) throw new ApiError(401, 'Identifiants invalides');

    const accessToken = signAccessToken({ id: admin.id, type: 'admin', role: admin.role });
    const refreshToken = signRefreshToken({ id: admin.id, type: 'admin', role: admin.role });
    const { mot_de_passe_hash, ...publicAdmin } = admin;
    ok(res, { admin: publicAdmin, accessToken, refreshToken });
  } catch (e) {
    next(e);
  }
}

async function me(req, res, next) {
  try {
    const admin = await adminService.findById(req.auth.id);
    if (!admin) throw new ApiError(404, 'Administrateur introuvable');
    const { mot_de_passe_hash, ...publicAdmin } = admin;
    ok(res, publicAdmin);
  } catch (e) {
    next(e);
  }
}

async function dashboard(req, res, next) {
  try {
    ok(res, await adminService.dashboardStats());
  } catch (e) {
    next(e);
  }
}

async function listUsers(req, res, next) {
  try {
    const { statutKyc, search, limit, offset } = req.query;
    ok(res, await adminService.listUsers({ statutKyc, search, limit: Number(limit) || 50, offset: Number(offset) || 0 }));
  } catch (e) {
    next(e);
  }
}

async function getUser(req, res, next) {
  try {
    const user = await userService.findById(req.params.id);
    if (!user) throw new ApiError(404, 'Utilisateur introuvable');
    const documents = await kycService.listDocumentsForUser(user.id);
    ok(res, { user: userService.toPublic(user), documents });
  } catch (e) {
    next(e);
  }
}

async function reviewUserKyc(req, res, next) {
  try {
    const { decision, motif } = req.body; // decision: 'validé' | 'rejeté' | 'suspendu'
    if (!['validé', 'rejeté', 'suspendu'].includes(decision)) throw new ApiError(400, 'decision invalide');

    const user = await userService.findById(req.params.id);
    if (!user) throw new ApiError(404, 'Utilisateur introuvable');

    await userService.updateKycStatus(user.id, decision);
    const docs = await kycService.listDocumentsForUser(user.id);
    await Promise.all(
      docs
        .filter((d) => d.statut === 'en_attente')
        .map((d) => kycService.setDocumentStatus(d.id, decision === 'validé' ? 'validé' : 'rejeté', motif))
    );

    await notificationService.notify({
      destinataireId: user.id,
      typeDestinataire: 'client',
      type: 'sécurité',
      titre: 'Mise à jour de votre dossier KYC',
      contenu:
        decision === 'validé'
          ? 'Votre dossier KYC a été validé. Le paiement par paume de main est activé.'
          : `Votre dossier KYC a été ${decision}. ${motif || ''}`.trim(),
    });

    ok(res, { updated: true, statutKyc: decision });
  } catch (e) {
    next(e);
  }
}

async function listMerchants(req, res, next) {
  try {
    const { statutKyb, search, limit, offset } = req.query;
    ok(
      res,
      await adminService.listMerchants({ statutKyb, search, limit: Number(limit) || 50, offset: Number(offset) || 0 })
    );
  } catch (e) {
    next(e);
  }
}

async function getMerchant(req, res, next) {
  try {
    const merchant = await merchantService.findById(req.params.id);
    if (!merchant) throw new ApiError(404, 'Marchand introuvable');
    const documents = await kycService.listDocumentsForMerchant(merchant.id);
    ok(res, { merchant: merchantService.toPublic(merchant), documents });
  } catch (e) {
    next(e);
  }
}

async function reviewMerchantKyb(req, res, next) {
  try {
    const { decision, motif } = req.body;
    if (!['validé', 'rejeté', 'suspendu'].includes(decision)) throw new ApiError(400, 'decision invalide');

    const merchant = await merchantService.findById(req.params.id);
    if (!merchant) throw new ApiError(404, 'Marchand introuvable');

    await merchantService.updateKybStatus(merchant.id, decision);
    const docs = await kycService.listDocumentsForMerchant(merchant.id);
    await Promise.all(
      docs
        .filter((d) => d.statut === 'en_attente')
        .map((d) => kycService.setDocumentStatus(d.id, decision === 'validé' ? 'validé' : 'rejeté', motif))
    );

    await notificationService.notify({
      destinataireId: merchant.id,
      typeDestinataire: 'marchand',
      type: 'sécurité',
      titre: 'Mise à jour de votre dossier KYB',
      contenu:
        decision === 'validé'
          ? "Votre dossier a été validé. L'encaissement par paume de main est activé."
          : `Votre dossier a été ${decision}. ${motif || ''}`.trim(),
    });

    ok(res, { updated: true, statutKyb: decision });
  } catch (e) {
    next(e);
  }
}

async function listTransactions(req, res, next) {
  try {
    const { type, statut, limit, offset } = req.query;
    ok(res, await adminService.listTransactions({ type, statut, limit: Number(limit) || 50, offset: Number(offset) || 0 }));
  } catch (e) {
    next(e);
  }
}

module.exports = {
  login,
  me,
  dashboard,
  listUsers,
  getUser,
  reviewUserKyc,
  listMerchants,
  getMerchant,
  reviewMerchantKyb,
  listTransactions,
};
