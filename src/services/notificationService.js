const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { normalizeDateRange } = require('../utils/dateRange');
const realtime = require('../realtime/socket');

// `titre`/`contenu` : rendu français par défaut, pour le back-office web (outil interne, une
// seule langue) et comme repli mobile si aucune clé n'est fournie (message admin composé
// librement). `titreCle`/`contenuCle`/`params` (optionnels) : permettent aux apps mobiles de
// retraduire la notification dans la langue active à l'AFFICHAGE plutôt que figée à la création
// (voir database/schema.sql) — `params` ne doit contenir que des valeurs brutes, jamais du texte
// déjà traduit (la sous-traduction, ex. un statut, se fait aussi côté client).
//
// Point de passage UNIQUE pour toute notification créée dans l'app (transfert reçu, retrait
// confirmé/échoué, KYC décidé, bienvenue...) : émettre l'événement temps réel ICI, plutôt que dans
// chaque appelant, suffit donc à les couvrir tous d'un coup (voir realtime/socket.js).
async function notify({ destinataireId, typeDestinataire, type, titre, contenu, titreCle, contenuCle, params }) {
  const id = uuidv4();
  const dateCreation = new Date();
  await query(
    `INSERT INTO notifications (id, destinataire_id, type_destinataire, type, titre, contenu, titre_cle, contenu_cle, params, date_creation)
     VALUES (:id, :destinataireId, :typeDestinataire, :type, :titre, :contenu, :titreCle, :contenuCle, :params, :dateCreation)`,
    {
      id,
      destinataireId,
      typeDestinataire,
      type,
      titre,
      contenu,
      titreCle: titreCle || null,
      contenuCle: contenuCle || null,
      params: params ? JSON.stringify(params) : null,
      dateCreation,
    }
  );
  realtime.emitToOwner(typeDestinataire, destinataireId, 'notification:new', {
    id,
    type,
    titre,
    contenu,
    titre_cle: titreCle || null,
    contenu_cle: contenuCle || null,
    params: params || null,
    lu: 0,
    date_creation: dateCreation.toISOString(),
  });
  return id;
}

// Diffusion en masse (ex: "tous les clients") — un seul INSERT multi-lignes par lot de 500
// pour rester raisonnable en taille de requête même sur une base à plusieurs milliers de comptes.
async function notifyMany(destinataireIds, typeDestinataire, type, titre, contenu) {
  const CHUNK_SIZE = 500;
  let total = 0;
  for (let i = 0; i < destinataireIds.length; i += CHUNK_SIZE) {
    const chunk = destinataireIds.slice(i, i + CHUNK_SIZE);
    const values = [];
    const placeholders = chunk.map((destinataireId) => {
      values.push(uuidv4(), destinataireId, typeDestinataire, type, titre, contenu);
      return '(?, ?, ?, ?, ?, ?)';
    });
    await query(
      `INSERT INTO notifications (id, destinataire_id, type_destinataire, type, titre, contenu)
       VALUES ${placeholders.join(', ')}`,
      values
    );
    total += chunk.length;
  }
  return total;
}

async function listForUser(destinataireId, typeDestinataire, { limit = 50, offset = 0, dateDebut, dateFin } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const conditions = ['destinataire_id = :destinataireId', 'type_destinataire = :typeDestinataire'];
  const params = { destinataireId, typeDestinataire, limit, offset };
  if (debut) {
    conditions.push('date_creation >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('date_creation <= :dateFin');
    params.dateFin = fin;
  }
  return query(
    `SELECT * FROM notifications WHERE ${conditions.join(' AND ')}
     ORDER BY date_creation DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function markRead(id, destinataireId) {
  await query('UPDATE notifications SET lu = 1 WHERE id = :id AND destinataire_id = :destinataireId', {
    id,
    destinataireId,
  });
}

async function markAllRead(destinataireId, typeDestinataire) {
  await query(
    'UPDATE notifications SET lu = 1 WHERE destinataire_id = :destinataireId AND type_destinataire = :typeDestinataire',
    { destinataireId, typeDestinataire }
  );
}

module.exports = { notify, notifyMany, listForUser, markRead, markAllRead };
