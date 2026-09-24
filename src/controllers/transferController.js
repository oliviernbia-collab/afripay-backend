const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const walletService = require('../services/walletService');
const transferService = require('../services/transferService');
const notificationService = require('../services/notificationService');
const pinService = require('../services/pinService');
const { toValidAmount } = require('../utils/amount');
const env = require('../config/env');
const { t } = require('../i18n');

// Confirmation par code PIN AfriPay — systématique pour les transferts (5.4/6.4 du cahier des
// charges), sauf configuration explicite d'un seuil (env.business.pinConfirmThresholdFcfa, 0 par défaut).
async function assertPinIfNeeded(auth, montant, pin, req) {
  const account = auth.type === 'marchand' ? await merchantService.findById(auth.id) : await userService.findById(auth.id);
  const acteurType = auth.type === 'marchand' ? 'marchand' : 'client';
  await pinService.assertPinConfirmation({
    account,
    acteurType,
    acteurId: auth.id,
    montant,
    pin,
    threshold: env.business.pinConfirmThresholdFcfa,
    req,
  });
}

// Client -> Client (section 5.4) ou Marchand -> Client / Marchand -> Marchand (section 6.4 volet interne)
async function transferToAfripayAccount(req, res, next) {
  try {
    const { telephoneDestinataire, pin, libelle } = req.body;
    if (!telephoneDestinataire) throw new ApiError(400, 'telephoneDestinataire est requis');
    const montant = toValidAmount(req.body.montant, { max: env.business.maxTransactionFcfa });
    await assertPinIfNeeded(req.auth, montant, pin, req);

    const fromOwnerType = req.auth.type === 'marchand' ? 'marchand' : 'client';
    const fromWallet = await walletService.getWalletByOwner(req.auth.id, fromOwnerType);
    if (!fromWallet) throw new ApiError(404, 'Portefeuille introuvable');

    let destUser = await userService.findByPhone(telephoneDestinataire);
    let toWallet = null;
    let destType = 'client';
    if (destUser) {
      toWallet = await walletService.getWalletByOwner(destUser.id, 'client');
    } else {
      const destMerchant = await merchantService.findByPhone(telephoneDestinataire);
      if (destMerchant) {
        toWallet = await walletService.getWalletByOwner(destMerchant.id, 'marchand');
        destType = 'marchand';
        destUser = destMerchant;
      }
    }
    if (!toWallet) throw new ApiError(404, 'Aucun compte AfriPay trouvé pour ce numéro');

    const transaction = await transferService.internalTransfer({
      fromWalletId: fromWallet.id,
      toWalletId: toWallet.id,
      montant,
      libelle,
    });

    // Merchants have no `langue` column yet, so their notifications stay French for now
    // (see backend/src/i18n/index.js — client-only for this pass).
    const destLangue = destType === 'client' ? destUser.langue : undefined;
    await notificationService.notify({
      destinataireId: destUser.id,
      typeDestinataire: destType,
      type: 'transaction',
      titre: t(destLangue, 'notif.transferReceived.title'),
      contenu: t(destLangue, 'notif.transferReceived.body', { montant }),
    });

    ok(res, { transaction });
  } catch (e) {
    next(e);
  }
}

// Marchand -> Mobile Money externe (section 6.4)
async function transferToExternal(req, res, next) {
  try {
    if (req.auth.type !== 'marchand') throw new ApiError(403, 'Réservé aux comptes Marchand');
    const { opérateurDestination, numéroDestinataire, pin } = req.body;
    if (!opérateurDestination || !numéroDestinataire) {
      throw new ApiError(400, 'opérateurDestination et numéroDestinataire sont requis');
    }
    const montant = toValidAmount(req.body.montant, { max: env.business.maxTransactionFcfa });
    await assertPinIfNeeded(req.auth, montant, pin, req);

    const merchant = await merchantService.findById(req.auth.id);
    const result = await transferService.externalTransfer({
      merchant,
      opérateurDestination,
      numéroDestinataire,
      montant,
    });
    ok(res, result);
  } catch (e) {
    next(e);
  }
}

module.exports = { transferToAfripayAccount, transferToExternal };
