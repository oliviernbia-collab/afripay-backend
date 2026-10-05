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

// Arrondit un montant FCFA à 2 décimales (colonnes `DECIMAL(18,2)`) — évite les résidus
// binaires d'un simple `montant * taux` (ex. 0.025 * 10000 peut sortir 250.00000000000003).
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Frais retenu par AfriPay sur une opération (recharge Client, retrait Marchand) : le montant
// demandé reste la base envoyée à/débitée par Jèko côté externe, le frais réduit uniquement ce
// qui est réellement crédité au wallet (recharge) ou réellement transféré au Mobile Money
// (retrait) — voir rechargeService.rechargeWallet / transferService.externalTransfer.
function calculerFrais(montant, taux) {
  return round2(Number(montant) * Number(taux));
}

module.exports = { toValidAmount, round2, calculerFrais };
