const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const walletService = require('../services/walletService');
const transactionService = require('../services/transactionService');

const ownerTypeFor = (authType) => (authType === 'marchand' ? 'marchand' : 'client');

async function getMyWallet(req, res, next) {
  try {
    const ownerType = ownerTypeFor(req.auth.type);
    const wallet = await walletService.getWalletByOwner(req.auth.id, ownerType);
    if (!wallet) throw new ApiError(404, 'Portefeuille introuvable');
    ok(res, wallet);
  } catch (e) {
    next(e);
  }
}

async function getMyHistory(req, res, next) {
  try {
    const ownerType = ownerTypeFor(req.auth.type);
    const wallet = await walletService.getWalletByOwner(req.auth.id, ownerType);
    if (!wallet) throw new ApiError(404, 'Portefeuille introuvable');

    const { type, statut, dateDebut, dateFin, limit, offset } = req.query;
    const history = await transactionService.listForWallet(wallet.id, {
      type,
      statut,
      dateDebut,
      dateFin,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    ok(res, history);
  } catch (e) {
    next(e);
  }
}

async function getMyStats(req, res, next) {
  try {
    const ownerType = ownerTypeFor(req.auth.type);
    const wallet = await walletService.getWalletByOwner(req.auth.id, ownerType);
    if (!wallet) throw new ApiError(404, 'Portefeuille introuvable');
    const stats = await transactionService.statsForWallet(wallet.id, req.query.period || 'jour');
    ok(res, stats);
  } catch (e) {
    next(e);
  }
}

module.exports = { getMyWallet, getMyHistory, getMyStats };
