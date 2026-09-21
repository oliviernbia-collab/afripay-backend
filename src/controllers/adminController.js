const fs = require('fs');
const path = require('path');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const { compare } = require('../utils/crypto');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const { v4: uuidv4 } = require('uuid');
const adminService = require('../services/adminService');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const kycService = require('../services/kycService');
const notificationService = require('../services/notificationService');
const auditService = require('../services/auditService');
const { hash } = require('../utils/crypto');
const { uploadDir } = require('../middleware/upload');

// Supprime un ancien fichier d'upload (best-effort, ne doit jamais faire échouer l'action
// principale) quand la photo de profil est remplacée ou retirée.
function deleteUploadedFile(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('/uploads/')) return;
  const filePath = path.join(uploadDir, photoUrl.replace('/uploads/', ''));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') console.error('[profil] échec suppression ancienne photo:', err.message);
  });
}

async function login(req, res, next) {
  try {
    const { email, motDePasse } = req.body;
    const admin = await adminService.findByEmail(email);
    if (!admin) throw new ApiError(401, 'Identifiants invalides');
    const valid = await compare(motDePasse, admin.mot_de_passe_hash);
    if (!valid) throw new ApiError(401, 'Identifiants invalides');

    const accessToken = signAccessToken({ id: admin.id, type: 'admin', role: admin.role, nom: admin.nom });
    const refreshToken = signRefreshToken({ id: admin.id, type: 'admin', role: admin.role, nom: admin.nom });
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

// ---------------------------------------------------------------------
// Profil admin (auto-service — n'importe quel compte admin sur lui-même)
// ---------------------------------------------------------------------
async function updateMyProfile(req, res, next) {
  try {
    const { nom, email } = req.body;
    if (nom !== undefined && !nom.trim()) throw new ApiError(400, 'Le nom ne peut pas être vide');
    if (email !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Email invalide');
      const existing = await adminService.findByEmailAny(email);
      if (existing && existing.id !== req.auth.id) throw new ApiError(409, 'Cet email est déjà utilisé par un autre compte');
    }

    const updated = await adminService.updateOwnProfile(req.auth.id, { nom, email });

    await auditService.log({
      adminId: req.auth.id,
      adminNom: nom || req.auth.nom,
      action: 'admin.profil.maj',
      cibleType: 'admin',
      cibleId: req.auth.id,
      détails: { nom: nom ?? undefined, email: email ?? undefined },
    });

    const { mot_de_passe_hash, ...publicAdmin } = updated;
    ok(res, publicAdmin);
  } catch (e) {
    next(e);
  }
}

async function changeMyPassword(req, res, next) {
  try {
    const { motDePasseActuel, nouveauMotDePasse } = req.body;
    if (!motDePasseActuel || !nouveauMotDePasse) {
      throw new ApiError(400, 'motDePasseActuel et nouveauMotDePasse sont requis');
    }
    if (nouveauMotDePasse.length < 6) throw new ApiError(400, 'Le nouveau mot de passe doit contenir au moins 6 caractères');

    const admin = await adminService.findById(req.auth.id);
    if (!admin) throw new ApiError(404, 'Administrateur introuvable');

    const valid = await compare(motDePasseActuel, admin.mot_de_passe_hash);
    if (!valid) throw new ApiError(401, 'Mot de passe actuel incorrect');

    const motDePasseHash = await hash(nouveauMotDePasse);
    await adminService.setPassword(req.auth.id, motDePasseHash);

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'admin.mot_de_passe.maj',
      cibleType: 'admin',
      cibleId: req.auth.id,
    });

    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

async function myActivity(req, res, next) {
  try {
    const { limit } = req.query;
    ok(res, await auditService.list({ adminId: req.auth.id, limit: Number(limit) || 20, offset: 0 }));
  } catch (e) {
    next(e);
  }
}

async function uploadMyPhoto(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, 'Fichier requis (champ "photo")');

    const admin = await adminService.findById(req.auth.id);
    const photoUrl = `/uploads/${req.file.filename}`;
    const updated = await adminService.setPhoto(req.auth.id, photoUrl);

    deleteUploadedFile(admin?.photo_url);

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'admin.profil.maj',
      cibleType: 'admin',
      cibleId: req.auth.id,
      détails: { photo: true },
    });

    const { mot_de_passe_hash, ...publicAdmin } = updated;
    ok(res, publicAdmin);
  } catch (e) {
    next(e);
  }
}

