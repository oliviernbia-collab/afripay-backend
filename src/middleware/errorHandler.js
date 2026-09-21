const multer = require('multer');
const ApiError = require('../utils/ApiError');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route introuvable: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Une erreur multer (fichier trop volumineux, champ inattendu, etc.) est une erreur de
  // requête client, jamais une erreur serveur — sans ce mapping elle remonterait en 500.
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Le fichier dépasse la taille maximale autorisée.' : err.message;
    return res.status(400).json({ success: false, message });
  }

  const statusCode = err instanceof ApiError ? err.statusCode : 500;
  const message = err.message || 'Erreur interne du serveur';

  if (statusCode >= 500) {
    console.error('[ERROR]', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    details: err.details || undefined,
  });
}

module.exports = { notFoundHandler, errorHandler };
