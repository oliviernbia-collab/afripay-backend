const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const { compare } = require('../utils/crypto');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const walletService = require('../services/walletService');
const transferService = require('../services/transferService');
const notificationService = require('../services/notificationService');
const env = require('../config/env');

async function assertPinIfNeeded(auth, montant, pin) {
  const threshold = env.business.pinConfirmThresholdFcfa;
  if (Number(montant) < threshold) return;
  if (!pin) throw new ApiError(400, `Code PIN requis pour les opérations à partir de ${threshold} FCFA`);

  const account = auth.type === 'marchand' ? await merchantService.findById(auth.id) : await userService.findById(auth.id);
  const validPin = await compare(pin, account.code_pin_hash);
  if (!validPin) throw new ApiError(401, 'Code PIN incorrect');
}

// Client -> Client (section 5.4) ou Marchand -> Client / Marchand -> Marchand (section 6.4 volet interne)
async function transferToAfripayAccount(req, res, next) {
  try {
    const { telephoneDestinataire, montant, pin, libelle } = req.body;
    if (!telephoneDestinataire || !montant || Number(montant) <= 0) {
      throw new ApiError(400, 'telephoneDestinataire et montant (>0) sont requis');
    }
    await assertPinIfNeeded(req.auth, montant, pin);

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

    await notificationService.notify({
      destinataireId: destUser.id,
      typeDestinataire: destType,
      type: 'transaction',
      titre: 'Transfert reçu',
      contenu: `Vous avez reçu ${montant} FCFA sur votre compte AfriPay.`,
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
    const { opérateurDestination, numéroDestinataire, montant, pin } = req.body;
    if (!opérateurDestination || !numéroDestinataire || !montant || Number(montant) <= 0) {
      throw new ApiError(400, 'opérateurDestination, numéroDestinataire et montant (>0) sont requis');
    }
    await assertPinIfNeeded(req.auth, montant, pin);

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
