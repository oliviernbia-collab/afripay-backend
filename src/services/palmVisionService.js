const tf = require('@tensorflow/tfjs');
require('@tensorflow/tfjs-backend-cpu');
const handPoseDetection = require('@tensorflow-models/hand-pose-detection');
const { Jimp } = require('jimp');
const ApiError = require('../utils/ApiError');

/**
 * RECONNAISSANCE DE PAUME — PIPELINE LOCAL (SANS API PAYANTE)
 * ---------------------------------------------------------------------
 * Remplace le mock QR-code (voir biometricService.js) et l'intégration Tencent PalmAI jamais
 * activée (compte entreprise payant, non disponible ici) par un vrai traitement d'image, calculé
 * entièrement côté serveur avec des bibliothèques open-source (aucune clé API, aucun appel réseau
 * externe) :
 *   1. Localisation de la main dans la photo (TensorFlow.js + hand-pose-detection, backend CPU
 *      pur JS — pas de compilation native, fonctionne tel quel sur ce poste Windows).
 *   2. Recadrage/rotation de la zone de paume pour obtenir un patch normalisé (centré, orienté),
 *      via un ré-échantillonnage bilinéaire écrit à la main (pas de dépendance OpenCV).
 *   3. Extraction d'un gabarit par histogrammes de motifs binaires locaux uniformes (LBP), une
 *      technique classique de reconnaissance de texture — c'est ici notre "propre algorithme".
 *   4. Comparaison de deux gabarits par intersection d'histogrammes (score 0-1).
 *
 * Honnêteté à conserver dans le temps : ceci N'EST PAS un capteur veineux infrarouge de qualité
 * bancaire. Sans profondeur/IR, la détection de vivacité (liveness) reste best-effort (on exige
 * juste qu'une vraie main soit détectée avec une confiance suffisante) — une photo imprimée de
 * bonne qualité pourrait en théorie tromper le système. Voir le README pour ce compromis assumé.
 * ---------------------------------------------------------------------
 */

const PATCH_SIZE = 128; // patch de paume normalisé, en pixels (carré)
const GRID = 8; // grille de cellules pour les histogrammes LBP (8x8 = 64 cellules)
const CELL_SIZE = PATCH_SIZE / GRID;
const BINS_PER_CELL = 59; // LBP uniforme (P=8) : 58 motifs uniformes + 1 case "non uniforme"
const CELL_HIST_SCALE = 1000; // chaque histogramme de cellule est renormalisé pour sommer à cette valeur
const MAX_DETECTION_INPUT_SIZE = 640; // redimensionnement avant détection (vitesse), sans impact sur la précision du gabarit
const MIN_HAND_SCORE = 0.5; // confiance minimale du détecteur de main — porte de qualité/liveness best-effort

const REQUIRED_LANDMARKS = ['wrist', 'index_finger_mcp', 'middle_finger_mcp', 'ring_finger_mcp', 'pinky_finger_mcp'];

// LUT code LBP (0-255) -> index de bin (0-58), calculée une seule fois au chargement du module.
const UNIFORM_LBP_LUT = (() => {
  const lut = new Uint8Array(256);
  let next = 0;
  for (let code = 0; code < 256; code += 1) {
    let transitions = 0;
    for (let b = 0; b < 8; b += 1) {
      const bit1 = (code >> b) & 1;
      const bit2 = (code >> ((b + 1) % 8)) & 1;
      if (bit1 !== bit2) transitions += 1;
    }
    lut[code] = transitions <= 2 ? next++ : 58;
  }
  return lut;
})();

// Voisinage 3x3 (rayon 1), ordre horaire à partir du coin haut-gauche.
const LBP_NEIGHBORS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, 1],
  [1, 1], [1, 0], [1, -1],
  [0, -1],
];

let detectorPromise = null;
function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      return handPoseDetection.createDetector(handPoseDetection.SupportedModels.MediaPipeHands, {
        runtime: 'tfjs',
        modelType: 'lite',
        maxHands: 1,
      });
    })();
  }
  return detectorPromise;
}

