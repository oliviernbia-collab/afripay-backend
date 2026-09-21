const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/response');
const { hash, compare } = require('../utils/crypto');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const userService = require('../services/userService');
const merchantService = require('../services/merchantService');
const walletService = require('../services/walletService');
const otpService = require('../services/otpService');
const notificationService = require('../services/notificationService');

function issueTokens(id, type) {
  const accessToken = signAccessToken({ id, type });
  const refreshToken = signRefreshToken({ id, type });
  return { accessToken, refreshToken };
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
    const { nom, prenom, telephone, email, motDePasse, otp } = req.body;
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
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

async function clientLogin(req, res, next) {
  try {
    const { telephone, motDePasse } = req.body;
    const user = await userService.findByPhone(telephone);
    if (!user) throw new ApiError(401, 'Identifiants invalides');
    const validPassword = await compare(motDePasse, user.mot_de_passe_hash);
    if (!validPassword) throw new ApiError(401, 'Identifiants invalides');

    const tokens = issueTokens(user.id, 'client');
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
    const { type, raisonSociale, rccm, ncc, telephone, email, motDePasse, otp } = req.body;
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
    ok(res, { updated: true });
  } catch (e) {
    next(e);
  }
}

async function merchantLogin(req, res, next) {
  try {
    const { telephone, motDePasse } = req.body;
    const merchant = await merchantService.findByPhone(telephone);
    if (!merchant) throw new ApiError(401, 'Identifiants invalides');
    const validPassword = await compare(motDePasse, merchant.mot_de_passe_hash);
    if (!validPassword) throw new ApiError(401, 'Identifiants invalides');

    const tokens = issueTokens(merchant.id, 'marchand');
    ok(res, { merchant: merchantService.toPublic(merchant), ...tokens });
  } catch (e) {
    next(e);
  }
}

// --- COMMUN ---------------------------------------------------------

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new ApiError(400, 'refreshToken requis');
    const payload = verifyRefreshToken(refreshToken);
    // Pour un compte admin, le rôle (et le nom, utilisé dans le journal d'audit) doivent être
    // reconduits, sinon un accessToken rafraîchi perdrait ses droits (requireRole).
    const extra = payload.type === 'admin' ? { role: payload.role, nom: payload.nom } : {};
    const accessToken = signAccessToken({ id: payload.id, type: payload.type, ...extra });
    const newRefreshToken = signRefreshToken({ id: payload.id, type: payload.type, ...extra });
    ok(res, { accessToken, refreshToken: newRefreshToken });
  } catch (e) {
    next(new ApiError(401, 'Refresh token invalide ou expiré'));
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
};
