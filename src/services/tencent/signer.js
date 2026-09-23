const crypto = require('crypto');

/**
 * Tencent Cloud API 3.0 request signature (TC3-HMAC-SHA256) — the same signing convention
 * used across every Tencent Cloud product (CVM, COS, etc.), documented at
 * https://cloud.tencent.com/document/api/213/30654. This part is standard and stable.
 *
 * NOTE: `SignedHeaders` below only covers `content-type` + `host`, matching Tencent's official
 * SDKs. The Palm API's product-specific headers (X-Palm-AppId, X-Palm-Openapi-Token) are sent
 * as plain (unsigned) headers per the public docs — verify against your account's actual API
 * reference once Tencent provisions it, in case Palm's gateway expects them signed too.
 */

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hmac(key, msg, encoding) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest(encoding);
}

/**
 * @param {object} opts
 * @param {string} opts.secretId
 * @param {string} opts.secretKey
 * @param {string} opts.host - e.g. 'open.intl.palm.tencent.com'
 * @param {string} opts.service - Tencent Cloud service name used in the credential scope (e.g. 'palm')
 * @param {string} opts.action - X-TC-Action value
 * @param {string} opts.payload - raw JSON request body string
 * @param {number} opts.timestamp - unix seconds
 * @returns {string} Authorization header value
 */
function buildAuthorizationHeader({ secretId, secretKey, host, service, payload, timestamp }) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = sha256Hex(payload);
  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join('\n');

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);
  const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonicalRequest].join('\n');

  const secretDate = hmac('TC3' + secretKey, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');

  return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

module.exports = { buildAuthorizationHeader };
