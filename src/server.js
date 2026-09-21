const app = require('./app');
const env = require('./config/env');
const { pool } = require('./config/db');

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log(`[DB] Connexion à MySQL (${env.db.name}) réussie.`);
  } catch (e) {
    console.error('[DB] Impossible de se connecter à MySQL. Vérifiez XAMPP et le fichier .env :', e.message);
    process.exit(1);
  }

  app.listen(env.port, () => {
    console.log(`[AfriPay backend] En écoute sur http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

start();
