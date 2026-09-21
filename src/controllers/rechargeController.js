const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const userService = require('../services/userService');
const rechargeService = require('../services/rechargeService');

async function recharge(req, res, next) {
  try {
    if (req.auth.type !== 'client') throw new ApiError(403, 'Réservé aux comptes Client');
    const { fournisseur, montant } = req.body;
    if (!fournisseur || !montant || Number(montant) <= 0) throw new ApiError(400, 'fournisseur et montant (>0) sont requis');

    const user = await userService.findById(req.auth.id);
    const result = await rechargeService.rechargeWallet({ user, fournisseur, montant });
    ok(res, result);
  } catch (e) {
    next(e);
  }
}

async function myRecharges(req, res, next) {
  try {
    const list = await rechargeService.listForUser(req.auth.id);
    ok(res, list);
  } catch (e) {
    next(e);
  }
}

async function providers(req, res, next) {
  ok(res, rechargeService.VALID_PROVIDERS);
}

module.exports = { recharge, myRecharges, providers };
