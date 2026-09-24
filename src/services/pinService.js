const ApiError = require('../utils/ApiError');
const { compare } = require('../utils/crypto');
const securityEventService = require('./securityEventService');
const env = require('../config/env');

async function assertNotLockedOut({ telephone, evenement }) {
  const failures = await securityEventService.countRecentFailures({
    telephone,
    evenement,
    sinceMinutes: env.security.lockoutMinutes,
  });
  if (failures >= env.security.maxFailedAttempts) {
    throw new ApiError(429, `Trop de tentatives échouées. Réessayez dans ${env.security.lockoutMinutes} minutes.`);
  }
}

// Vérifie un code PIN AfriPay pour confirmer une opération sensible (transfert, paiement),
// avec blocage anti brute-force (exigence 9.1). `threshold` : si > 0 et montant < threshold,
// aucune confirmation n'est exigée (cf. cahier des charges 4.3 pt.12, qui autorise une
// confirmation additionnelle "au-delà d'un certain montant" pour le paiement biométrique
// uniquement) ; pour les transferts (5.4/6.4, confirmation systématique), appeler avec
// threshold=0 pour la rendre obligatoire quel que soit le montant.
async function assertPinConfirmation({ account, acteurType, acteurId, montant, pin, threshold = 0, req }) {
  if (threshold > 0 && Number(montant) < threshold) return;
  if (!pin) {
    throw new ApiError(
      400,
      threshold > 0 ? `Code PIN requis pour les opérations à partir de ${threshold} FCFA` : 'Code PIN requis pour confirmer cette opération'
    );
  }

  await assertNotLockedOut({ telephone: account.telephone, evenement: 'pin_transaction' });

  const validPin = await compare(pin, account.code_pin_hash);
  await securityEventService.log({
    acteurType,
    acteurId,
    telephone: account.telephone,
    evenement: 'pin_transaction',
    resultat: validPin ? 'succes' : 'echec',
    détails: `montant:${montant}`,
    ip: req?.ip,
  });
  if (!validPin) throw new ApiError(401, 'Code PIN incorrect');
}

// Vérifie le PIN actuel avant de le remplacer (changement de PIN) — empêche qu'une session
// volée (token encore valide) suffise à changer le PIN sans le connaître.
async function assertCurrentPinForChange({ account, acteurType, acteurId, currentPin, req }) {
  if (!account.code_pin_hash) return; // premier réglage du PIN (onboarding) : rien à confirmer

  await assertNotLockedOut({ telephone: account.telephone, evenement: 'pin_changement' });

  if (!currentPin) throw new ApiError(400, 'Le code PIN actuel est requis pour le modifier');
  const validPin = await compare(currentPin, account.code_pin_hash);
  await securityEventService.log({
    acteurType,
    acteurId,
    telephone: account.telephone,
    evenement: 'pin_changement',
    resultat: validPin ? 'succes' : 'echec',
    ip: req?.ip,
  });
  if (!validPin) throw new ApiError(401, 'Code PIN actuel incorrect');
}

module.exports = { assertNotLockedOut, assertPinConfirmation, assertCurrentPinForChange };
