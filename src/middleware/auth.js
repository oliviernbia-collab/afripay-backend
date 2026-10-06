const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/jwt');
const permissionService = require('../services/permissionService');

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

// Restreint l'accès à un ou plusieurs rôles admin ('super_admin', 'conformite', 'support').
// N'a de sens qu'après `requireType('admin')`.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return next(new ApiError(403, 'Rôle insuffisant pour cette action'));
    }
    next();
  };
}

// Restreint l'accès selon la permission configurable associée au rôle admin (voir
// backend/src/services/permissionService.js et database/schema.sql — table role_permissions).
// N'a de sens qu'après `requireType('admin')`. 'super_admin' contourne toujours cette vérification.
function requirePermission(code) {
  return async (req, res, next) => {
    try {
      if (!req.auth || req.auth.type !== 'admin') {
        return next(new ApiError(403, 'Accès refusé pour ce type de compte'));
      }
      const allowed = await permissionService.roleHasPermission(req.auth.role, code);
      if (!allowed) return next(new ApiError(403, 'Permission insuffisante pour cette action'));
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { authenticate, requireType, requireRole, requirePermission };
