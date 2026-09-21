/* Exécute database/schema.sql contre le serveur MySQL configuré dans .env (crée db_afripay + tables + seed admin). */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

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
  console.log('[initDb] Terminé : base db_afripay créée/réinitialisée avec succès.');

  await connection.end();
}

run().catch((e) => {
  console.error('[initDb] Échec :', e.message);
  process.exit(1);
});
