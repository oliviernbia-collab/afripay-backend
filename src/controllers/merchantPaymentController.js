const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const walletService = require('../services/walletService');
const transactionService = require('../services/transactionService');
const biometricService = require('../services/biometricService');
const notificationService = require('../services/notificationService');
const pinService = require('../services/pinService');
const { toValidAmount } = require('../utils/amount');
const env = require('../config/env');
const { t } = require('../i18n');

/**
 * Flux "Encaisser" — section 4.2/4.3 et 6.3 du cahier des charges.
 * Étapes 13-19 :
 *  1. Le marchand saisit le montant (côté app, avant appel API).
 *  2. Le client présente sa paume — deux chemins d'identification possibles :
 *     - Option 1 (reconnaissance réelle, locale) : l'app Marchand envoie une photo de la paume
 *       présentée (multipart, champ `photo`) ; le backend extrait le gabarit et le compare 1:N
 *       aux gabarits actifs (voir biometricService.recognizeByPhoto / palmVisionService.js) —
 *       tout se passe côté serveur dans cette même requête, rien à faire confiance côté app.
 *     - Option 2 (repli QR) : l'app Marchand scanne le QR code (palm_code) affiché par l'app
 *       Client — utilisé quand la caméra/l'éclairage posent problème côté Option 1.
 *  3. Identification du client, vérification automatique du solde, débit/crédit atomique.
 */
async function encaisser(req, res, next) {
  try {
    if (req.auth.type !== 'marchand') throw new ApiError(403, 'Réservé aux comptes Marchand');
    const { palmCode, clientPin } = req.body;
    const photo = req.file;
    if (!palmCode && !photo) {
      throw new ApiError(400, 'Identification du client requise (photo de la paume ou QR)');
    }
    const montant = toValidAmount(req.body.montant, { max: env.business.maxTransactionFcfa });

    const merchant = await merchantService.findById(req.auth.id);
    if (merchant.statut_kyb !== 'validé') {
      throw new ApiError(403, "Compte marchand non activé : le KYB doit être validé avant tout encaissement");
    }

    const clientUserId = photo
      ? await biometricService.recognizeByPhoto(photo.buffer, { merchantId: merchant.id, ip: req.ip })
      : await biometricService.verifyByPalmCode(palmCode, { merchantId: merchant.id, ip: req.ip });
    const client = await userService.findById(clientUserId);
    if (!client) throw new ApiError(404, 'Client introuvable');

    // Confirmation additionnelle par PIN au-delà d'un certain montant (cahier des charges 4.3
    // pt.12) — saisie par le client sur le terminal du marchand, comme un code PIN à un TPE
    // physique. En dessous du seuil, l'identification (photo ou QR) suffit.
    await pinService.assertPinConfirmation({
      account: client,
      acteurType: 'client',
      acteurId: client.id,
      montant,
      pin: clientPin,
      threshold: env.business.pinConfirmThresholdPaiementFcfa,
      req,
    });

    const clientWallet = await walletService.getWalletByOwner(client.id, 'client');
    const merchantWallet = await walletService.getWalletByOwner(merchant.id, 'marchand');

    if (Number(clientWallet.solde) < Number(montant)) {
      await notificationService.notify({
        destinataireId: client.id,
        typeDestinataire: 'client',
        type: 'transaction',
        titre: t(client.langue, 'notif.paymentRefused.title'),
        contenu: t(client.langue, 'notif.paymentRefused.body', { montant }),
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
      libelle: t(client.langue, 'tx.achatLibelle', { marchand: merchant.raison_sociale || merchant.telephone }),
    });

    await Promise.all([
      notificationService.notify({
        destinataireId: client.id,
        typeDestinataire: 'client',
        type: 'transaction',
        titre: t(client.langue, 'notif.paymentAccepted.title'),
        contenu: t(client.langue, 'notif.paymentAccepted.body', {
          montant,
          marchand: merchant.raison_sociale || 'un marchand AfriPay',
        }),
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
      // Client anonymisé côté marchand (cahier des charges 6.5) : initiales seulement, jamais le
      // nom complet sur le reçu affiché au point de vente.
      client: { nom: transactionService.maskName(`${client.prenom} ${client.nom}`) },
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
