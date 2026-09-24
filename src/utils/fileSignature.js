// Vérifie que le contenu réel d'un fichier uploadé correspond à son mimetype déclaré, en
// inspectant ses premiers octets (magic bytes) plutôt que de faire confiance à un en-tête
// contrôlable par le client. Défense en profondeur en complément du filtre par mimetype de
// middleware/upload.js.
const SIGNATURES = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF.... (WEBP confirmé aux octets 8-11)
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],
};

function matchesSignature(buffer, mimetype) {
  const sigs = SIGNATURES[mimetype];
  if (!sigs || !buffer || buffer.length < 4) return false;
  if (mimetype === 'image/webp') {
    const isRiff = sigs[0].every((byte, i) => buffer[i] === byte);
    const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
    return isRiff && isWebp;
  }
  return sigs.some((sig) => sig.every((byte, i) => buffer[i] === byte));
}

module.exports = { matchesSignature };
