const express = require('express');
const contactMessageController = require('../controllers/contactMessageController');
const { contactLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Publique, sans authentification : formulaire de contact de la page d'accueil du site web.
router.post('/', contactLimiter, contactMessageController.create);

module.exports = router;
