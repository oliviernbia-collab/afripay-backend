const { v4: uuidv4 } = require('uuid');
const { query, pool } = require('../config/db');
const ApiError = require('../utils/ApiError');
const walletService = require('./walletService');
const transactionService = require('./transactionService');
const jekoService = require('./jekoService');
const notificationService = require('./notificationService');
const { calculerFrais, round2 } = require('../utils/amount');
const env = require('../config/env');
const { t } = require('../i18n');

// Transfert interne AfriPay (Client -> Client, Marchand -> Client, Marchand -> Marchand).
async function internalTransfer({ fromWalletId, toWalletId, montant, libelle }) {
  if (fromWalletId === toWalletId) throw new ApiError(400, 'Impossible de transférer vers le même portefeuille');
  await walletService.transferBetweenWallets({ fromWalletId, toWalletId, montant });
  return transactionService.recordTransaction({
    type: 'transfert',
    walletSourceId: fromWalletId,
    walletDestinationId: toWalletId,
    montant,
    statut: 'réussi',
    méthode: 'interne',
    // No default French fallback here: leaving it null when the sender didn't type a note lets
    // each app render its own translated generic label (txTypeLabel) instead of baking one
    // language into the stored row. `libelle` should only ever hold the sender's own text.
    libelle: libelle || null,
  });
}

const VALID_OPERATORS = ['wave', 'orange_money', 'moov_money', 'mtn_money'];

/**
 * RETRAIT SORTANT VERS MOBILE MONEY RÉEL (payout Jèko) — section 6.4.
 * ---------------------------------------------------------------------
 * Le wallet marchand est débité immédiatement (verrouillé, voir plus bas) car Jèko ne garantit la
 * confirmation qu'après coup, par webhook — si on créditait/débitait seulement à la confirmation,
 * rien n'empêcherait le marchand de relancer un retrait pendant que le premier est encore en vol.
 * La transaction est créée `en_attente` ; le webhook `TRANSACTION_COMPLETED` (status `success`) la
 * passe à `réussi` (rien d'autre à faire, déjà débité), et `status: error` la passe à `échoué` ET
 * REMBOURSE le wallet (voir controllers/paiementWebhookController.js).
 *
 * Voir jekoService.js pour la forme exacte du bénéficiaire transmise à Jèko, non confirmée par la
 * doc publique et à vérifier avant un vrai passage en production.
 * ---------------------------------------------------------------------
 */
