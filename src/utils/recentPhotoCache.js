// Cache mémoire à expiration, anti-rejeu d'une photo de reconnaissance de paume (voir
// biometricService.recognizeByPhoto). Détecte le renvoi exact d'une photo déjà soumise récemment
// pour un même marchand — bloque le rejeu trivial d'un fichier capturé/intercepté, sans nouvelle
// table ni dépendance externe.
//
// Limite assumée : en mémoire du process Node, donc réinitialisé à chaque redémarrage et non
// partagé entre plusieurs instances si le backend est un jour répliqué horizontalement — acceptable
// à ce stade (déploiement mono-instance), à revoir (Redis ou équivalent) avant un vrai scale-out.

const WINDOW_MS = 5 * 60 * 1000;

const store = new Map(); // key (ex: merchantId) -> Map(hash -> timestamp d'expiration)

function cleanup(bucket) {
  const now = Date.now();
  for (const [hash, expiresAt] of bucket) {
    if (expiresAt <= now) bucket.delete(hash);
  }
}

function wasRecentlyUsed(key, hash) {
  const bucket = store.get(key);
  if (!bucket) return false;
  cleanup(bucket);
  return bucket.has(hash);
}

function remember(key, hash) {
  let bucket = store.get(key);
  if (!bucket) {
    bucket = new Map();
    store.set(key, bucket);
  }
  bucket.set(hash, Date.now() + WINDOW_MS);
  cleanup(bucket);
}

module.exports = { wasRecentlyUsed, remember };
