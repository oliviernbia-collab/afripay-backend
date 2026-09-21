/* Utilitaire : génère un hash bcrypt pour un mot de passe admin donné en argument. */
const bcrypt = require('bcryptjs');

async function run() {
  const password = process.argv[2] || 'AfriPay@2026';
  const hash = await bcrypt.hash(password, 10);
  console.log(`Mot de passe : ${password}`);
  console.log(`Hash bcrypt  : ${hash}`);
}

run();
