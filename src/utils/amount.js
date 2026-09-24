const ApiError = require('./ApiError');

// Valide un montant FCFA venant du client (recharge, transfert, achat) : rejette les valeurs
// non finies (NaN, Infinity, "1e400"...), négatives, nulles ou dépassant un plafond par
// opération. Sans ce garde-fou, `Number("1e400")` passe la vérification `> 0` de la plupart
// des comparaisons JS et peut créer un solde quasi illimité en un seul appel.
function toValidAmount(value, { max } = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ApiError(400, 'Montant invalide : doit être un nombre positif');
  }
  if (max && n > max) {
    throw new ApiError(400, `Montant trop élevé (maximum ${max} FCFA par opération)`);
  }
  return n;
}

module.exports = { toValidAmount };
