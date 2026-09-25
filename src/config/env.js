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
    // Durée de validité du code de présentation "palm_code" (mock du scan de paume) avant qu'il
    // ne doive être régénéré — limite la fenêtre de rejeu si le QR affiché est capturé.
    palmCodeTtlSeconds: Number(process.env.PALM_CODE_TTL_SECONDS || 90),
  },
  security: {
    // Blocage automatique après échecs répétés (exigence 9.1) : au-delà de
    // maxFailedAttempts échecs sur la fenêtre lockoutMinutes, le compte est
    // temporairement bloqué pour l'événement concerné (connexion, PIN).
    maxFailedAttempts: Number(process.env.SECURITY_MAX_FAILED_ATTEMPTS || 5),
    lockoutMinutes: Number(process.env.SECURITY_LOCKOUT_MINUTES || 15),
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
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  // Real palm-vein/palm-print biometric payment (cahier des charges section 4), via Tencent
  // PalmAI Enterprise KYC — see backend/src/services/tencent/. `enabled` stays false until a
  // real tenant/AppId/keys are provisioned by Tencent (this is a sales-gated enterprise product,
  // not self-service); until then the app keeps using the QR-code enrolment mock.
  tencentPalm: {
    enabled: (process.env.TENCENT_PALM_ENABLED || 'false') === 'true',
    appId: process.env.TENCENT_PALM_APP_ID || '',
    secretId: process.env.TENCENT_PALM_SECRET_ID || '',
    secretKey: process.env.TENCENT_PALM_SECRET_KEY || '',
    apiHost: process.env.TENCENT_PALM_API_HOST || 'open.intl.palm.tencent.com',
    apiVersion: process.env.TENCENT_PALM_API_VERSION || '2025-07-15',
    // Provided by Tencent alongside the AppId once the tenant is set up — hosts the mobile
    // loader script the WebView embeds (see mobile clients' PalmBiometricWebView component).
    sdkHost: process.env.TENCENT_PALM_SDK_HOST || '',
    // Minimum confidence score (Tencent's `data.score`, expected 0-1) accepted for a 1:N
    // recognition match at the merchant's "Encaisser" screen before money moves. Re-tune once the
    // real tenant is provisioned and Tencent's console documents their own recommended threshold —
    // 0.8 here is a conservative placeholder, not a value sourced from Tencent.
    minRecognitionScore: Number(process.env.TENCENT_PALM_MIN_RECOGNITION_SCORE || 0.8),
    // How long a merchant's recognition session stays valid/single-use (palm_recognition_sessions).
    recognitionSessionTtlSeconds: Number(process.env.TENCENT_PALM_RECOGNITION_TTL_SECONDS || 90),
  },
};
