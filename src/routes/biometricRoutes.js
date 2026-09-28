const express = require('express');
const biometricController = require('../controllers/biometricController');
const { authenticate, requireType } = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');

const router = express.Router();

router.post('/enroll', authenticate, requireType('client'), uploadPhoto.single('photo'), biometricController.enroll);
router.get('/mon-code', authenticate, requireType('client'), biometricController.myPalmCode);
router.get('/statut', authenticate, requireType('client'), biometricController.status);

module.exports = router;
