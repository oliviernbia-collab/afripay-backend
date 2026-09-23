const multer = require('multer');
const ApiError = require('../utils/ApiError');

// Stockage en mémoire : les fichiers sont ensuite envoyés vers Cloudinary
// (voir config/cloudinary.js), aucune écriture sur disque.
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) return cb(new ApiError(400, 'Format de fichier non autorisé'));
    cb(null, true);
  },
});

// Variante dédiée aux photos de profil : images uniquement (pas de PDF), fichier plus petit.
const uploadPhoto = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new ApiError(400, 'Format de fichier non autorisé (JPEG, PNG ou WebP uniquement)'));
    }
    cb(null, true);
  },
});

module.exports = { upload, uploadPhoto };
