const { query, pool } = require('../config/db');
const ApiError = require('../utils/ApiError');

const EDITABLE_ROLES = ['conformite', 'support'];

// Cache mémoire { role: Set<permission_code> } pour conformite/support, rechargé au premier accès
// puis invalidé après chaque écriture — évite une requête SQL à chaque appel de requirePermission.
let cache = null;

async function loadCache() {
  const rows = await query('SELECT role, permission_code FROM role_permissions');
  const next = { conformite: new Set(), support: new Set() };
  for (const row of rows) {
    if (next[row.role]) next[row.role].add(row.permission_code);
  }
  cache = next;
  return cache;
}

async function ensureCache() {
  if (!cache) await loadCache();
  return cache;
}

function invalidateCache() {
  cache = null;
}

async function listPermissions() {
  return query('SELECT code, categorie, libelle, description FROM permissions ORDER BY categorie, libelle');
}

async function listRolePermissions() {
  return query('SELECT role, permission_code FROM role_permissions');
}

// 'super_admin' contourne toujours la vérification (voir commentaire dans database/schema.sql) :
// il n'a jamais de ligne dans role_permissions, donc getPermissionsForRole lui renvoie tous les
// codes connus plutôt que de dépendre d'un éventuel seed manquant.
async function getPermissionsForRole(role) {
  if (role === 'super_admin') {
    const rows = await listPermissions();
    return rows.map((r) => r.code);
  }
  const loaded = await ensureCache();
  return Array.from(loaded[role] || []);
}

async function roleHasPermission(role, code) {
  if (role === 'super_admin') return true;
  const loaded = await ensureCache();
  return Boolean(loaded[role] && loaded[role].has(code));
}

// Remplace intégralement les permissions de 'conformite' et 'support' (celles présentes dans
// `rolePermissions`, les autres clés sont ignorées) en une transaction atomique.
async function setRolePermissions(rolePermissions) {
  const roles = Object.keys(rolePermissions).filter((r) => EDITABLE_ROLES.includes(r));
  if (!roles.length) throw new ApiError(400, 'Aucun rôle éditable fourni');

  const knownRows = await query('SELECT code FROM permissions');
  const knownCodes = new Set(knownRows.map((r) => r.code));

  for (const role of roles) {
    const codes = rolePermissions[role];
    if (!Array.isArray(codes)) throw new ApiError(400, `permissions pour "${role}" doit être un tableau`);
    for (const code of codes) {
      if (!knownCodes.has(code)) throw new ApiError(400, `Permission inconnue : ${code}`);
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const role of roles) {
      await conn.query('DELETE FROM role_permissions WHERE role = ?', [role]);
      const codes = rolePermissions[role];
      if (codes.length) {
        const values = codes.map((code) => [role, code]);
        await conn.query('INSERT INTO role_permissions (role, permission_code) VALUES ?', [values]);
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  invalidateCache();
}

module.exports = {
  listPermissions,
  listRolePermissions,
  getPermissionsForRole,
  roleHasPermission,
  setRolePermissions,
};
