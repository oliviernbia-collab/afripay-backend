const nodemailer = require('nodemailer');
const env = require('../config/env');

let transporter = null;
function getTransporter() {
  if (!env.email.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.email.host,
      port: env.email.port,
      secure: env.email.secure,
      auth: { user: env.email.user, pass: env.email.password },
    });
  }
  return transporter;
}

// Envoie un e-mail réel si SMTP est configuré (voir config/env.js) ; sinon le simule en le loggant
// en console en dev — même philosophie que OTP_DEV_ECHO pour l'OTP mocké : un admin qui teste en
// local sans compte SMTP voit quand même le contenu qui AURAIT été envoyé, plutôt que l'action
// (ex. répondre à un message de contact) échoue silencieusement ou bloque pour une raison externe
// au métier. Ne lève jamais : l'appelant décide quoi faire d'un envoi non abouti (ex. le signaler
// à l'admin dans la réponse HTTP), sans que ça invalide l'action déjà enregistrée en base.
async function sendMail({ to, subject, text }) {
  const t = getTransporter();
  if (!t) {
    if (env.nodeEnv !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`[emailService] SMTP non configuré — e-mail simulé :\nÀ : ${to}\nObjet : ${subject}\n\n${text}\n`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[emailService] SMTP non configuré — e-mail à ${to} non envoyé ("${subject}").`);
    }
    return { envoyé: false, simulé: env.nodeEnv !== 'production' };
  }

  try {
    await t.sendMail({ from: env.email.from, to, subject, text });
    return { envoyé: true, simulé: false };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[emailService] Échec d'envoi à ${to} :`, e.message);
    return { envoyé: false, simulé: false, erreur: e.message };
  }
}

module.exports = { sendMail };
