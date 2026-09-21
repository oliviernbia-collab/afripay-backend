const express = require('express');
const notificationController = require('../controllers/notificationController');
const { authenticate, requireType } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, requireType('client', 'marchand'), notificationController.list);
router.post('/:id/lu', authenticate, requireType('client', 'marchand'), notificationController.markRead);
router.post('/tout-lire', authenticate, requireType('client', 'marchand'), notificationController.markAllRead);

module.exports = router;
