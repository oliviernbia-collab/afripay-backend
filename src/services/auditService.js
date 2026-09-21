const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { normalizeDateRange } = require('../utils/dateRange');

// Journalise une action sensible effectuée depuis le back-office (section Audit Logs).
// Ne doit JAMAIS faire échouer l'action métier qu'elle documente : une erreur ici (DB
// momentanément indisponible, etc.) est avalée et journalisée côté serveur uniquement —
// sans quoi une panne de la table d'audit bloquerait, par ex., la création d'un compte admin
// alors que l'opération elle-même a déjà réussi (voir incident constaté pendant les tests).
async function log({ adminId, adminNom, action, cibleType, cibleId, détails }) {
  const id = uuidv4();
  try {
    await query(
      // NB: mysql2 ne reconnaît pas les caractères accentués dans les noms de paramètres nommés
      // (:détails) -> placeholder ASCII ':detailsVal', la colonne SQL reste 'détails'.
      `INSERT INTO audit_logs (id, admin_id, admin_nom, action, cible_type, cible_id, détails)
       VALUES (:id, :adminId, :adminNom, :action, :cibleType, :cibleId, :detailsVal)`,
      {
        id,
        adminId: adminId || null,
        adminNom: adminNom || null,
        action,
        cibleType: cibleType || null,
        cibleId: cibleId || null,
        detailsVal: détails ? JSON.stringify(détails) : null,
      }
    );
  } catch (e) {
    console.error('[audit] échec de journalisation (action ignorée, non bloquante):', action, e.message);
  }
  return id;
}

async function list({ action, adminId, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const conditions = [];
  const params = { limit, offset };
  if (action) {
    conditions.push('action = :action');
    params.action = action;
  }
  if (adminId) {
    conditions.push('admin_id = :adminId');
    params.adminId = adminId;
  }
  if (debut) {
    conditions.push('date_heure >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('date_heure <= :dateFin');
    params.dateFin = fin;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(`SELECT * FROM audit_logs ${where} ORDER BY date_heure DESC LIMIT :limit OFFSET :offset`, params);
}

module.exports = { log, list };
