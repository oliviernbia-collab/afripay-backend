const express = require('express');
const adminController = require('../controllers/adminController');
const annonceController = require('../controllers/annonceController');
const contactMessageController = require('../controllers/contactMessageController');
const { authenticate, requireType, requireRole, requirePermission } = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');
const { loginLimiter } = require('../middleware/rateLimiters');

const router = express.Router();
const adminOnly = [authenticate, requireType('admin')];
// Garde-fou en dur réservé à la page qui édite elle-même les permissions des rôles — ne doit
// jamais devenir une permission configurable (sinon un rôle pourrait s'auto-accorder des droits).
const superAdminOnly = [authenticate, requireType('admin'), requireRole('super_admin')];
const permissionGuard = (code) => [authenticate, requireType('admin'), requirePermission(code)];

router.post('/login', loginLimiter, adminController.login);
// Pas de middleware d'auth ici : le refreshToken voyage dans le cookie httpOnly, pas dans un
// header Authorization (un accessToken déjà expiré ne pourrait de toute façon plus servir ici).
router.post('/refresh', loginLimiter, adminController.refreshSession);
router.post('/logout', adminController.logout);
router.get('/me', ...adminOnly, adminController.me);
router.patch('/me', ...adminOnly, adminController.updateMyProfile);
router.post('/me/mot-de-passe', ...adminOnly, adminController.changeMyPassword);
router.get('/me/activite', ...adminOnly, adminController.myActivity);
router.post('/me/photo', ...adminOnly, uploadPhoto.single('photo'), adminController.uploadMyPhoto);
router.delete('/me/photo', ...adminOnly, adminController.removeMyPhoto);
router.get('/dashboard', ...adminOnly, adminController.dashboard);

router.get('/utilisateurs', ...adminOnly, adminController.listUsers);
router.get('/utilisateurs/:id', ...adminOnly, adminController.getUser);
router.post('/utilisateurs/:id/kyc', ...permissionGuard('kyc.decider'), adminController.reviewUserKyc);
// Gel de compte (signalement perte/vol) : bloquer est ouvert à tout admin actif pour que
// l'urgence ne dépende pas de la disponibilité de la permission "comptes.debloquer" ; débloquer
// (redonne l'accès) reste soumis à cette permission, comme les décisions KYC/KYB.
router.post('/utilisateurs/:id/bloquer', ...adminOnly, adminController.blockUser);
router.post('/utilisateurs/:id/debloquer', ...permissionGuard('comptes.debloquer'), adminController.unblockUser);

router.get('/marchands', ...adminOnly, adminController.listMerchants);
router.get('/marchands/:id', ...adminOnly, adminController.getMerchant);
router.post('/marchands/:id/kyb', ...permissionGuard('kyb.decider'), adminController.reviewMerchantKyb);
router.post('/marchands/:id/bloquer', ...adminOnly, adminController.blockMerchant);
router.post('/marchands/:id/debloquer', ...permissionGuard('comptes.debloquer'), adminController.unblockMerchant);

router.get('/transactions', ...adminOnly, adminController.listTransactions);

router.get('/kyc/documents', ...adminOnly, adminController.listKycDocuments);
router.get('/kyb/documents', ...adminOnly, adminController.listKybDocuments);

router.get('/wallets', ...adminOnly, adminController.listWallets);
router.get('/recharges', ...adminOnly, adminController.listRecharges);

router.get('/biometrie', ...adminOnly, adminController.biometrieOverview);
router.get('/fraude', ...permissionGuard('fraude.voir'), adminController.fraudeOverview);

router.get('/notifications', ...adminOnly, adminController.listNotifications);
router.post('/notifications', ...adminOnly, adminController.sendNotification);
router.post('/annonces/arreter', ...adminOnly, annonceController.stop);

router.get('/messages', ...adminOnly, contactMessageController.list);
router.post('/messages/:id/repondre', ...adminOnly, contactMessageController.reply);

router.get('/internes', ...permissionGuard('internes.gerer'), adminController.listInternalUsers);
router.post('/internes', ...permissionGuard('internes.gerer'), adminController.createInternalUser);
router.patch('/internes/:id', ...permissionGuard('internes.gerer'), adminController.updateInternalUser);

router.get('/audit-logs', ...permissionGuard('audit.voir'), adminController.listAuditLogs);

// Matrice des permissions par rôle : réservée en dur à super_admin (voir commentaire plus haut).
router.get('/permissions', ...superAdminOnly, adminController.listPermissionsMatrix);
router.put('/permissions', ...superAdminOnly, adminController.updateRolePermissions);

module.exports = router;
