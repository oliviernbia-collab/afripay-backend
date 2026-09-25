const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { callAction } = require('./tencent/palmClient');

/**
 * Real palm-vein/palm-print biometric enrolment AND payment-time recognition via Tencent PalmAI
 * Enterprise KYC — replaces the QR-code mock (see biometricService.js) once a real tenant/AppId/
 * keys exist (env.tencentPalm.enabled). Two flows live here:
 *  - Enrolment (client side, KYC step 4): getEnrollmentSession / confirmEnrollment.
 *  - Recognition (merchant side, "Encaisser" — option 1 in the dual-path scan screen, QR-code
 *    stays option 2 for when biometrics are disabled/fail): getRecognitionSession /
 *    confirmRecognition.
 *
 * Flow: this service registers the AfriPay user (client or merchant) as a Palm user on Tencent's
 * side, then issues a short-lived AccessToken the mobile app hands to the Mobile H5 widget running
 * inside a WebView (see PalmBiometricWebView in the mobile apps' src/components) — the widget
 * itself handles camera capture, liveness/quality checks, and palm registration/recognition, then
 * reports back a result.
 *
 * IMPORTANT: field names/shapes here follow Tencent's public docs
 * (https://palm.tencent.com/docs/enterprise/api/server, /mobile-h5) as read before this account
 * existed — re-verify against the real API reference in your Tencent console once the tenant is
 * provisioned, in particular: the CreateUser "already exists" error code/message (used below to
 * stay idempotent), whether SecretKeyHash is expected exactly as hex(sha256(secretKey)), and the
 * exact recognition-mode contract (params: token/userId/userName/phoneNo/mode='recognition', no
 * target userId; result: {code, message, data:{userId, score, userName?, palmDirection?}}) — this
 * one especially was never exercised against a live account and deserves a second look before
 * real money depends on it.
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

// Merchant-side 1:N recognition ("Encaisser" flow) — cahier des charges 4.2/6.3. Unlike
// enrolment (a client identifying themselves), here the merchant's device captures an unknown
// client's palm and asks Tencent "who is this". Mode 'recognition' per Tencent's Mobile H5 docs:
// no target userId is supplied (that's the whole point — we don't know who's presenting their
// palm yet), the widget returns one in its result. `userId`/`userName`/`phoneNo` in the session
// below identify the MERCHANT (the one operating the scan), not the client being recognised.
// IMPORTANT: re-verify this against the real API reference once the tenant is provisioned —
// recognition mode was read from Tencent's published docs, not exercised against a live account.
async function getRecognitionSession(merchant) {
  await ensureUser({ id: merchant.id, nom: merchant.raison_sociale, prenom: '', telephone: merchant.telephone });
  const { token, expiresIn } = await issueMobileToken(merchant.id);

  const id = uuidv4();
  const expireA = new Date(Date.now() + env.tencentPalm.recognitionSessionTtlSeconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  await query('INSERT INTO palm_recognition_sessions (id, merchant_id, expire_a) VALUES (:id, :merchantId, :expireA)', {
    id,
    merchantId: merchant.id,
    expireA,
  });

  return {
    sessionId: id,
    token,
    expiresIn,
    userId: merchant.id,
    userName: merchant.raison_sociale || merchant.telephone,
    phoneNo: merchant.telephone,
    appId: Number(env.tencentPalm.appId),
    sdkHost: env.tencentPalm.sdkHost,
    mode: 'recognition',
  };
}

// Validates a recognition result reported by the merchant's app before merchantPaymentController
// trusts the identified client. This result travels through the MERCHANT's device (Tencent's
// widget posts it back via the WebView, the app relays it to our API) — never the identified
// client's own session — so it can't be trusted as-is: a malicious/compromised merchant app could
// otherwise fabricate any {userId, score} and drain an arbitrary client's wallet. Binding it to a
// short-lived, single-use, merchant-scoped session (issued moments earlier by
// getRecognitionSession) closes the obvious replay/spoof path, though it still can't independently
// re-confirm the biometric match itself the way a server-side "verify this token" Tencent API call
// would — ask Tencent support whether one exists before relying on this for real money.
async function confirmRecognition({ sessionId, merchantId, recognizedUserId, score }) {
  if (!sessionId || !recognizedUserId) {
    throw new ApiError(400, 'Session de reconnaissance et identifiant client requis');
  }
  const rows = await query(
    `SELECT * FROM palm_recognition_sessions
     WHERE id = :sessionId AND merchant_id = :merchantId AND utilisé = 0 AND expire_a > NOW()
     LIMIT 1`,
    { sessionId, merchantId }
  );
  if (!rows[0]) {
    throw new ApiError(400, 'Session de reconnaissance invalide, déjà utilisée ou expirée — relancez le scan');
  }

  // N'invalider la session qu'en cas de succès : un score insuffisant (mauvais éclairage, geste
  // imprécis...) doit permettre de représenter la paume dans la même fenêtre de session plutôt que
  // de forcer une nouvelle demande — sinon un premier essai raté bloquerait le second, même bon.
  if (typeof score !== 'number' || score < env.tencentPalm.minRecognitionScore) {
    throw new ApiError(400, 'Confiance de reconnaissance insuffisante — présentez à nouveau la paume');
  }
  await query('UPDATE palm_recognition_sessions SET utilisé = 1 WHERE id = :id', { id: rows[0].id });
  return recognizedUserId;
}

module.exports = {
  ensureUser,
  issueMobileToken,
  getEnrollmentSession,
  confirmEnrollment,
  getRecognitionSession,
  confirmRecognition,
};
