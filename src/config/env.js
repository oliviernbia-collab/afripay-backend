require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    name: process.env.DB_NAME || 'db_afripay',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'change_me_access_secret_afripay',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'change_me_refresh_secret_afripay',
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  },
  business: {
    kycRechargeCapFcfa: Number(process.env.KYC_RECHARGE_CAP_FCFA || 10000),
    pinConfirmThresholdFcfa: Number(process.env.PIN_CONFIRM_THRESHOLD_FCFA || 50000),
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
    devEcho: (process.env.OTP_DEV_ECHO || 'true') === 'true',
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
  },
};