async function externalTransfer({ merchant, opérateurDestination, numéroDestinataire, montant }) {
  if (!VALID_OPERATORS.includes(opérateurDestination)) {
    throw new ApiError(400, `Opérateur de destination inconnu: ${opérateurDestination}`);
  }
  const amount = Number(montant);
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'Montant invalide');

  // Débit verrouillé dans une transaction SQL (SELECT ... FOR UPDATE), comme le transfert interne
  // (walletService.transferBetweenWallets) : sans ce verrou, deux appels concurrents pouvaient lire
  // le même solde initial et débiter chacun séparément, faisant passer le solde marchand en négatif.
  const conn = await pool.getConnection();
  let wallet;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM wallets WHERE propriétaire_id = ? AND type_propriétaire = ? FOR UPDATE', [
      merchant.id,
      'marchand',
    ]);
    wallet = rows[0];
    if (!wallet) throw new ApiError(404, 'Portefeuille marchand introuvable');
    if (Number(wallet.solde) < amount) throw new ApiError(400, 'Solde marchand insuffisant');

    await conn.query('UPDATE wallets SET solde = solde - ? WHERE id = ?', [amount, wallet.id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // Frais AfriPay de 2,5% sur le retrait Marchand, déduit du montant demandé : le wallet marchand
  // est débité du plein montant (ci-dessus, inchangé) mais seul `montantNetAPayer` part réellement
  // vers le Mobile Money du marchand (voir jekoService.initierPayout) — le frais reste la marge
  // d'AfriPay.
  const frais = calculerFrais(amount, env.business.fraisRetraitMarchandTaux);
  const montantNetAPayer = round2(amount - frais);

  const transaction = await transactionService.recordTransaction({
    type: 'transfert',
    walletSourceId: wallet.id,
    walletDestinationId: null,
    montant: amount,
    frais,
    statut: 'en_attente',
    méthode: 'mobile_money',
    libelle: `Transfert vers ${opérateurDestination} (${numéroDestinataire})`,
  });

  let tokenPay;
  try {
    let simulationUrl;
    ({ tokenPay, simulationUrl } = await jekoService.initierPayout({
      montant: montantNetAPayer,
      telephone: numéroDestinataire,
      opérateur: opérateurDestination,
      nomBeneficiaire: merchant.raison_sociale || merchant.telephone,
    }));
    // Mode simulation locale (voir jekoService.js) : l'app Marchand n'affiche pas de lien à ouvrir
    // pour ce flux (contrairement à la recharge) — le lien est donc juste loggé ici pour celui qui
    // fait tourner le serveur en dev, à ouvrir soi-même dans un navigateur pour simuler la
    // confirmation.
    if (simulationUrl) console.log(`[jeko:mock] simuler la confirmation du retrait ${transaction.id} -> ${simulationUrl}`);
  } catch (e) {
    // L'initiation elle-même a échoué (pas juste "en attente de confirmation") : rembourser tout
    // de suite plutôt que de laisser le marchand avec un wallet débité pour rien.
    await walletService.creditWallet(wallet.id, amount);
    await query("UPDATE transactions SET statut = 'échoué' WHERE id = :id", { id: transaction.id });
    throw e;
  }

  const id = uuidv4();
  await query(
    `INSERT INTO transfer_external (id, merchant_id, transaction_id, opérateur_destination, numéro_destinataire, montant, statut, reference_externe)
     VALUES (:id, :merchantId, :transactionId, :operateurDest, :numeroDest, :montant, 'en_attente', :refExterne)`,
    {
      id,
      merchantId: merchant.id,
      transactionId: transaction.id,
      operateurDest: opérateurDestination,
      numeroDest: numéroDestinataire,
      montant: amount,
      refExterne: tokenPay,
    }
  );

  const updatedWallet = await walletService.getWalletById(wallet.id);
  return { transaction, wallet: updatedWallet };
}

// Appelé par le webhook Jèko (voir controllers/paiementWebhookController.js) — jamais par une app
// mobile. `tokenPay` = référence AfriPay renvoyée telle quelle par jekoService.initierPayout,
// retrouvée dans transfer_external.reference_externe. Le wallet a déjà été débité à l'initiation
// (voir externalTransfer ci-dessus) : en cas d'échec confirmé, on le REMBOURSE ; en cas de succès,
// rien de plus à faire côté wallet. Ne fait rien (silencieusement) si aucun retrait `en_attente` ne
// correspond (déjà traité, ou token jamais émis par nous).
async function confirmerPayout(tokenPay, { réussi }) {
  const rows = await query(
    "SELECT * FROM transfer_external WHERE reference_externe = :tokenPay AND statut = 'en_attente' LIMIT 1",
    { tokenPay }
  );
  const retrait = rows[0];
  if (!retrait) return false;

  const nouveauStatut = réussi ? 'réussi' : 'échoué';
  await query('UPDATE transfer_external SET statut = :statut WHERE id = :id', { statut: nouveauStatut, id: retrait.id });
  if (retrait.transaction_id) {
    await query('UPDATE transactions SET statut = :statut WHERE id = :id', { statut: nouveauStatut, id: retrait.transaction_id });
  }
  if (!réussi) {
    const wallet = await walletService.getWalletByOwner(retrait.merchant_id, 'marchand');
    await walletService.creditWallet(wallet.id, retrait.montant);
  }

  // Marchands sans colonne `langue` : titre/contenu par défaut restent français, mais
  // titreCle/contenuCle permettent à l'app Marchand de retraduire dans sa langue active (même
  // principe que les autres notifications marchand, voir merchantPaymentController.js).
  const cle = réussi ? 'notif.payoutConfirmed' : 'notif.payoutFailed';
  await notificationService.notify({
    destinataireId: retrait.merchant_id,
    typeDestinataire: 'marchand',
    type: 'transaction',
    titre: t(undefined, `${cle}.title`),
    contenu: t(undefined, `${cle}.body`, { montant: retrait.montant }),
    titreCle: `${cle}.title`,
    contenuCle: `${cle}.body`,
    params: { montant: retrait.montant },
  });

  return true;
}

module.exports = { internalTransfer, externalTransfer, confirmerPayout, VALID_OPERATORS };
