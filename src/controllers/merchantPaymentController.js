const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const walletService = require('../services/walletService');
const transactionService = require('../services/transactionService');
const biometricService = require('../services/biometricService');
const notificationService = require('../services/notificationService');

/**
 * Flux "Encaisser" — section 4.2/4.3 et 6.3 du cahier des charges.
 * Étapes 13-19 :
 *  1. Le marchand saisit le montant (côté app, avant appel API).
 *  2. Le client présente sa paume -> ici : l'app Marchand scanne le QR code (palm_code)
 *     affiché par l'app Client, ce qui tient lieu de capture caméra + matching 1:N (cf. biometricService).
 *  3. Identification certaine du client, vérification automatique du solde, débit/crédit atomique.
 */
async function encaisser(req, res, next) {
  try {
    if (req.auth.type !== 'marchand') throw new ApiError(403, 'Réservé aux comptes Marchand');
    const { montant, palmCode } = req.body;
    if (!montant || Number(montant) <= 0) throw new ApiError(400, 'Montant invalide');
    if (!palmCode) throw new ApiError(400, 'palmCode requis (scan de la paume du client)');

    const merchant = await merchantService.findById(req.auth.id);
    if (merchant.statut_kyb !== 'validé') {
      throw new ApiError(403, "Compte marchand non activé : le KYB doit être validé avant tout encaissement");
    }

    const clientUserId = await biometricService.verifyByPalmCode(palmCode, { merchantId: merchant.id, ip: req.ip });
    const client = await userService.findById(clientUserId);

    const clientWallet = await walletService.getWalletByOwner(client.id, 'client');
    const merchantWallet = await walletService.getWalletByOwner(merchant.id, 'marchand');

    if (Number(clientWallet.solde) < Number(montant)) {
      await notificationService.notify({
        destinataireId: client.id,
        typeDestinataire: 'client',
        type: 'transaction',
        titre: 'Paiement refusé',
        contenu: `Tentative de paiement de ${montant} FCFA refusée : solde insuffisant.`,
      });
      throw new ApiError(400, 'Solde du client insuffisant pour couvrir ce montant');
    }

    await walletService.transferBetweenWallets({
      fromWalletId: clientWallet.id,
      toWalletId: merchantWallet.id,
      montant,
    });

    const transaction = await transactionService.recordTransaction({
      type: 'achat',
      walletSourceId: clientWallet.id,
      walletDestinationId: merchantWallet.id,
      montant,
      statut: 'réussi',
      méthode: 'paume_de_main',
      libelle: `Achat chez ${merchant.raison_sociale || merchant.telephone}`,
    });

    await Promise.all([
      notificationService.notify({
        destinataireId: client.id,
        typeDestinataire: 'client',
        type: 'transaction',
        titre: 'Paiement effectué',
        contenu: `Paiement de ${montant} FCFA accepté chez ${merchant.raison_sociale || 'un marchand AfriPay'}.`,
      }),
      notificationService.notify({
        destinataireId: merchant.id,
        typeDestinataire: 'marchand',
        type: 'transaction',
        titre: 'Encaissement reçu',
        contenu: `Encaissement de ${montant} FCFA validé.`,
      }),
    ]);

    ok(res, {
      transaction,
      client: { nom: client.nom, prenom: client.prenom },
      reçu: {
        reference: transaction.reference,
        montant: transaction.montant,
        date: transaction.date_heure,
      },
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { encaisser };