async function removeMyPhoto(req, res, next) {
  try {
    const admin = await adminService.findById(req.auth.id);
    const updated = await adminService.setPhoto(req.auth.id, null);
    deleteUploadedFile(admin?.photo_url);

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'admin.profil.maj',
      cibleType: 'admin',
      cibleId: req.auth.id,
      détails: { photo: false },
    });

    const { mot_de_passe_hash, ...publicAdmin } = updated;
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
    const { statutKyc, search, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await adminService.listUsers({
        statutKyc,
        search,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
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

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'kyc.decision',
      cibleType: 'user',
      cibleId: user.id,
      détails: { decision, motif: motif || null, telephone: user.telephone },
    });

    ok(res, { updated: true, statutKyc: decision });
  } catch (e) {
    next(e);
  }
}

async function listMerchants(req, res, next) {
  try {
    const { statutKyb, search, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await adminService.listMerchants({
        statutKyb,
        search,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
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

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'kyb.decision',
      cibleType: 'merchant',
      cibleId: merchant.id,
      détails: { decision, motif: motif || null, telephone: merchant.telephone },
    });

    ok(res, { updated: true, statutKyb: decision });
  } catch (e) {
    next(e);
  }
}

async function listTransactions(req, res, next) {
  try {
    const { type, statut, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await adminService.listTransactions({
        type,
        statut,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------
// KYC / KYB — files d'attente documentaires
// ---------------------------------------------------------------------
async function listKycDocuments(req, res, next) {
  try {
    const { statut, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await adminService.listKycDocuments({
        statut,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
  } catch (e) {
    next(e);
  }
}

async function listKybDocuments(req, res, next) {
  try {
    const { statut, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await adminService.listKybDocuments({
        statut,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------
async function listWallets(req, res, next) {
  try {
    const { type, search, dateDebut, dateFin, limit, offset } = req.query;
    const [items, totals] = await Promise.all([
      adminService.listWallets({
        type,
        search,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      }),
      adminService.walletsTotals(),
    ]);
    ok(res, { items, totals });
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------
// Recharges
// ---------------------------------------------------------------------
async function listRecharges(req, res, next) {
  try {
    const { fournisseur, statut, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await adminService.listRecharges({
        fournisseur,
        statut,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------
// Biométrie
// ---------------------------------------------------------------------
async function biometrieOverview(req, res, next) {
  try {
    const { search, resultat, dateDebut, dateFin, limit, offset } = req.query;
    const [stats, enrolments, logs] = await Promise.all([
      adminService.biometricStats(),
      adminService.listBiometricEnrolments({ search, limit: 20, offset: 0 }),
      adminService.listBiometricLogs({
        resultat,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      }),
    ]);
    ok(res, { stats, enrolments, logs });
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------
// Fraude
// ---------------------------------------------------------------------
async function fraudeOverview(req, res, next) {
  try {
    ok(res, await adminService.fraudSignals());
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------
// Notifications (vue admin)
// ---------------------------------------------------------------------
async function listNotifications(req, res, next) {
  try {
    const { type, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await adminService.listAllNotifications({
        type,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
  } catch (e) {
    next(e);
  }
}

async function sendNotification(req, res, next) {
  try {
    const { destinataireId, typeDestinataire, type, titre, contenu } = req.body;
    if (!destinataireId || !['client', 'marchand'].includes(typeDestinataire) || !titre || !contenu) {
      throw new ApiError(400, 'destinataireId, typeDestinataire (client|marchand), titre et contenu sont requis');
    }
    const notifType = ['transaction', 'sécurité', 'système'].includes(type) ? type : 'système';

    const destinataire =
      typeDestinataire === 'client'
        ? await userService.findById(destinataireId)
        : await merchantService.findById(destinataireId);
    if (!destinataire) throw new ApiError(404, 'Destinataire introuvable');

    const id = await notificationService.notify({ destinataireId, typeDestinataire, type: notifType, titre, contenu });

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'notification.envoi',
      cibleType: typeDestinataire,
      cibleId: destinataireId,
      détails: { titre, type: notifType },
    });

    ok(res, { id, envoyé: true });
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------
// Utilisateurs internes (comptes admin) — réservé au rôle super_admin
// ---------------------------------------------------------------------
async function listInternalUsers(req, res, next) {
  try {
    ok(res, await adminService.listAdmins());
  } catch (e) {
    next(e);
  }
}

async function createInternalUser(req, res, next) {
  try {
    const { nom, email, motDePasse, role } = req.body;
    if (!nom || !email || !motDePasse) throw new ApiError(400, 'nom, email et motDePasse sont requis');
    const validRole = ['super_admin', 'conformite', 'support'].includes(role) ? role : 'support';

    const existing = await adminService.findByEmail(email);
    if (existing) throw new ApiError(409, 'Un compte admin existe déjà avec cet email');

    const motDePasseHash = await hash(motDePasse);
    const id = uuidv4();
    const created = await adminService.createAdmin({ id, nom, email, motDePasseHash, role: validRole });

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'admin.creation',
      cibleType: 'admin',
      cibleId: id,
      détails: { email, role: validRole },
    });

    const { mot_de_passe_hash, ...publicAdmin } = created;
    ok(res, publicAdmin);
  } catch (e) {
    next(e);
  }
}

async function updateInternalUser(req, res, next) {
  try {
    const target = await adminService.findById(req.params.id);
    if (!target) throw new ApiError(404, 'Compte admin introuvable');

    const { role, actif } = req.body;
    if (role && !['super_admin', 'conformite', 'support'].includes(role)) throw new ApiError(400, 'role invalide');

    // Empêche de désactiver ou rétrograder le dernier super_admin actif restant.
    if ((actif === false || (role && role !== 'super_admin')) && target.role === 'super_admin' && target.actif) {
      const others = await adminService.countActiveSuperAdmins(target.id);
      if (others === 0) {
        throw new ApiError(400, 'Impossible de retirer les droits du dernier super administrateur actif');
      }
    }

    const updated = await adminService.updateAdmin(req.params.id, { role, actif });

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'admin.maj',
      cibleType: 'admin',
      cibleId: req.params.id,
      détails: { role: role ?? undefined, actif: actif ?? undefined },
    });

    const { mot_de_passe_hash, ...publicAdmin } = updated;
    ok(res, publicAdmin);
  } catch (e) {
    next(e);
  }
}

// ---------------------------------------------------------------------
// Audit Logs — réservé aux rôles super_admin / conformite
// ---------------------------------------------------------------------
async function listAuditLogs(req, res, next) {
  try {
    const { action, adminId, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await auditService.list({
        action,
        adminId,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
  } catch (e) {
    next(e);
  }
}

module.exports = {
  login,
  me,
  updateMyProfile,
  changeMyPassword,
  myActivity,
  uploadMyPhoto,
  removeMyPhoto,
  dashboard,
  listUsers,
  getUser,
  reviewUserKyc,
  listMerchants,
  getMerchant,
  reviewMerchantKyb,
  listTransactions,
  listKycDocuments,
  listKybDocuments,
  listWallets,
  listRecharges,
  biometrieOverview,
  fraudeOverview,
  listNotifications,
  sendNotification,
  listInternalUsers,
  createInternalUser,
  updateInternalUser,
  listAuditLogs,
};
