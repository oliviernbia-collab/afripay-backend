# AfriPay Backend (Node.js / Express / MySQL)

API REST pour l'écosystème AfriPay (apps Client, Marchand, back-office Web). Voir [`../API_CONTRACT.md`](../API_CONTRACT.md) pour la liste complète des endpoints.

## Prérequis
- Node.js 18+
- MySQL/MariaDB en cours d'exécution (XAMPP : démarrer le module MySQL depuis le panneau de contrôle)

## Installation

```bash
cd backend
npm install
cp .env.example .env   # ajuster DB_USER/DB_PASSWORD si besoin (root sans mot de passe par défaut sous XAMPP)
npm run db:init        # crée la base db_afripay + toutes les tables + un compte admin de démo
npm run dev             # démarre le serveur sur http://localhost:4000 (nodemon)
```

Compte admin de démo : `admin@afripay.africa` / `AfriPay@2026` (à changer en production — utiliser `npm run db:seed-admin-hash -- "NouveauMotDePasse"` pour générer un nouveau hash bcrypt et l'insérer manuellement).

## Structure

```
src/
  config/      connexion MySQL (mysql2/promise), variables d'environnement
  middleware/  auth JWT, upload (multer), gestion d'erreurs
  services/    logique métier (comptes, wallets, KYC, reconnaissance de paume, transactions, recharges, transferts, admin)
  controllers/ handlers HTTP (validation des entrées, appel des services, réponses)
  routes/      déclaration des routes Express par domaine
  scripts/     initDb.js (exécute database/schema.sql), generateAdminHash.js
  app.js       assemblage Express (middlewares, routes)
  server.js    point d'entrée (vérifie la connexion DB puis démarre le serveur)
```

## Points d'attention pour la mise en production
- **Biométrie** : reconnaissance de paume réelle et locale (photo → détection de main → gabarit LBP → comparaison 1:N), voir `src/services/palmVisionService.js` — aucune API biométrique externe, aucune clé requise. Les poids du modèle de détection de main (TensorFlow.js/MediaPipe Hands) sont **vendorisés dans le dépôt** (`models/handpose/`, ~4 Mo) et servis par ce serveur lui-même (`app.js`, route `/models`) : par défaut, `@tensorflow-models/hand-pose-detection` les télécharge depuis des serveurs Google au premier démarrage, un vrai appel réseau externe qui contredit ce principe et qui a échoué en pratique sur un réseau instable — désormais aucun accès réseau n'est nécessaire, même hors ligne. Durcie par des portes de qualité de capture (cadrage/luminosité/netteté), une marge de décision entre le meilleur et le second candidat, un anti brute-force par marchand et un anti-rejeu de photo (voir `src/services/biometricService.js`, `src/utils/recentPhotoCache.js`) — mais ce n'est toujours pas l'équivalent d'un capteur veineux infrarouge de qualité bancaire : la détection de vivacité (liveness) reste best-effort (voir les commentaires du fichier), et les seuils sont des valeurs de départ à recalibrer avec de vraies photos. Le QR (`palmCode`) reste un repli si la caméra/l'éclairage posent problème.
- **Recharge / retrait Mobile Money** (Wave, Orange Money, Moov Money, MTN MoMo, Djamo) : intégration réelle via Jèko (`services/jekoService.js`) — recharge Client (payin) et retrait Marchand (payout), confirmés de façon **asynchrone par webhook, SIGNÉ** (`POST /api/paiements/jeko/webhook`, route publique sans JWT mais vérifiée par HMAC-SHA256 — voir `paiementWebhookController.js`). Prérequis externes non résolus dans cet environnement de dev :
  - Les **webhooks** (les deux sens) exigent que ce backend soit joignable publiquement (`JEKO_PUBLIC_BASE_URL`) — un tunnel (ngrok ou équivalent) en dev, le vrai domaine en production. Le **payin** exige en plus des URLs de retour HTTPS valides, construites à partir de la même variable.
  - `JEKO_API_KEY` / `JEKO_API_KEY_ID` / `JEKO_STORE_ID` / `JEKO_WEBHOOK_SECRET` (Dashboard Jèko, https://cockpit.jeko.africa) doivent être renseignées avant que la recharge/le retrait fonctionnent — 503 explicite tant qu'elles sont absentes.
  - La forme exacte du bénéficiaire pour le **payout** (`/partner_api/transfers`) n'est pas entièrement documentée publiquement — voir l'avertissement en en-tête de `jekoService.js`, à vérifier avant un vrai passage en production.
  - Visa reste hors périmètre (absent des `paymentMethod` documentés par Jèko) — nécessiterait une intégration séparée.
  - **Simulateur local** (`JEKO_MOCK_MODE=true` dans `.env`) : tant que les clés Jèko/l'exposition publique ne sont pas prêtes, ce mode remplace les vrais appels Jèko par une page de test servie par ce serveur lui-même (`GET /dev/paiement-simulation/:token`, voir `devPaymentSimulationController.js`) — on y choisit "réussi"/"échoué", ce qui déclenche exactement le même traitement qu'un vrai webhook (transaction, crédit/débit du wallet, notification). Nécessite `JEKO_PUBLIC_BASE_URL` réglée sur l'IP locale du serveur (celle déjà utilisée par les apps mobiles dans `src/config/api.js`), pas une URL publique. Verrouillé à `false` en production quelle que soit la variable d'environnement.
- **Documents KYC** : stockés sur disque local (`backend/uploads/`) pour ce scaffold. En production, utiliser un coffre-fort documentaire chiffré distinct de la base transactionnelle (section 3.3/9.1).
- **OTP SMS** : mock (le code est loggé côté serveur et renvoyé en dev via `devCode`). Brancher un vrai fournisseur SMS avant la mise en production et désactiver `OTP_DEV_ECHO`.
- Changer tous les secrets JWT et le mot de passe admin avant tout déploiement.
