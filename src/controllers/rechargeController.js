const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/response');
const userService = require('../services/userService');
const rechargeService = require('../services/rechargeService');
const paymentMethodService = require('../services/paymentMethodService');

async function recharge(req, res, next) {
  try {
    if (req.auth.type !== 'client') throw new ApiError(403, 'Réservé aux comptes Client');
    const { fournisseur, montant, moyenPaiementId } = req.body;
    if (!fournisseur || !montant || Number(montant) <= 0) throw new ApiError(400, 'fournisseur et montant (>0) sont requis');

    const user = await userService.findById(req.auth.id);
    const result = await rechargeService.rechargeWallet({ user, fournisseur, montant, moyenPaiementId });
    ok(res, result);
  } catch (e) {
    next(e);
  }
}

async function listPaymentMethods(req, res, next) {
  try {
    const { fournisseur } = req.query;
    const methods = await paymentMethodService.listForUser(req.auth.id, fournisseur);
    ok(res, methods);
  } catch (e) {
    next(e);
  }
}

async function addPaymentMethod(req, res, next) {
  try {
    const { fournisseur, identifiant, libelle } = req.body;
    const method = await paymentMethodService.create({ userId: req.auth.id, fournisseur, identifiant, libelle });
    created(res, method);
  } catch (e) {
    next(e);
  }
}

async function removePaymentMethod(req, res, next) {
  try {
    await paymentMethodService.remove(req.auth.id, req.params.id);
    ok(res, { removed: true });
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

module.exports = { recharge, myRecharges, providers, listPaymentMethods, addPaymentMethod, removePaymentMethod };