function imageToTensor(img) {
  const { width, height, data } = img.bitmap;
  const rgb = new Int32Array(width * height * 3);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    rgb[p] = data[i];
    rgb[p + 1] = data[i + 1];
    rgb[p + 2] = data[i + 2];
  }
  return tf.tensor3d(rgb, [height, width, 3], 'int32');
}

async function locateHand(img) {
  const detector = await getDetector();
  const tensor = imageToTensor(img);
  let hands;
  try {
    hands = await detector.estimateHands(tensor, { flipHorizontal: false, staticImageMode: true });
  } finally {
    tensor.dispose();
  }
  if (!hands.length) return null;

  const best = hands.reduce((a, b) => ((b.score ?? 0) > (a.score ?? 0) ? b : a));
  if ((best.score ?? 0) < MIN_HAND_SCORE) return null;

  const byName = {};
  for (const kp of best.keypoints) byName[kp.name] = kp;
  if (!REQUIRED_LANDMARKS.every((name) => byName[name])) return null;

  return { ...byName, score: best.score };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function normalize(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}
function avgPoint(points) {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function sampleBilinear(data, w, h, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const px = (xx, yy) => {
    const cx = Math.min(Math.max(xx, 0), w - 1);
    const cy = Math.min(Math.max(yy, 0), h - 1);
    return data[(cy * w + cx) * 4]; // canal R (= G = B après greyscale())
  };
  const top = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx;
  const bottom = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx;
  return Math.round(top * (1 - fy) + bottom * fy);
}

// Recadre/oriente la zone de paume en un patch carré normalisé, par ré-échantillonnage bilinéaire
// direct depuis l'image source (rotation+échelle+translation en une passe, sans dépendre du
// comportement de redimensionnement de canvas de jimp .rotate()).
function warpPalmPatch(greyImg, hand) {
  const wrist = hand.wrist;
  const indexMcp = hand.index_finger_mcp;
  const middleMcp = hand.middle_finger_mcp;
  const ringMcp = hand.ring_finger_mcp;
  const pinkyMcp = hand.pinky_finger_mcp;

  const center = avgPoint([wrist, indexMcp, middleMcp, ringMcp, pinkyMcp]);
  const uAxis = normalize(sub(middleMcp, wrist)); // "vers les doigts"
  let vAxis = { x: -uAxis.y, y: uAxis.x }; // perpendiculaire (base orthonormée, pas de cisaillement)
  if (dot(vAxis, sub(pinkyMcp, indexMcp)) < 0) vAxis = { x: -vAxis.x, y: -vAxis.y }; // oriente vers l'auriculaire

  const palmLength = dist(wrist, middleMcp);
  const palmWidth = dist(indexMcp, pinkyMcp);
  const boxHalf = 0.65 * Math.max(palmLength, palmWidth); // marge empirique autour du centre de paume

  const { width: srcW, height: srcH, data } = greyImg.bitmap;
  const patch = new Uint8Array(PATCH_SIZE * PATCH_SIZE);
  for (let dy = 0; dy < PATCH_SIZE; dy += 1) {
    const ny = (0.5 - dy / PATCH_SIZE) * 2 * boxHalf; // haut du patch = vers les doigts
    for (let dx = 0; dx < PATCH_SIZE; dx += 1) {
      const nx = (dx / PATCH_SIZE - 0.5) * 2 * boxHalf;
      const sx = center.x + nx * vAxis.x + ny * uAxis.x;
      const sy = center.y + nx * vAxis.y + ny * uAxis.y;
      patch[dy * PATCH_SIZE + dx] = sampleBilinear(data, srcW, srcH, sx, sy);
    }
  }
  return patch;
}

// Égalisation d'histogramme (en place) — limite l'effet des écarts d'éclairage entre l'enrôlement
// et le paiement.
function equalizeHistogram(patch) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < patch.length; i += 1) hist[patch[i]] += 1;
  const cdf = new Uint32Array(256);
  let sum = 0;
  for (let v = 0; v < 256; v += 1) {
    sum += hist[v];
    cdf[v] = sum;
  }
  const total = patch.length;
  let cdfMin = 0;
  for (let v = 0; v < 256; v += 1) {
    if (cdf[v] > 0) {
      cdfMin = cdf[v];
      break;
    }
  }
  if (total <= cdfMin) return; // image dégénérée (uniforme) — rien à égaliser
  for (let i = 0; i < patch.length; i += 1) {
    patch[i] = Math.round(((cdf[patch[i]] - cdfMin) / (total - cdfMin)) * 255);
  }
}

