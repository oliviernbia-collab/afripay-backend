const express = require('express');
const merchantPaymentController = require('../controllers/merchantPaymentController');
const { authenticate, requireType } = require('../middleware/auth');
const { uploadPhoto } = require('../middleware/upload');

const router = express.Router();

// `photo` est optionnelle : présente pour l'identification par reconnaissance de paume (multipart),
// absente pour le repli QR (`palmCode` en JSON) — voir merchantPaymentController.encaisser.
router.post('/encaisser', authenticate, requireType('marchand'), uploadPhoto.single('photo'), merchantPaymentController.encaisser);

module.exports = router;
