const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticate, requireType, requireRole } = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');

const router = express.Router();
const adminOnly = [authenticate, requireType('admin')];
// Sections sensibles : gestion des comptes internes + journal d'audit.
const superAdminOnly = [authenticate, requireType('admin'), requireRole('super_admin')];
const auditReaders = [authenticate, requireType('admin'), requireRole('super_admin', 'conformite')];

router.post('/login', adminController.login);
router.get('/me', ...adminOnly, adminController.me);
router.patch('/me', ...adminOnly, adminController.updateMyProfile);
router.post('/me/mot-de-passe', ...adminOnly, adminController.changeMyPassword);
router.get('/me/activite', ...adminOnly, adminController.myActivity);
router.post('/me/photo', ...adminOnly, uploadPhoto.single('photo'), adminController.uploadMyPhoto);
router.delete('/me/photo', ...adminOnly, adminController.removeMyPhoto);
router.get('/dashboard', ...adminOnly, adminController.dashboard);

router.get('/utilisateurs', ...adminOnly, adminController.listUsers);
router.get('/utilisateurs/:id', ...adminOnly, adminController.getUser);
router.post('/utilisateurs/:id/kyc', ...adminOnly, adminController.reviewUserKyc);

router.get('/marchands', ...adminOnly, adminController.listMerchants);
router.get('/marchands/:id', ...adminOnly, adminController.getMerchant);
router.post('/marchands/:id/kyb', ...adminOnly, adminController.reviewMerchantKyb);

router.get('/transactions', ...adminOnly, adminController.listTransactions);

router.get('/kyc/documents', ...adminOnly, adminController.listKycDocuments);
router.get('/kyb/documents', ...adminOnly, adminController.listKybDocuments);

router.get('/wallets', ...adminOnly, adminController.listWallets);
router.get('/recharges', ...adminOnly, adminController.listRecharges);

router.get('/biometrie', ...adminOnly, adminController.biometrieOverview);
router.get('/fraude', ...auditReaders, adminController.fraudeOverview);

router.get('/notifications', ...adminOnly, adminController.listNotifications);
router.post('/notifications', ...adminOnly, adminController.sendNotification);

router.get('/internes', ...superAdminOnly, adminController.listInternalUsers);
router.post('/internes', ...superAdminOnly, adminController.createInternalUser);
router.patch('/internes/:id', ...superAdminOnly, adminController.updateInternalUser);

router.get('/audit-logs', ...auditReaders, adminController.listAuditLogs);

module.exports = router;
