const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const { buildAuthorizationHeader } = require('./signer');

const SERVICE = 'palm';

function assertConfigured() {
  const { enabled, appId, secretId, secretKey, apiHost } = env.tencentPalm;
  if (!enabled) {
    throw new ApiError(503, "Le paiement par reconnaissance de la paume (Tencent PalmAI) n'est pas encore configuré.");
  }
  if (!appId || !secretId || !secretKey || !apiHost) {
    throw new ApiError(503, 'Configuration Tencent PalmAI incomplète (AppId/clés manquants).');
  }
}

/**
 * Calls one Tencent PalmAI OpenAPI action (see https://palm.tencent.com/docs/enterprise/api/server).
 * `openapiToken` is only needed for actions scoped to a previously-issued per-user AccessToken —
 * omit it for app-level calls like CreateAccessToken/CreateUser.
 */
async function callAction(action, payload, { openapiToken } = {}) {
  assertConfigured();
  const { appId, secretId, secretKey, apiHost, apiVersion } = env.tencentPalm;

  const body = JSON.stringify(payload || {});
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = buildAuthorizationHeader({
    secretId,
    secretKey,
    host: apiHost,
    service: SERVICE,
    payload: body,
    timestamp,
  });

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Host: apiHost,
    Authorization: authorization,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': apiVersion,
    'X-TC-Nonce': String(Math.floor(Math.random() * 1e9)),
    'X-Palm-AppId': String(appId),
  };
  if (openapiToken) headers['X-Palm-Openapi-Token'] = openapiToken;

  const res = await fetch(`https://${apiHost}/`, { method: 'POST', headers, body });
  const json = await res.json().catch(() => null);

  if (!res.ok || json?.Response?.Error) {
    const message = json?.Response?.Error?.Message || `Erreur Tencent PalmAI (${res.status})`;
    throw new ApiError(502, message, json);
  }
  return json.Response;
}

module.exports = { callAction };
