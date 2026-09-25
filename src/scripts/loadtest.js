/* Test de charge reproductible face au budget de performance du cahier des charges (9.3 :
 * "temps de réponse cible inférieur à 2 secondes... en conditions normales de réseau").
 * Rien de tel n'existait dans le dépôt avant ce script.
 *
 * Cible par défaut : GET /api/health — endpoint sans authentification ni effet de bord, qui
 * vérifie quand même une vraie connexion base de données (voir app.js), donc représentatif de la
 * latence "chemin critique + DB" sans avoir besoin d'un compte de test préconfiguré ni risquer de
 * polluer des données réelles. Pour tester un endpoint authentifié, passez son chemin + un jeton
 * valide : `node src/scripts/loadtest.js /api/wallets/me --token=eyJ...`.
 *
 * Usage : npm run loadtest  (le serveur doit déjà tourner — npm run dev, dans un autre terminal)
 */
const autocannon = require('autocannon');

const BASE_URL = process.env.LOADTEST_BASE_URL || 'http://localhost:4000';
const BUDGET_MS = Number(process.env.RESPONSE_BUDGET_MS || 2000);
const CONNECTIONS = Number(process.env.LOADTEST_CONNECTIONS || 10);
// Plafonné sous le limiteur anti-abus global de l'API (600 requêtes / 15 min, voir app.js) —
// au-delà, les réponses 429 qui en résultent ne mesureraient plus la latence réelle mais le bon
// fonctionnement (attendu) de ce garde-fou, un sujet différent de ce test. Pour un test plus long,
// augmentez temporairement RATE_LIMIT_MAX côté serveur ou visez un chemin hors du limiteur global.
const AMOUNT = Number(process.env.LOADTEST_AMOUNT || 400);

const args = process.argv.slice(2);
const pathArg = args.find((a) => !a.startsWith('--')) || '/api/health';
const tokenArg = args.find((a) => a.startsWith('--token='));
const token = tokenArg ? tokenArg.split('=')[1] : null;

async function main() {
  console.log(`[loadtest] ${CONNECTIONS} connexions simultanées, ${AMOUNT} requêtes au total, sur ${BASE_URL}${pathArg}`);
  console.log(`[loadtest] budget cible (cahier des charges 9.3) : p99 <= ${BUDGET_MS}ms\n`);

  const result = await autocannon({
    url: `${BASE_URL}${pathArg}`,
    connections: CONNECTIONS,
    amount: AMOUNT,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  const { latency, requests, errors, non2xx } = result;
  console.log(autocannon.printResult(result));

  // On ne fait échouer le test que sur la latence et les vraies erreurs réseau (timeouts, connexion
  // refusée...) — pas sur les 429 éventuels du limiteur anti-abus, qui est un comportement voulu et
  // déjà correct, pas un signe que l'API est trop lente.
  const passed = latency.p99 <= BUDGET_MS && errors === 0;
  console.log(
    `\n[loadtest] p50=${latency.p50}ms  p90=${latency.p90}ms  p99=${latency.p99}ms  ` +
      `req/s=${requests.average.toFixed(1)}  erreurs réseau=${errors}  réponses non-2xx=${non2xx}`
  );
  if (non2xx > 0) {
    console.log(
      `[loadtest] ${non2xx} réponse(s) non-2xx — si ce sont des 429, c'est le limiteur anti-abus qui ` +
        `fonctionne normalement (600 req/15 min), pas un échec de ce test de latence.`
    );
  }
  console.log(passed ? '[loadtest] ✅ PASS — dans le budget des 2s (p99)' : '[loadtest] ❌ FAIL — hors budget ou erreurs réseau');
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error('[loadtest] échec du test de charge :', e.message);
  console.error('[loadtest] le serveur tourne-t-il bien sur', BASE_URL, '? (npm run dev)');
  process.exit(1);
});
