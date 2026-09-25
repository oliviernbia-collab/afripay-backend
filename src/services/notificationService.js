const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');

async function notify({ destinataireId, typeDestinataire, type, titre, contenu }) {
  const id = uuidv4();
  await query(
    `INSERT INTO notifications (id, destinataire_id, type_destinataire, type, titre, contenu)
     VALUES (:id, :destinataireId, :typeDestinataire, :type, :titre, :contenu)`,
    { id, destinataireId, typeDestinataire, type, titre, contenu }
  );
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

async function listForUser(destinataireId, typeDestinataire, { limit = 50, offset = 0 } = {}) {
  return query(
    `SELECT * FROM notifications WHERE destinataire_id = :destinataireId AND type_destinataire = :typeDestinataire
     ORDER BY date_creation DESC LIMIT :limit OFFSET :offset`,
    { destinataireId, typeDestinataire, limit, offset }
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
