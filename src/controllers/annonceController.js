const { ok } = require('../utils/response');
const annonceService = require('../services/annonceService');
const auditService = require('../services/auditService');

// Endpoint PUBLIC (pas d'authentification) : consommé par la page d'accueil du site web.
// Alimenté automatiquement par adminController.sendNotification (diffusion "Tous les clients ou
// marchands") — pas de création manuelle, voir annonceService.js.
async function active(req, res, next) {
  try {
    ok(res, await annonceService.listActive());
  } catch (e) {
    next(e);
  }
}

// Retire le bandeau de la page d'accueil avant toute nouvelle diffusion générale — seul moyen de
// l'arrêter manuellement, puisqu'il n'y a plus de création/désactivation au cas par cas (voir
// annonceService.js).
async function stop(req, res, next) {
  try {
    await annonceService.deactivateAllActive();

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'annonce.arret',
    });

    ok(res, { arrêté: true });
  } catch (e) {
    next(e);
  }
}

module.exports = { active, stop };
