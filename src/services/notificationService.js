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

module.exports = { notify, listForUser, markRead, markAllRead };