// Gabarit = histogrammes LBP uniformes par cellule, chacun renormalisé à somme fixe (comparable
// entre deux images même si le nombre de pixels par cellule varie légèrement).
function computeLbpTemplate(patch) {
  const numCells = GRID * GRID;
  const raw = new Uint32Array(numCells * BINS_PER_CELL);

  for (let y = 1; y < PATCH_SIZE - 1; y += 1) {
    const cellY = Math.min(Math.floor(y / CELL_SIZE), GRID - 1);
    for (let x = 1; x < PATCH_SIZE - 1; x += 1) {
      const cellX = Math.min(Math.floor(x / CELL_SIZE), GRID - 1);
      const centerVal = patch[y * PATCH_SIZE + x];
      let code = 0;
      for (let n = 0; n < 8; n += 1) {
        const [ddy, ddx] = LBP_NEIGHBORS[n];
        const neighborVal = patch[(y + ddy) * PATCH_SIZE + (x + ddx)];
        if (neighborVal >= centerVal) code |= (1 << n);
      }
      const bin = UNIFORM_LBP_LUT[code];
      const cellIndex = cellY * GRID + cellX;
      raw[cellIndex * BINS_PER_CELL + bin] += 1;
    }
  }

  const template = new Uint16Array(raw.length);
  for (let c = 0; c < numCells; c += 1) {
    let cellSum = 0;
    for (let b = 0; b < BINS_PER_CELL; b += 1) cellSum += raw[c * BINS_PER_CELL + b];
    if (cellSum === 0) continue;
    for (let b = 0; b < BINS_PER_CELL; b += 1) {
      const i = c * BINS_PER_CELL + b;
      template[i] = Math.round((raw[i] / cellSum) * CELL_HIST_SCALE);
    }
  }
  return template;
}

// Photo (buffer JPEG/PNG/WebP) -> gabarit LBP. Lève une ApiError 422 si aucune paume n'est
// détectée avec une confiance suffisante (porte de qualité/liveness best-effort, cf. commentaire
// d'en-tête).
async function extractTemplate(photoBuffer) {
  const img = await Jimp.read(photoBuffer);
  if (img.bitmap.width > MAX_DETECTION_INPUT_SIZE) {
    img.resize({ w: MAX_DETECTION_INPUT_SIZE });
  }

  const hand = await locateHand(img);
  if (!hand) {
    throw new ApiError(
      422,
      "Aucune paume détectée sur la photo — présentez la main bien ouverte, centrée, avec un bon éclairage"
    );
  }

  const grey = img.clone().greyscale();
  const patch = warpPalmPatch(grey, hand);
  equalizeHistogram(patch);
  const descriptor = computeLbpTemplate(patch);

  return { descriptor, quality: hand.score };
}

// Score de similarité [0,1] entre deux gabarits (intersection d'histogrammes, moyennée sur les
// cellules). Les deux gabarits doivent avoir été produits par extractTemplate (même dimensions).
function matchScore(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const numCells = a.length / BINS_PER_CELL;
  let total = 0;
  for (let c = 0; c < numCells; c += 1) {
    let inter = 0;
    for (let bIdx = 0; bIdx < BINS_PER_CELL; bIdx += 1) {
      const i = c * BINS_PER_CELL + bIdx;
      inter += Math.min(a[i], b[i]);
    }
    total += inter / CELL_HIST_SCALE;
  }
  return total / numCells;
}

function serializeTemplate(descriptor) {
  return Buffer.from(descriptor.buffer, descriptor.byteOffset, descriptor.byteLength);
}

function deserializeTemplate(buffer) {
  // Copie dans un buffer aligné pour garantir un byteOffset pair (requis par Uint16Array).
  const aligned = Buffer.from(buffer);
  return new Uint16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2);
}

module.exports = {
  ALGO_VERSION: 'palm-lbp-v1',
  extractTemplate,
  matchScore,
  serializeTemplate,
  deserializeTemplate,
};
