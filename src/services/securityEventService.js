const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');

// Journalise un événement de sécurité (connexion, tentative de PIN, modification de
// profil — exigence 9.1). Comme auditService.log, ne doit jamais faire échouer
// l'opération métier qu'il documente : erreur avalée + loggée côté serveur.
async function log({ acteurType, acteurId, telephone, evenement, resultat, détails, ip }) {
  const id = uuidv4();
  try {
    await query(
      `INSERT INTO security_events (id, acteur_type, acteur_id, telephone, evenement, resultat, détails, adresse_ip)
       VALUES (:id, :acteurType, :acteurId, :telephone, :evenement, :resultat, :detailsVal, :ip)`,
      {
        id,
        acteurType,
        acteurId: acteurId || null,
        telephone: telephone || null,
        evenement,
        resultat,
        detailsVal: détails || null,
        ip: ip || null,
      }
    );
  } catch (e) {
    console.error('[security] échec de journalisation (ignoré):', evenement, e.message);
  }
  return id;
}

// Compte les échecs récents pour un (telephone, evenement) sur une fenêtre glissante —
// base du blocage automatique après échecs répétés.
async function countRecentFailures({ telephone, evenement, sinceMinutes }) {
  if (!telephone) return 0;
  const rows = await query(
    `SELECT COUNT(*) AS total FROM security_events
     WHERE telephone = :telephone AND evenement = :evenement AND resultat = 'echec'
       AND date_heure >= DATE_SUB(NOW(), INTERVAL :sinceMinutes MINUTE)`,
    { telephone, evenement, sinceMinutes }
  );
  return Number(rows[0]?.total || 0);
}

module.exports = { log, countRecentFailures };
