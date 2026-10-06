const crypto = require('crypto');
require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';

// Valeurs par défaut historiques du dépôt — jamais acceptées comme secret réel, même si
// laissées telles quelles dans .env par erreur.
const INSECURE_JWT_DEFAULTS = new Set(['change_me_access_secret_afripay', 'change_me_refresh_secret_afripay', '']);

function resolveJwtSecret(envVar) {
  const value = process.env[envVar];
  if (value && !INSECURE_JWT_DEFAULTS.has(value)) return value;

  if (nodeEnv === 'production') {
    throw new Error(
      `${envVar} doit être défini avec une valeur forte et unique en production (voir backend/.env.example). ` +
        'Démarrage refusé pour éviter de servir des tokens forgeables.'
    );
  }

  // Dev/test : un secret aléatoire par démarrage plutôt qu'une valeur par défaut connue et
  // committée dans le dépôt. Conséquence acceptée : les sessions ne survivent pas à un redémarrage
  // du serveur en dev tant que la variable n'est pas fixée dans .env.
  // eslint-disable-next-line no-console
  console.warn(
    `[env] ${envVar} non défini (ou valeur par défaut du dépôt) : secret aléatoire généré pour ce ` +
      `démarrage (dev uniquement). Définissez ${envVar} dans backend/.env pour des sessions stables entre redémarrages.`
  );
  return crypto.randomBytes(48).toString('hex');
}

