const express = require('express');
const biometricController = require('../controllers/biometricController');
const { authenticate, requireType } = require('../middleware/auth');

const router = express.Router();

router.post('/enroll', authenticate, requireType('client'), biometricController.enroll);
router.get('/mon-code', authenticate, requireType('client'), biometricController.myPalmCode);
router.get('/statut', authenticate, requireType('client'), biometricController.status);
router.post('/tencent/enroll-session', authenticate, requireType('client'), biometricController.tencentEnrollSession);
router.post('/tencent/confirm-enrollment', authenticate, requireType('client'), biometricController.tencentConfirmEnrollment);
router.post(
  '/marchand/session-reconnaissance',
  authenticate,
  requireType('marchand'),
  biometricController.tencentRecognitionSession
);

module.exports = router;
