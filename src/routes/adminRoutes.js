const express = require('express');
const adminController = require('../controllers/adminController');
const { authenticate, requireType } = require('../middleware/auth');

const router = express.Router();

router.post('/login', adminController.login);
router.get('/me', authenticate, requireType('admin'), adminController.me);
router.get('/dashboard', authenticate, requireType('admin'), adminController.dashboard);

router.get('/utilisateurs', authenticate, requireType('admin'), adminController.listUsers);
router.get('/utilisateurs/:id', authenticate, requireType('admin'), adminController.getUser);
router.post('/utilisateurs/:id/kyc', authenticate, requireType('admin'), adminController.reviewUserKyc);

router.get('/marchands', authenticate, requireType('admin'), adminController.listMerchants);
router.get('/marchands/:id', authenticate, requireType('admin'), adminController.getMerchant);
router.post('/marchands/:id/kyb', authenticate, requireType('admin'), adminController.reviewMerchantKyb);

router.get('/transactions', authenticate, requireType('admin'), adminController.listTransactions);

module.exports = router;
