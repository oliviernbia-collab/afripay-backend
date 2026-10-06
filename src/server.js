const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');
const palmVisionService = require('./services/palmVisionService');
const realtime = require('./realtime/socket');

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log(`[DB] Connexion à MySQL (${env.db.name}) réussie.`);
  } catch (e) {
    console.error('[DB] Impossible de se connecter à MySQL. Vérifiez XAMPP et le fichier .env :', e.message);
    process.exit(1);
  }

  // Serveur HTTP explicite (plutôt que app.listen directement) : Socket.IO doit s'attacher au même serveur
  // pour partager le port 4000 (voir realtime/socket.js) — même mécanique que `GET/POST` d'Express,
  // juste avec un protocole supplémentaire géré par-dessus la même connexion TCP.
  const httpServer = http.createServer(app);
  realtime.init(httpServer);

  httpServer.listen(env.port, () => {
    console.log(`[AfriPay backend] En écoute sur http://localhost:${env.port} (${env.nodeEnv}) — temps réel actif`);
  });

  // Précharge le détecteur de main (reconnaissance de paume) en tâche de fond : ~3-4s la première
  // fois, coût indépendant du backend CPU/WASM (chargement du modèle). Ne bloque pas le démarrage
  // du serveur — seul le tout premier appel à /biometrie/enroll ou /marchand/encaisser aurait payé
  // ce coût sinon.
  const warmUpStarted = Date.now();
  palmVisionService
    .warmUp()
    .then(() => console.log(`[biometrie] Détecteur de paume préchargé (${Date.now() - warmUpStarted}ms).`))
    .catch((e) => console.warn('[biometrie] Échec du préchargement du détecteur (sera retenté à la 1ère requête):', e.message));
}

start();
