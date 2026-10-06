const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const env = require('../config/env');

/**
 * TEMPS RÉEL (Socket.IO) — pousse au client un événement dès qu'un état qui lui appartient change
 * côté serveur (solde, notification), au lieu d'attendre qu'il revienne sur l'écran ou tire pour
 * rafraîchir (voir le reste du code : AVANT cette socket, le seul moyen de savoir qu'un webhook
 * Jèko venait de confirmer une recharge/un retrait était de rouvrir l'écran).
 * ---------------------------------------------------------------------
 * Une « room » par compte (`${type}:${id}`, même paire que req.auth) : chaque appareil connecté
 * avec ce compte (plusieurs sessions possibles, voir devices_sessions) rejoint la même room et
 * reçoit donc l'événement, quel que soit l'appareil qui a déclenché le changement.
 *
 * Authentification par handshake (`socket.handshake.auth.token`), PAS par le cookie de session
 * admin ni par un paramètre d'URL (jamais de token dans une query string loguée) : même JWT d'accès
 * que l'API REST (verifyAccessToken), donc même durée de vie — le client doit reconnecter la socket
 * après un refresh de token (voir mobileclient/mobilepro src/realtime/socket.js).
 * ---------------------------------------------------------------------
 */
let io = null;

function roomFor(ownerType, ownerId) {
  return `${ownerType}:${ownerId}`;
}

function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        // Même politique que CORS REST (voir app.js) : pas d'en-tête Origin (app mobile) -> ok ;
        // sinon liste blanche en prod, tout en dev.
        if (!origin) return callback(null, true);
        if (env.cors.allowedOrigins.length === 0) return callback(null, env.nodeEnv !== 'production');
        return callback(null, env.cors.allowedOrigins.includes(origin));
      },
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw new Error('Token manquant');
      const payload = verifyAccessToken(token);
      socket.data.auth = payload; // { id, type, iat, exp } — identique à req.auth côté REST
      next();
    } catch (e) {
      next(new Error('Authentification invalide'));
    }
  });

  io.on('connection', (socket) => {
    const { id, type } = socket.data.auth;
    socket.join(roomFor(type, id));
    // Room partagée par TOUS les admins connectés (plusieurs comptes possibles — super_admin,
    // conformité, support, voir database/schema.sql role_permissions) : un événement de supervision
    // (nouveau message de contact, nouveau document KYC/KYB soumis) doit atteindre quiconque a le
    // back-office ouvert, pas seulement l'admin qui l'a déclenché — voir emitToAdmins ci-dessous.
    if (type === 'admin') socket.join('admin:all');
  });

  return io;
}

// Émet un événement à TOUS les appareils connectés d'un compte donné. Silencieux si Socket.IO
// n'est pas encore initialisé (ex. scripts/tests qui chargent les services hors serveur HTTP) ou si
// le compte n'a aucun appareil connecté — ce n'est jamais le chemin critique : chaque état poussé
// ici est déjà persisté en base avant l'émission, un client absent le retrouvera au prochain fetch.
function emitToOwner(ownerType, ownerId, event, payload) {
  if (!io || !ownerType || !ownerId) return;
  io.to(roomFor(ownerType, ownerId)).emit(event, payload);
}

// Diffuse à TOUS les admins connectés (voir la room 'admin:all' ci-dessus) — pour les événements de
// supervision qui ne concernent aucun compte précis (nouveau message de contact, nouveau document
// KYC/KYB soumis), contrairement à emitToOwner qui cible un seul compte.
function emitToAdmins(event, payload) {
  if (!io) return;
  io.to('admin:all').emit(event, payload);
}

module.exports = { init, emitToOwner, emitToAdmins };
