const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/jwt');

// Vérifie le JWT et attache req.auth = { id, type: 'client'|'marchand'|'admin', role? }
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, "Authentification requise"));

  try {
    const payload = verifyAccessToken(token);
    req.auth = payload;
    next();
  } catch (e) {
    next(new ApiError(401, 'Session invalide ou expirée'));
  }
}

// Restreint l'accès à un ou plusieurs types de compte : 'client', 'marchand', 'admin'
function requireType(...types) {
  return (req, res, next) => {
    if (!req.auth || !types.includes(req.auth.type)) {
      return next(new ApiError(403, 'Accès refusé pour ce type de compte'));
    }
    next();
  };
}

module.exports = { authenticate, requireType };
