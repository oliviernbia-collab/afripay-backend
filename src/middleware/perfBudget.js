// Budget de performance (cahier des charges 9.3 : "temps de réponse cible inférieur à 2 secondes
// pour la vérification biométrique et la validation d'une transaction en conditions normales de
// réseau"). Rien dans le dépôt ne mesurait ni n'appliquait ce budget avant ce middleware — il ne
// le GARANTIT pas (aucun code ne peut garantir une latence réseau), mais il rend le budget visible
// et vérifiable : chaque requête lente est loggée, et un instantané de stats glissantes est exposé
// par GET /api/health pour un monitoring externe (voir aussi scripts/loadtest.js pour un test de
// charge reproductible face à ce même seuil).
const RESPONSE_BUDGET_MS = Number(process.env.RESPONSE_BUDGET_MS || 2000);
const WINDOW_SIZE = 500; // dernières N requêtes conservées pour le calcul de p95/p99 glissant

const durations = [];
let totalRequests = 0;
let overBudgetRequests = 0;

function recordDuration(ms) {
  totalRequests += 1;
  if (ms > RESPONSE_BUDGET_MS) overBudgetRequests += 1;
  durations.push(ms);
  if (durations.length > WINDOW_SIZE) durations.shift();
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function perfSnapshot() {
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    budgetMs: RESPONSE_BUDGET_MS,
    windowSize: durations.length,
    totalRequests,
    overBudgetRequests,
    overBudgetRatio: totalRequests ? Number((overBudgetRequests / totalRequests).toFixed(4)) : 0,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

function perfBudgetMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordDuration(ms);
    if (ms > RESPONSE_BUDGET_MS) {
      // eslint-disable-next-line no-console
      console.warn(`[perf] budget dépassé (${ms.toFixed(0)}ms > ${RESPONSE_BUDGET_MS}ms) — ${req.method} ${req.originalUrl}`);
    }
  });
  next();
}

module.exports = { perfBudgetMiddleware, perfSnapshot, RESPONSE_BUDGET_MS };
