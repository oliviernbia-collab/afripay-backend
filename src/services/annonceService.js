const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/db');

// Alimentée automatiquement par adminController.sendNotification quand un admin diffuse une
// notification à "Tous les clients ou marchands" (pas de formulaire dédié : voir discussion produit
// — la bannière publique de la page d'accueil REFLÈTE simplement la dernière diffusion générale,
// au lieu d'être gérée séparément avec ses propres dates). `dateFin` est fixée loin dans le futur :
// la bannière reste affichée jusqu'au prochain envoi "Tous les clients ou marchands", qui la
// remplace via replaceActive() ci-dessous — ce n'est pas un vrai TTL éditorial.
const VISIBLE_DURATION_MS = 365 * 24 * 3600 * 1000;

// Appelée avant chaque nouvelle diffusion générale (replaceActive) pour ne garder qu'une bannière
// active à la fois, et directement par annonceController.stop quand un admin clique "Arrêter le
// bandeau" (sans relancer de diffusion) — seul moyen de faire disparaître le bandeau avant qu'une
// nouvelle notification "Tous les clients ou marchands" ne le remplace.
async function deactivateAllActive() {
  await query('UPDATE annonces SET active = 0 WHERE active = 1');
}

// Remplace la bannière publique courante par ce nouveau message (désactive l'ancienne d'abord, une
// seule diffusion générale doit être visible à la fois sur la page d'accueil).
async function replaceActive({ message, adminId }) {
  await deactivateAllActive();
  const id = uuidv4();
  const debut = new Date();
  const fin = new Date(debut.getTime() + VISIBLE_DURATION_MS);
  await query(
    `INSERT INTO annonces (id, message, date_debut, date_fin, active, cree_par)
     VALUES (:id, :message, :debut, :fin, 1, :adminId)`,
    { id, message, debut, fin, adminId: adminId || null }
  );
  return id;
}

// Annonce(s) à afficher MAINTENANT sur la page d'accueil publique : actives et dans leur fenêtre
// de validité (en pratique, au plus une seule — voir replaceActive ci-dessus).
async function listActive() {
  return query(
    `SELECT id, message, date_debut, date_fin FROM annonces
     WHERE active = 1 AND date_debut <= NOW() AND date_fin >= NOW()
     ORDER BY date_creation DESC`
  );
}

module.exports = { replaceActive, deactivateAllActive, listActive };
