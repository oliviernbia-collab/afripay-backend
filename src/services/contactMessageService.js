const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');
const { normalizeDateRange } = require('../utils/dateRange');
const realtime = require('../realtime/socket');

async function create({ nom, email, telephone, message }) {
  const id = uuidv4();
  await query(
    `INSERT INTO messages_contact (id, nom, email, telephone, message)
     VALUES (:id, :nom, :email, :telephone, :message)`,
    { id, nom, email: email || null, telephone: telephone || null, message }
  );
  // Visible immédiatement dans le back-office (voir web/src/pages/Contact*), sans que l'admin ait
  // à recharger la page pour découvrir un nouveau message.
  realtime.emitToAdmins('admin:contact_new', { id, nom, email: email || null, telephone: telephone || null });
  return id;
}

async function list({ repondu, dateDebut, dateFin, limit = 50, offset = 0 } = {}) {
  const { dateDebut: debut, dateFin: fin } = normalizeDateRange({ dateDebut, dateFin });
  const conditions = [];
  const params = { limit, offset };
  if (repondu === 'true' || repondu === true) {
    conditions.push('repondu = 1');
  } else if (repondu === 'false' || repondu === false) {
    conditions.push('repondu = 0');
  }
  if (debut) {
    conditions.push('date_creation >= :dateDebut');
    params.dateDebut = debut;
  }
  if (fin) {
    conditions.push('date_creation <= :dateFin');
    params.dateFin = fin;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return query(
    `SELECT * FROM messages_contact ${where} ORDER BY date_creation DESC LIMIT :limit OFFSET :offset`,
    params
  );
}

async function findById(id) {
  const rows = await query('SELECT * FROM messages_contact WHERE id = :id LIMIT 1', { id });
  return rows[0] || null;
}

async function reply(id, { reponse, adminId }) {
  const result = await query(
    `UPDATE messages_contact
     SET repondu = 1, reponse = :reponse, repondu_par = :adminId, date_reponse = NOW()
     WHERE id = :id`,
    { id, reponse, adminId: adminId || null }
  );
  return result.affectedRows > 0;
}

module.exports = { create, list, findById, reply };