// Même logique que resolveJwtSecret ci-dessus, pour une clé de chiffrement (32 octets hex = 64
// caractères) plutôt qu'un secret de signature.
function resolveEncryptionKey(envVar) {
  const value = process.env[envVar];
  if (value) {
    const buf = Buffer.from(value, 'hex');
    if (buf.length === 32) return buf;
    // eslint-disable-next-line no-console
    console.warn(`[env] ${envVar} doit être 32 octets en hexadécimal (64 caractères) — valeur ignorée.`);
  }

  if (nodeEnv === 'production') {
    throw new Error(
      `${envVar} doit être défini (32 octets hex, voir backend/.env.example) en production. ` +
        'Démarrage refusé pour éviter de chiffrer des données sensibles avec une clé non persistante.'
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[env] ${envVar} non défini (ou invalide) : clé aléatoire générée pour ce démarrage (dev uniquement). ` +
      `Définissez ${envVar} dans backend/.env pour que les gabarits restent déchiffrables entre redémarrages.`
  );
  return crypto.randomBytes(32);
}

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME || 'db_afripay',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },
  jwt: {
    accessSecret: resolveJwtSecret('JWT_ACCESS_SECRET'),
    refreshSecret: resolveJwtSecret('JWT_REFRESH_SECRET'),
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  },
  business: {
    kycRechargeCapFcfa: Number(process.env.KYC_RECHARGE_CAP_FCFA || 10000),
    // Confirmation par PIN pour les TRANSFERTS (5.4/6.4 du cahier des charges — systématique,
    // pas conditionnée à un montant) : le seuil par défaut est 0, donc toujours exigée. Reste
    // configurable pour un opérateur qui voudrait explicitement l'assouplir.
    pinConfirmThresholdFcfa: Number(process.env.PIN_CONFIRM_THRESHOLD_FCFA ?? 0),
    // Confirmation additionnelle par PIN pour le PAIEMENT biométrique (4.3 pt.12 — celui-ci est
    // explicitement à seuil : "peut être exigée au-delà d'un certain montant").
    pinConfirmThresholdPaiementFcfa: Number(process.env.PIN_CONFIRM_THRESHOLD_PAIEMENT_FCFA || 50000),
    // Plafond de sécurité par opération (recharge/transfert/achat), indépendant des règles
    // métier KYC — empêche qu'un montant non borné (ex. "1e400") ne crée un solde arbitraire.
    maxTransactionFcfa: Number(process.env.MAX_TRANSACTION_FCFA || 5000000),
    // Frais AfriPay retenus sur les flux Mobile Money réels (Jèko prend 1,5% de son côté, indépendant
    // de ceci) : 2,5% à la recharge (Client) et 2,5% au retrait vers Mobile Money externe (Client OU
    // Marchand, même taux — voir transferService.externalTransfer), déduits du montant demandé (voir
    // utils/amount.calculerFrais). Le paiement (achat) Client<->Marchand et le transfert compte à
    // compte interne restent gratuits — aucun frais n'y est calculé.
    fraisRechargeTaux: Number(process.env.FRAIS_RECHARGE_TAUX ?? 0.025),
    fraisRetraitTaux: Number(process.env.FRAIS_RETRAIT_TAUX ?? process.env.FRAIS_RETRAIT_MARCHAND_TAUX ?? 0.025),
    // Durée de validité du code de présentation "palm_code" (repli QR quand la reconnaissance
    // caméra échoue/est indisponible) avant qu'il ne doive être régénéré — limite la fenêtre de
    // rejeu si le QR affiché est capturé.
    palmCodeTtlSeconds: Number(process.env.PALM_CODE_TTL_SECONDS || 90),
    // Score de similarité minimal (0-1, voir palmVisionService.matchScore) accepté pour identifier
    // un client par reconnaissance de paume (photo) avant de débiter son portefeuille. Valeur de
    // départ prudente, à recalibrer avec de vraies photos (précision/faux-positifs) une fois testé
    // en conditions réelles — pas une valeur validée scientifiquement.
    palmCvMinScore: Number(process.env.PALM_CV_MIN_SCORE || 0.55),
    // Marge minimale entre le meilleur et le second meilleur score lors de la comparaison 1:N —
    // évite d'accepter un match ambigu entre deux clients aux gabarits proches. Même prudence que
    // palmCvMinScore : valeur de départ, à recalibrer avec de vraies photos.
    palmCvMinMargin: Number(process.env.PALM_CV_MIN_MARGIN || 0.05),
    // Anti brute-force dédié à la reconnaissance de paume par photo (distinct de security.* : ici
    // le blocage est scopé au marchand, pas à un compte, car l'identité du client n'est justement
    // pas encore connue avant reconnaissance — voir biometricService.recognizeByPhoto). Ne bloque
    // que le chemin photo ; le repli QR reste disponible pendant un blocage.
    palmMaxFailedAttempts: Number(process.env.PALM_MAX_FAILED_ATTEMPTS || 5),
    palmLockoutMinutes: Number(process.env.PALM_LOCKOUT_MINUTES || 15),
  },
  security: {
    // Blocage automatique après échecs répétés (exigence 9.1) : au-delà de
    // maxFailedAttempts échecs sur la fenêtre lockoutMinutes, le compte est
    // temporairement bloqué pour l'événement concerné (connexion, PIN).
    maxFailedAttempts: Number(process.env.SECURITY_MAX_FAILED_ATTEMPTS || 5),
    lockoutMinutes: Number(process.env.SECURITY_LOCKOUT_MINUTES || 15),
    // Clé AES-256 (32 octets) chiffrant les gabarits biométriques de paume au repos (colonne
    // `gabarit_chiffré`, voir utils/crypto.js encryptTemplate/decryptTemplate).
    palmTemplateEncKey: resolveEncryptionKey('PALM_TEMPLATE_ENC_KEY'),
  },
  otp: {
    expiresMin: Number(process.env.OTP_EXPIRES_MIN || 5),
    // Ne renvoie jamais le code en clair dans la réponse HTTP en production, quelle que soit la
    // valeur de OTP_DEV_ECHO laissée dans l'environnement (oubli de configuration au déploiement).
    devEcho: nodeEnv !== 'production' && (process.env.OTP_DEV_ECHO || 'true') === 'true',
  },
  cors: {
    // Liste blanche d'origines autorisées (CORS_ALLOWED_ORIGINS="https://admin.afripay.example,https://autre.example").
    // Vide en dev -> reflète l'origine de la requête (pratique en local) ; vide en production ->
    // aucune origine cross-site autorisée par défaut (plus sûr que cors() sans configuration).
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  adminSeed: {
    email: process.env.ADMIN_SEED_EMAIL || 'admin@afripay.local',
    // Si non fourni, backend/src/scripts/initDb.js génère un mot de passe aléatoire affiché une
    // seule fois à la création — jamais de mot de passe réel committé dans le dépôt.
    password: process.env.ADMIN_SEED_PASSWORD || '',
  },
  // SMTP (envoi d'e-mail réel) — utilisé pour notifier automatiquement l'auteur d'un message de
  // contact quand un admin y répond (voir services/emailService.js). Comme OTP_DEV_ECHO ci-dessus,
  // l'absence de configuration ne fait pas échouer l'action admin : l'e-mail est simplement loggé
  // en console (dev) plutôt qu'envoyé, pour ne pas bloquer un test local sans compte SMTP.
  email: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    // true pour le port 465 (SSL implicite) ; false pour 587/25 (STARTTLS, nodemailer le négocie).
    secure: (process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'AfriPay <no-reply@afripay.local>',
    get configured() {
      return Boolean(this.host && this.user && this.password);
    },
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  // Jèko (passerelle Mobile Money réelle — encaissement/payin côté Client, retrait/payout côté
  // Marchand) — voir services/jekoService.js. Les deux sens dépendent de webhooks, donc d'un
  // backend exposé publiquement (JEKO_PUBLIC_BASE_URL doit pointer vers une URL que Jèko peut
  // réellement atteindre — un tunnel type ngrok en dev, le vrai domaine en production), et le payin
  // exige en plus des URLs de retour HTTPS valides (construites à partir de la même variable).
  jeko: {
    apiBaseUrl: process.env.JEKO_API_BASE_URL || 'https://api.jeko.africa',
    apiKey: process.env.JEKO_API_KEY || '',
    apiKeyId: process.env.JEKO_API_KEY_ID || '',
    storeId: process.env.JEKO_STORE_ID || '',
    // Secret webhook (Dashboard Jèko) utilisé pour vérifier la signature HMAC-SHA256 de l'en-tête
    // `Jeko-Signature` — voir jekoService.verifyWebhookSignature. Sans lui, tout webhook entrant
    // est rejeté (401) : Jèko signe ses webhooks, et ne pas vérifier cette signature laisserait
    // n'importe qui déclencher un faux crédit de wallet avec un simple POST non authentifié.
    webhookSecret: process.env.JEKO_WEBHOOK_SECRET || '',
    // Base URL par laquelle CE serveur est joignable — sert à construire les URLs de retour
    // (successUrl/errorUrl, exigées par Jèko pour le payin) et, en mode simulation ci-dessous, les
    // liens vers la page de simulation locale (le téléphone doit pouvoir l'ouvrir : IP locale type
    // http://192.168.x.x:4000, la même que mobileclient/mobilepro utilisent déjà pour l'API).
    publicBaseUrl: process.env.JEKO_PUBLIC_BASE_URL || '',
    // Bascule payin/payout sur un simulateur local (voir routes/devPaymentSimulationRoutes.js) au
    // lieu de vrais appels Jèko — permet de tester tout le parcours (recharge, retrait, webhooks,
    // notifications, crédit/débit du wallet) sans clés ni backend exposé publiquement. Verrouillé à
    // false en production quelle que soit la valeur de la variable d'environnement.
    mockMode: (process.env.JEKO_MOCK_MODE || 'false') === 'true' && nodeEnv !== 'production',
  },
};
