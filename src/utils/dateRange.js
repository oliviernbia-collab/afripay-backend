// Normalise une plage de dates reçue en query string (dateDebut/dateFin).
// Si dateFin est une date "nue" (YYYY-MM-DD, 10 caractères), on l'étend à la fin de
// journée (23:59:59) pour que le jour sélectionné soit bien inclus dans le filtre,
// au lieu d'être comparé à minuit (ce qui exclurait quasiment toute la journée).
function normalizeDateRange({ dateDebut, dateFin } = {}) {
  const debut = dateDebut || undefined;
  let fin = dateFin || undefined;
  if (fin && fin.length === 10) fin = `${fin} 23:59:59`;
  return { dateDebut: debut, dateFin: fin };
}

module.exports = { normalizeDateRange };
