const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/response');
const { hash, compare } = require('../utils/crypto');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const walletService = require('../services/walletService');
const otpService = require('../services/otpService');
const notificationService = require('../services/notificationService');
const securityEventService = require('../services/securityEventService');
const deviceSessionService = require('../services/deviceSessionService');
const pinService = require('../services/pinService');
const env = require('../config/env');
const { t, SUPPORTED_LANGUAGES } = require('../i18n');

function issueTokens(id, type) {
  const accessToken = signAccessToken({ id, type });
  const refreshToken = signRefreshToken({ id, type });
  return { accessToken, refreshToken };
}

// Blocage automatique après échecs répétés (exigence 9.1) : rejette la connexion (ou le
// changement de mot de passe) avant même de vérifier le mot de passe si trop d'échecs récents
// ont été journalisés pour ce numéro, pour ne pas laisser un mot de passe correct contourner
// le blocage.
async function assertNotLockedOut(telephone, evenement = 'connexion') {
  const failures = await securityEventService.countRecentFailures({
    telephone,
    evenement,
    sinceMinutes: env.security.lockoutMinutes,
  });
  if (failures >= env.security.maxFailedAttempts) {
    throw new ApiError(
      429,
      `Trop de tentatives échouées. Réessayez dans ${env.security.lockoutMinutes} minutes.`
    );
  }
}

// --- CLIENT ---------------------------------------------------------

async function clientRequestOtp(req, res, next) {
  try {
    const { telephone } = req.body;
    if (!telephone) throw new ApiError(400, 'Le numéro de téléphone est requis');
    const result = await otpService.generateOtp(telephone, 'inscription');
    ok(res, { sent: true, devCode: result.devCode });
  } catch (e) {
    next(e);
  }
}

async function clientRegister(req, res, next) {
  try {
    const { nom, prenom, telephone, email, motDePasse, otp, appareil, os } = req.body;
    if (!nom || !prenom || !telephone || !motDePasse || !otp) {
      throw new ApiError(400, 'nom, prenom, telephone, motDePasse et otp sont requis');
    }
    const existing = await userService.findByPhone(telephone);
    if (existing) throw new ApiError(409, 'Un compte existe déjà avec ce numéro');

    await otpService.verifyOtp(telephone, otp, 'inscription');

    const motDePasseHash = await hash(motDePasse);
    const user = await userService.createUser({ nom, prenom, telephone, email, motDePasseHash });
    await walletService.createWallet(user.id, 'client');
    await notificationService.notify({
      destinataireId: user.id,
      typeDestinataire: 'client',
      type: 'système',
      titre: t(user.langue, 'notif.welcome.title'),
      contenu: t(user.langue, 'notif.welcome.body'),
    });

    const tokens = issueTokens(user.id, 'client');
    await deviceSessionService.createSession({
      ownerType: 'client',
      ownerId: user.id,
      appareil,
      os,
      refreshToken: tokens.refreshToken,
    });
    created(res, { user: userService.toPublic(user), ...tokens });
  } catch (e) {
    next(e);
  }
}

