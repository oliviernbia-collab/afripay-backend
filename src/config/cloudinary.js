const cloudinary = require('cloudinary').v2;
const env = require('./env');

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
  secure: true,
});

// Envoie un buffer en mémoire (fourni par multer) vers Cloudinary. resource_type "auto"
// laisse Cloudinary distinguer image / vidéo / pdf. `type: 'authenticated'` (utilisé pour les
// documents KYC/KYB — voir kycController.js) rend l'URL renvoyée par Cloudinary inaccessible
// sans signature : seul signedUrl() ci-dessous peut la rendre consultable, et seulement pour un
// temps limité (voir adminController.js, qui ne le fait que pour les rôles habilités à voir des
// pièces d'identité). Les avatars/logos restent en `type: 'upload'` (public), volontairement —
// ils sont censés être visibles largement dans l'app (ex. logo marchand affiché au client).
function uploadBuffer(buffer, { folder, resourceType = 'auto', type = 'upload' } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: resourceType, type }, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// Reconstruit { resourceType, deliveryType, publicId } à partir de l'URL Cloudinary stockée en
// base (aucune colonne dédiée à ces champs dans le schéma actuel) — utilisé pour la suppression
// et pour re-signer une URL à la lecture.
function parseUrl(url) {
  if (!url || !url.includes('res.cloudinary.com')) return null;
  const match = url.match(/\/(image|video|raw)\/(upload|authenticated|private)\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  if (!match) return null;
  const [, resourceType, deliveryType, publicId] = match;
  return { resourceType, deliveryType, publicId };
}

function destroyByUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) return Promise.resolve();
  return cloudinary.uploader
    .destroy(parsed.publicId, { resource_type: parsed.resourceType, type: parsed.deliveryType })
    .catch((err) => {
      console.error('[cloudinary] échec suppression:', err.message);
    });
}

// Ré-émet une URL Cloudinary signée, à expiration courte, pour une ressource `authenticated`/
// `private` — les URLs `upload` (publiques, ex. avatars/logos) sont renvoyées telles quelles,
// aucune signature n'étant nécessaire ni supportée pour elles.
function signedUrl(url, { expiresInSeconds = 300 } = {}) {
  const parsed = parseUrl(url);
  if (!parsed || parsed.deliveryType === 'upload') return url;
  return cloudinary.url(parsed.publicId, {
    resource_type: parsed.resourceType,
    type: parsed.deliveryType,
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
  });
}

module.exports = { cloudinary, uploadBuffer, destroyByUrl, signedUrl };
