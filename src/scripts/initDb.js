/* Exécute database/schema.sql contre le serveur MySQL configuré dans .env (crée db_afripay + tables),
 * puis crée le compte super admin initial s'il n'en existe encore aucun. Le mot de passe n'est
 * jamais committé en clair dans le dépôt : soit il vient de ADMIN_SEED_PASSWORD (.env, non versionné),
 * soit il est généré aléatoirement et affiché une seule fois en console. */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

async function seedSuperAdminIfMissing(connection) {
  const [rows] = await connection.query('SELECT COUNT(*) AS total FROM admins');
  if (rows[0].total > 0) {
    console.log('[initDb] Des comptes admin existent déjà — aucun seed nécessaire.');
    return;
  }

  const email = process.env.ADMIN_SEED_EMAIL || 'admin@afripay.local';
  const generated = !process.env.ADMIN_SEED_PASSWORD;
  const password = process.env.ADMIN_SEED_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const motDePasseHash = await bcrypt.hash(password, 10);

  await connection.query('INSERT INTO admins (id, nom, email, mot_de_passe_hash, role) VALUES (?, ?, ?, ?, ?)', [
    uuidv4(),
    'Super Admin',
    email,
    motDePasseHash,
    'super_admin',
  ]);

  console.log('\n============================================================');
  console.log('[initDb] Compte super admin créé :');
  console.log(`  Email        : ${email}`);
  console.log(`  Mot de passe : ${password}`);
  if (generated) {
    console.log('  -> Généré aléatoirement : notez-le maintenant, il ne sera plus jamais affiché.');
  }
  console.log('  -> Changez-le dès la première connexion (Profil > Mot de passe).');
  console.log('============================================================\n');
}

async function run() {
  const schemaPath = path.join(__dirname, '..', '..', '..', 'database', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  console.log('[initDb] Exécution de database/schema.sql ...');
  await connection.query(sql);
  console.log('[initDb] Base db_afripay créée/réinitialisée avec succès.');

  await seedSuperAdminIfMissing(connection);

  await connection.end();
}

run().catch((e) => {
  console.error('[initDb] Échec :', e.message);
  process.exit(1);
});
