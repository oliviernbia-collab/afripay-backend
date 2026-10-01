const express = require('express');
const annonceController = require('../controllers/annonceController');

const router = express.Router();

// Publique, sans authentification : consommée par la page d'accueil du site web.
router.get('/active', annonceController.active);

module.exports = router;
