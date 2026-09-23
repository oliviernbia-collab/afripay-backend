const cloudinary = require('cloudinary').v2;
const env = require('./env');

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
  secure: true,
});

// Envoie un buffer en mémoire (fourni par multer) vers Cloudinary. resource_type "auto"
// laisse Cloudinary distinguer image / vidéo / pdf.
function uploadBuffer(buffer, { folder, resourceType = 'auto' } = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: resourceType }, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// Retrouve le public_id à partir de l'URL Cloudinary stockée en base pour pouvoir
// supprimer l'ancien fichier (aucune colonne dédiée au public_id dans le schéma actuel).
function destroyByUrl(url, { resourceType = 'image' } = {}) {
  if (!url || !url.includes('res.cloudinary.com')) return Promise.resolve();
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  if (!match) return Promise.resolve();
  return cloudinary.uploader.destroy(match[1], { resource_type: resourceType }).catch((err) => {
    console.error('[cloudinary] échec suppression:', err.message);
  });
}

module.exports = { cloudinary, uploadBuffer, destroyByUrl };
