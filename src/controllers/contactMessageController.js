const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/response');
const contactMessageService = require('../services/contactMessageService');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');

// Endpoint PUBLIC (pas d'authentification) : soumis depuis le formulaire de contact de la page
// d'accueil du site web (web/src/pages/Landing.jsx, section #contact).
async function create(req, res, next) {
  try {
    const { nom, email, telephone, message } = req.body;
    if (!nom || !nom.trim()) throw new ApiError(400, 'nom requis');
    if (!message || !message.trim()) throw new ApiError(400, 'message requis');
    if (!(email && email.trim()) && !(telephone && telephone.trim())) {
      throw new ApiError(400, 'email ou téléphone requis, pour pouvoir vous recontacter');
    }

    const id = await contactMessageService.create({
      nom: nom.trim(),
      email: email?.trim(),
      telephone: telephone?.trim(),
      message: message.trim(),
    });

    ok(res, { id, envoyé: true });
  } catch (e) {
    next(e);
  }
}

async function list(req, res, next) {
  try {
    const { repondu, dateDebut, dateFin, limit, offset } = req.query;
    ok(
      res,
      await contactMessageService.list({
        repondu,
        dateDebut,
        dateFin,
        limit: Number(limit) || 50,
        offset: Number(offset) || 0,
      })
    );
  } catch (e) {
    next(e);
  }
}

async function reply(req, res, next) {
  try {
    const { reponse } = req.body;
    if (!reponse || !reponse.trim()) throw new ApiError(400, 'reponse requise');

    const existing = await contactMessageService.findById(req.params.id);
    if (!existing) throw new ApiError(404, 'Message introuvable');

    await contactMessageService.reply(req.params.id, { reponse: reponse.trim(), adminId: req.auth.id });

    // L'auteur n'a pas forcément laissé d'e-mail (le téléphone seul est accepté à la création) —
    // dans ce cas on ne tente même pas l'envoi, pas d'erreur à signaler, juste "pas d'e-mail".
    let email = { envoyé: false, simulé: false };
    if (existing.email) {
      email = await emailService.sendMail({
        to: existing.email,
        subject: 'AfriPay — Réponse à votre message',
        text:
          `Bonjour ${existing.nom},\n\n` +
          `Vous avez écrit à AfriPay :\n« ${existing.message} »\n\n` +
          `Notre réponse :\n${reponse.trim()}\n\n` +
          `— L'équipe AfriPay`,
      });
    }

    await auditService.log({
      adminId: req.auth.id,
      adminNom: req.auth.nom,
      action: 'message_contact.reponse',
      cibleType: 'message_contact',
      cibleId: req.params.id,
      détails: { emailEnvoyé: email.envoyé, emailSimulé: email.simulé },
    });

    ok(res, { répondu: true, emailEnvoyé: email.envoyé, emailSimulé: email.simulé, aUnEmail: Boolean(existing.email) });
  } catch (e) {
    next(e);
  }
}

module.exports = { create, list, reply };
