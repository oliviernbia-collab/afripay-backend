const locales = require('./locales');

const SUPPORTED_LANGUAGES = ['fr', 'en', 'es'];
const DEFAULT_LANGUAGE = 'fr';

// Renders server-generated, user-facing text (notification titles/bodies, system transaction
// labels) in the recipient's stored language (users.langue). This intentionally does NOT cover
// validation/error messages thrown across the API (ApiError) — those remain French; localizing
// them would mean touching every controller and is a separate, larger effort.
function t(langue, key, params = {}) {
  const lang = SUPPORTED_LANGUAGES.includes(langue) ? langue : DEFAULT_LANGUAGE;
  const template = locales[lang][key] || locales[DEFAULT_LANGUAGE][key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] !== undefined && params[name] !== null ? params[name] : ''));
}

module.exports = { t, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };
