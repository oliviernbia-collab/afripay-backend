const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const env = require('../config/env');
const { callAction } = require('./tencent/palmClient');

/**
 * Real palm-vein/palm-print biometric enrolment via Tencent PalmAI Enterprise KYC — replaces the
 * QR-code mock (see biometricService.js) once a real tenant/AppId/keys exist (env.tencentPalm.enabled).
 *
 * Flow: this service registers the AfriPay user as a Palm user on Tencent's side, then issues a
 * short-lived AccessToken the mobile app hands to the Mobile H5 widget running inside a WebView
 * (see PalmBiometricWebView in the mobile apps' src/components) — the widget itself handles
 * camera capture, liveness/quality checks, and palm registration, then reports back a result.
 *
 * IMPORTANT: field names/shapes here follow Tencent's public docs
 * (https://palm.tencent.com/docs/enterprise/api/server, /mobile-h5) as read before this account
 * existed — re-verify against the real API reference in your Tencent console once the tenant is
 * provisioned, in particular: the CreateUser "already exists" error code/message (used below to
 * stay idempotent), and whether SecretKeyHash is expected exactly as hex(sha256(secretKey)).
 */

async function ensureUser({ id, nom, prenom, telephone }) {
  try {
    await callAction('CreateUser', {
      UserId: id,
      UserName: `${prenom || ''} ${nom || ''}`.trim() || id,
      PhoneNo: telephone,
    });
  } catch (e) {
    if (!/already exists|existe déjà/i.test(e.message)) throw e;
  }
}

async function issueMobileToken(userId) {
  const secretKeyHash = crypto.createHash('sha256').update(env.tencentPalm.secretKey, 'utf8').digest('hex');
  const response = await callAction('CreateAccessToken', {
    AppId: Number(env.tencentPalm.appId),
    SecretId: env.tencentPalm.secretId,
    SecretKeyHash: secretKeyHash,
    GrantType: 'client_credential_user',
    UserId: userId,
  });
  return { token: response.AccessToken, expiresIn: response.ExpiresIn };
}

// Everything the mobile app's PalmBiometricWebView needs to start a 'registration' session for
// this user (see KycEnrollScreen.js).
async function getEnrollmentSession(user) {
  await ensureUser(user);
  const { token, expiresIn } = await issueMobileToken(user.id);
  return {
    token,
    expiresIn,
    userId: user.id,
    userName: `${user.prenom || ''} ${user.nom || ''}`.trim() || user.id,
    phoneNo: user.telephone,
    appId: Number(env.tencentPalm.appId),
    sdkHost: env.tencentPalm.sdkHost,
    mode: 'registration',
  };
}

// Called once the mobile WebView reports a successful 'registration' result (code === 0). The
// actual palm template lives on Tencent's side, not ours — this just records locally that the
// user completed enrolment, reusing biometric_palm_templates (same table the QR-code mock uses)
// so every other layer (KYC step gating, /biometrie/statut, PayerScreen) keeps working unchanged,
// per the original mock's own design note in biometricService.js. `palm_code` here is a random
// placeholder, never shown to the user or scanned by a merchant — real payments should use
// Tencent's recognition flow instead (see README note in getEnrollmentSession above; the
// merchant-side recognition/charge wiring is not built yet, see project notes).
async function confirmEnrollment(userId) {
  const id = uuidv4();
  const placeholderCode = `TENCENT-${uuidv4()}`;
  await query('UPDATE biometric_palm_templates SET actif = 0 WHERE user_id = :userId', { userId });
  await query(
    `INSERT INTO biometric_palm_templates (id, user_id, gabarit_chiffré, palm_code, version_algo, actif)
     VALUES (:id, :userId, 'tencent-managed', :palmCode, 'tencent-palm-v1', 1)`,
    { id, userId, palmCode: placeholderCode }
  );
  return { id };
}

module.exports = { ensureUser, issueMobileToken, getEnrollmentSession, confirmEnrollment };
