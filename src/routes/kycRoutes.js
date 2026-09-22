const express = require('express');
const kycController = require('../controllers/kycController');
const { authenticate, requireType } = require('../middleware/auth');
const { upload, uploadPhoto } = require('../middleware/upload');

const router = express.Router();

router.get('/client/statut', authenticate, requireType('client'), kycController.myKycStatus);
router.post('/client/informations', authenticate, requireType('client'), kycController.submitPersonalInfo);
router.post(
  '/client/photo',
  authenticate,
  requireType('client'),
  uploadPhoto.single('photo'),
  kycController.uploadMyPhoto
);
router.delete('/client/photo', authenticate, requireType('client'), kycController.removeMyPhoto);
router.post(
  '/client/documents',
  authenticate,
  requireType('client'),
  upload.single('document'),
  kycController.uploadClientDocument
);
router.get('/client/documents', authenticate, requireType('client'), kycController.myClientDocuments);

router.post(
  '/marchand/documents',
  authenticate,
  requireType('marchand'),
  upload.single('document'),
  kycController.uploadMerchantDocument
);
router.get('/marchand/documents', authenticate, requireType('marchand'), kycController.myMerchantDocuments);

module.exports = router;