// Change (ou définit, à l'onboarding) le code PIN AfriPay. Si un PIN existe déjà, `pinActuel`
// doit le confirmer — sans quoi une session volée (token encore valide) suffirait à remplacer
// le PIN sans le connaître.
async function clientSetPin(req, res, next) {
  try {
    const { pin, pinActuel } = req.body;
    if (!pin || !/^\d{4,6}$/.test(pin)) throw new ApiError(400, 'Le code PIN doit contenir 4 à 6 chiffres');

    const user = await userService.findById(req.auth.id);
    await pinService.assertCurrentPinForChange({
      account: user,
      acteurType: 'client',
      acteurId: req.auth.id,
      currentPin: pinActuel,
      req,
    });

    const pinHash = await hash(pin);
    await userService.setPin(req.auth.id, pinHash);
    await securityEventService.log({
      acteurType: 'client',
      acteurId: req.auth.id,
      telephone: user.telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'code_pin',
      ip: req.ip,
    });
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

// Change le mot de passe de connexion. `motDePasseActuel` doit le confirmer — sans quoi une
// session volée (token encore valide, durée de vie 15 min) suffirait à en prendre le contrôle
// durable sans jamais avoir connu le mot de passe (même logique que clientSetPin pour le PIN).
async function clientChangePassword(req, res, next) {
  try {
    const { motDePasseActuel, motDePasse } = req.body;
    if (!motDePasseActuel || !motDePasse) {
      throw new ApiError(400, 'Le mot de passe actuel et le nouveau mot de passe sont requis');
    }
    if (motDePasse.length < 6) {
      throw new ApiError(400, 'Le nouveau mot de passe doit contenir au moins 6 caractères');
    }

    const user = await userService.findById(req.auth.id);
    if (!user) throw new ApiError(404, 'Utilisateur introuvable');

    await assertNotLockedOut(user.telephone, 'profil_maj');

    const validPassword = await compare(motDePasseActuel, user.mot_de_passe_hash);
    if (!validPassword) {
      await securityEventService.log({
        acteurType: 'client',
        acteurId: req.auth.id,
        telephone: user.telephone,
        evenement: 'profil_maj',
        resultat: 'echec',
        détails: 'mot_de_passe',
        ip: req.ip,
      });
      throw new ApiError(401, 'Mot de passe actuel incorrect');
    }

    const motDePasseHash = await hash(motDePasse);
    await userService.setPassword(req.auth.id, motDePasseHash);
    await securityEventService.log({
      acteurType: 'client',
      acteurId: req.auth.id,
      telephone: user.telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'mot_de_passe',
      ip: req.ip,
    });
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

const RESET_OBJET = { pin: 'reinitialisation_pin', password: 'reinitialisation_mdp' };

// Étape 1 de la récupération (code PIN ou mot de passe oubliés) : envoie l'OTP au numéro fourni,
// non authentifiée puisque c'est justement le cas où le client ne peut pas se connecter
// normalement. Le compte doit exister — sinon rien à réinitialiser.
async function clientRequestResetOtp(req, res, next) {
  try {
    const { telephone, type } = req.body;
    const objet = RESET_OBJET[type];
    if (!telephone || !objet) throw new ApiError(400, "telephone et type ('pin' ou 'password') sont requis");

    const user = await userService.findByPhone(telephone);
    if (!user) throw new ApiError(404, 'Aucun compte trouvé avec ce numéro');

    const result = await otpService.generateOtp(telephone, objet);
    ok(res, { sent: true, devCode: result.devCode });
  } catch (e) {
    next(e);
  }
}

// Étape 2 : remplace le code PIN sans connaître l'ancien, la vérification par OTP en tenant
// lieu (c'est le sens même d'une récupération sur code oublié).
async function clientResetPin(req, res, next) {
  try {
    const { telephone, otp, pin } = req.body;
    if (!telephone || !otp) throw new ApiError(400, 'telephone et otp sont requis');
    if (!pin || !/^\d{4,6}$/.test(pin)) throw new ApiError(400, 'Le code PIN doit contenir 4 à 6 chiffres');

    const user = await userService.findByPhone(telephone);
    if (!user) throw new ApiError(404, 'Aucun compte trouvé avec ce numéro');

    await otpService.verifyOtp(telephone, otp, RESET_OBJET.pin);

    const pinHash = await hash(pin);
    await userService.setPin(user.id, pinHash);
    await securityEventService.log({
      acteurType: 'client',
      acteurId: user.id,
      telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'code_pin_reinit',
      ip: req.ip,
    });
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

// Étape 2 pour le mot de passe : révoque aussi toutes les sessions actives — un refresh token
// déjà en circulation (30 jours de validité) ne doit pas rester utilisable après coup, l'oubli
// du mot de passe pouvant tout autant masquer une perte d'accès qu'un compte compromis.
async function clientResetPassword(req, res, next) {
  try {
    const { telephone, otp, motDePasse } = req.body;
    if (!telephone || !otp) throw new ApiError(400, 'telephone et otp sont requis');
    if (!motDePasse || motDePasse.length < 6) {
      throw new ApiError(400, 'Le nouveau mot de passe doit contenir au moins 6 caractères');
    }

    const user = await userService.findByPhone(telephone);
    if (!user) throw new ApiError(404, 'Aucun compte trouvé avec ce numéro');

    await otpService.verifyOtp(telephone, otp, RESET_OBJET.password);

    const motDePasseHash = await hash(motDePasse);
    await userService.setPassword(user.id, motDePasseHash);
    await deviceSessionService.revokeAllSessions('client', user.id);
    await securityEventService.log({
      acteurType: 'client',
      acteurId: user.id,
      telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'mot_de_passe_reinit',
      ip: req.ip,
    });
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

// Persists the app's language choice server-side (users.langue) so notifications generated
// later (transfert reçu, décision KYC, etc.) render in the language the client last picked,
// even if it was set on a different device.
async function clientUpdateLanguage(req, res, next) {
  try {
    const { langue } = req.body;
    if (!SUPPORTED_LANGUAGES.includes(langue)) {
      throw new ApiError(400, `langue doit être l'une de : ${SUPPORTED_LANGUAGES.join(', ')}`);
    }
    await userService.updateProfile(req.auth.id, { langue });
    ok(res, { updated: true, langue });
  } catch (e) {
    next(e);
  }
}

async function clientLogin(req, res, next) {
  const { telephone, motDePasse, appareil, os } = req.body;
  try {
    await assertNotLockedOut(telephone);
    const user = await userService.findByPhone(telephone);
    const validPassword = user && (await compare(motDePasse, user.mot_de_passe_hash));
    if (!user || !validPassword) {
      await securityEventService.log({
        acteurType: 'client',
        acteurId: user?.id,
        telephone,
        evenement: 'connexion',
        resultat: 'echec',
        ip: req.ip,
      });
      throw new ApiError(401, 'Identifiants invalides');
    }

    await securityEventService.log({
      acteurType: 'client',
      acteurId: user.id,
      telephone,
      evenement: 'connexion',
      resultat: 'succes',
      ip: req.ip,
    });

    const tokens = issueTokens(user.id, 'client');
    await deviceSessionService.createSession({
      ownerType: 'client',
      ownerId: user.id,
      appareil,
      os,
      refreshToken: tokens.refreshToken,
    });
    ok(res, { user: userService.toPublic(user), ...tokens });
  } catch (e) {
    next(e);
  }
}

// --- MARCHAND ---------------------------------------------------------

async function merchantRequestOtp(req, res, next) {
  try {
    const { telephone } = req.body;
    if (!telephone) throw new ApiError(400, 'Le numéro de téléphone est requis');
    const result = await otpService.generateOtp(telephone, 'inscription');
    ok(res, { sent: true, devCode: result.devCode });
  } catch (e) {
    next(e);
  }
}

async function merchantRegister(req, res, next) {
  try {
    const { type, raisonSociale, rccm, ncc, telephone, email, motDePasse, otp, appareil, os } = req.body;
    if (!type || !telephone || !motDePasse || !otp) {
      throw new ApiError(400, 'type, telephone, motDePasse et otp sont requis');
    }
    if (!['entreprise', 'particulier'].includes(type)) throw new ApiError(400, 'type doit être entreprise ou particulier');

    const existing = await merchantService.findByPhone(telephone);
    if (existing) throw new ApiError(409, 'Un compte marchand existe déjà avec ce numéro');

    await otpService.verifyOtp(telephone, otp, 'inscription');

    const motDePasseHash = await hash(motDePasse);
    const merchant = await merchantService.createMerchant({
      type,
      raisonSociale,
      rccm,
      ncc,
      telephone,
      email,
      motDePasseHash,
    });
    await walletService.createWallet(merchant.id, 'marchand');

    const tokens = issueTokens(merchant.id, 'marchand');
    await deviceSessionService.createSession({
      ownerType: 'marchand',
      ownerId: merchant.id,
      appareil,
      os,
      refreshToken: tokens.refreshToken,
    });
    created(res, { merchant: merchantService.toPublic(merchant), ...tokens });
  } catch (e) {
    next(e);
  }
}

async function merchantSetPin(req, res, next) {
  try {
    const { pin, pinActuel } = req.body;
    if (!pin || !/^\d{4,6}$/.test(pin)) throw new ApiError(400, 'Le code PIN doit contenir 4 à 6 chiffres');

    const merchant = await merchantService.findById(req.auth.id);
    await pinService.assertCurrentPinForChange({
      account: merchant,
      acteurType: 'marchand',
      acteurId: req.auth.id,
      currentPin: pinActuel,
      req,
    });

    const pinHash = await hash(pin);
    await merchantService.setPin(req.auth.id, pinHash);
    await securityEventService.log({
      acteurType: 'marchand',
      acteurId: req.auth.id,
      telephone: merchant.telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'code_pin',
      ip: req.ip,
    });
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

async function merchantLogin(req, res, next) {
  const { telephone, motDePasse, appareil, os } = req.body;
  try {
    await assertNotLockedOut(telephone);
    const merchant = await merchantService.findByPhone(telephone);
    const validPassword = merchant && (await compare(motDePasse, merchant.mot_de_passe_hash));
    if (!merchant || !validPassword) {
      await securityEventService.log({
        acteurType: 'marchand',
        acteurId: merchant?.id,
        telephone,
        evenement: 'connexion',
        resultat: 'echec',
        ip: req.ip,
      });
      throw new ApiError(401, 'Identifiants invalides');
    }

    await securityEventService.log({
      acteurType: 'marchand',
      acteurId: merchant.id,
      telephone,
      evenement: 'connexion',
      resultat: 'succes',
      ip: req.ip,
    });

    const tokens = issueTokens(merchant.id, 'marchand');
    await deviceSessionService.createSession({
      ownerType: 'marchand',
      ownerId: merchant.id,
      appareil,
      os,
      refreshToken: tokens.refreshToken,
    });
    ok(res, { merchant: merchantService.toPublic(merchant), ...tokens });
  } catch (e) {
    next(e);
  }
}

// Objets distincts de ceux du client (RESET_OBJET) bien que le scénario soit identique : un
// numéro de téléphone peut être enregistré à la fois côté clients et côté merchants (deux tables,
// deux contraintes UNIQUE indépendantes), et otpService.verifyOtp ne vérifie que (téléphone,
// objet) — avec le même objet, un OTP de réinitialisation marchand aurait aussi pu servir à
// réinitialiser le compte client du même numéro (et réciproquement).
const RESET_OBJET_MARCHAND = { pin: 'reinitialisation_pin_marchand', password: 'reinitialisation_mdp_marchand' };

// Étape 1 de la récupération marchand (code PIN ou mot de passe oubliés) — voir
// clientRequestResetOtp, même logique côté merchants.
async function merchantRequestResetOtp(req, res, next) {
  try {
    const { telephone, type } = req.body;
    const objet = RESET_OBJET_MARCHAND[type];
    if (!telephone || !objet) throw new ApiError(400, "telephone et type ('pin' ou 'password') sont requis");

    const merchant = await merchantService.findByPhone(telephone);
    if (!merchant) throw new ApiError(404, 'Aucun compte trouvé avec ce numéro');

    const result = await otpService.generateOtp(telephone, objet);
    ok(res, { sent: true, devCode: result.devCode });
  } catch (e) {
    next(e);
  }
}

// Étape 2 : remplace le code PIN sans connaître l'ancien, la vérification par OTP en tenant lieu.
async function merchantResetPin(req, res, next) {
  try {
    const { telephone, otp, pin } = req.body;
    if (!telephone || !otp) throw new ApiError(400, 'telephone et otp sont requis');
    if (!pin || !/^\d{4,6}$/.test(pin)) throw new ApiError(400, 'Le code PIN doit contenir 4 à 6 chiffres');

    const merchant = await merchantService.findByPhone(telephone);
    if (!merchant) throw new ApiError(404, 'Aucun compte trouvé avec ce numéro');

    await otpService.verifyOtp(telephone, otp, RESET_OBJET_MARCHAND.pin);

    const pinHash = await hash(pin);
    await merchantService.setPin(merchant.id, pinHash);
    await securityEventService.log({
      acteurType: 'marchand',
      acteurId: merchant.id,
      telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'code_pin_reinit',
      ip: req.ip,
    });
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

// Étape 2 pour le mot de passe : révoque aussi toutes les sessions actives, comme côté client.
async function merchantResetPassword(req, res, next) {
  try {
    const { telephone, otp, motDePasse } = req.body;
    if (!telephone || !otp) throw new ApiError(400, 'telephone et otp sont requis');
    if (!motDePasse || motDePasse.length < 6) {
      throw new ApiError(400, 'Le nouveau mot de passe doit contenir au moins 6 caractères');
    }

    const merchant = await merchantService.findByPhone(telephone);
    if (!merchant) throw new ApiError(404, 'Aucun compte trouvé avec ce numéro');

    await otpService.verifyOtp(telephone, otp, RESET_OBJET_MARCHAND.password);

    const motDePasseHash = await hash(motDePasse);
    await merchantService.setPassword(merchant.id, motDePasseHash);
    await deviceSessionService.revokeAllSessions('marchand', merchant.id);
    await securityEventService.log({
      acteurType: 'marchand',
      acteurId: merchant.id,
      telephone,
      evenement: 'profil_maj',
      resultat: 'succes',
      détails: 'mot_de_passe_reinit',
      ip: req.ip,
    });
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

// --- COMMUN ---------------------------------------------------------

async function refresh(req, res, next) {
  try {
    const { refreshToken, appareil, os } = req.body;
    if (!refreshToken) throw new ApiError(400, 'refreshToken requis');
    const payload = verifyRefreshToken(refreshToken);
    // Pour un compte admin, le rôle (et le nom, utilisé dans le journal d'audit) doivent être
    // reconduits, sinon un accessToken rafraîchi perdrait ses droits (requireRole).
    const extra = payload.type === 'admin' ? { role: payload.role, nom: payload.nom } : {};
    const accessToken = signAccessToken({ id: payload.id, type: payload.type, ...extra });
    const newRefreshToken = signRefreshToken({ id: payload.id, type: payload.type, ...extra });

    if (payload.type === 'client' || payload.type === 'marchand') {
      const accepted = await deviceSessionService.rotateSession({
        ownerType: payload.type,
        ownerId: payload.id,
        appareil,
        os,
        oldRefreshToken: refreshToken,
        newRefreshToken,
      });
      if (!accepted) throw new ApiError(401, 'Session déconnectée à distance. Veuillez vous reconnecter.');
    }

    ok(res, { accessToken, refreshToken: newRefreshToken });
  } catch (e) {
    if (e instanceof ApiError) return next(e);
    next(new ApiError(401, 'Refresh token invalide ou expiré'));
  }
}

async function listMySessions(req, res, next) {
  try {
    const sessions = await deviceSessionService.listSessions(req.auth.type, req.auth.id);
    ok(res, sessions);
  } catch (e) {
    next(e);
  }
}

async function revokeMySession(req, res, next) {
  try {
    await deviceSessionService.revokeSession(req.auth.type, req.auth.id, req.params.id);
    ok(res, { revoked: true });
  } catch (e) {
    next(e);
  }
}

async function me(req, res, next) {
  try {
    if (req.auth.type === 'client') {
      const user = await userService.findById(req.auth.id);
      if (!user) throw new ApiError(404, 'Utilisateur introuvable');
      return ok(res, { type: 'client', user: userService.toPublic(user) });
    }
    if (req.auth.type === 'marchand') {
      const merchant = await merchantService.findById(req.auth.id);
      if (!merchant) throw new ApiError(404, 'Marchand introuvable');
      return ok(res, { type: 'marchand', merchant: merchantService.toPublic(merchant) });
    }
    throw new ApiError(403, 'Type de compte non pris en charge');
  } catch (e) {
    next(e);
  }
}

module.exports = {
  clientRequestOtp,
  clientRegister,
  clientSetPin,
  clientChangePassword,
  clientRequestResetOtp,
  clientResetPin,
  clientResetPassword,
  clientUpdateLanguage,
  clientLogin,
  merchantRequestOtp,
  merchantRegister,
  merchantSetPin,
  merchantLogin,
  merchantRequestResetOtp,
  merchantResetPin,
  merchantResetPassword,
  refresh,
  me,
  listMySessions,
  revokeMySession,
};
