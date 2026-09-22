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
const env = require('../config/env');

function issueTokens(id, type) {
  const accessToken = signAccessToken({ id, type });
  const refreshToken = signRefreshToken({ id, type });
  return { accessToken, refreshToken };
}

// Blocage automatique après échecs répétés (exigence 9.1) : rejette la connexion avant
// même de vérifier le mot de passe si trop d'échecs récents ont été journalisés pour ce
// numéro, pour ne pas laisser un mot de passe correct contourner le blocage.
async function assertNotLockedOut(telephone) {
  const failures = await securityEventService.countRecentFailures({
    telephone,
    evenement: 'connexion',
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
      titre: 'Bienvenue sur AfriPay',
      contenu: 'Votre compte a été créé. Complétez votre KYC pour débloquer le paiement par paume de main.',
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

async function clientSetPin(req, res, next) {
  try {
    const { pin } = req.body;
    if (!pin || !/^\d{4,6}$/.test(pin)) throw new ApiError(400, 'Le code PIN doit contenir 4 à 6 chiffres');
    const pinHash = await hash(pin);
    await userService.setPin(req.auth.id, pinHash);
    await securityEventService.log({
      acteurType: 'client',
      acteurId: req.auth.id,
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
    const { pin } = req.body;
    if (!pin || !/^\d{4,6}$/.test(pin)) throw new ApiError(400, 'Le code PIN doit contenir 4 à 6 chiffres');
    const pinHash = await hash(pin);
    await merchantService.setPin(req.auth.id, pinHash);
    await securityEventService.log({
      acteurType: 'marchand',
      acteurId: req.auth.id,
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
  clientLogin,
  merchantRequestOtp,
  merchantRegister,
  merchantSetPin,
  merchantLogin,
  refresh,
  me,
  listMySessions,
  revokeMySession,
};
