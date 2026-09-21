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
  services/    logique métier (comptes, wallets, KYC, biométrie mock, transactions, recharges, transferts, admin)
  controllers/ handlers HTTP (validation des entrées, appel des services, réponses)
  routes/      déclaration des routes Express par domaine
  scripts/     initDb.js (exécute database/schema.sql), generateAdminHash.js
  app.js       assemblage Express (middlewares, routes)
  server.js    point d'entrée (vérifie la connexion DB puis démarre le serveur)
```

## Points d'attention pour la mise en production
- **Biométrie** : le matching palmaire réel n'est pas implémenté (aucun capteur disponible dans cet environnement). Le flux utilise un `palmCode` scanné en QR (voir `src/services/biometricService.js`) — à remplacer par un vrai SDK de matching 1:N sur `gabarit_chiffré` le jour où un capteur/algorithme propriétaire est intégré. Le contrat d'API (`POST /marchand/encaisser`) n'a pas besoin de changer.
- **Recharge / transfert externe** : les appels aux agrégateurs (Wave, Orange Money, Moov Money, MTN MoMo, Djamo, PSP Visa) sont simulés (`rechargeService.js`, `transferService.js`) et réussissent toujours — à remplacer par les vraies intégrations API + contrats marchands (section 3.4 du cahier des charges).
- **Documents KYC** : stockés sur disque local (`backend/uploads/`) pour ce scaffold. En production, utiliser un coffre-fort documentaire chiffré distinct de la base transactionnelle (section 3.3/9.1).
- **OTP SMS** : mock (le code est loggé côté serveur et renvoyé en dev via `devCode`). Brancher un vrai fournisseur SMS avant la mise en production et désactiver `OTP_DEV_ECHO`.
- Changer tous les secrets JWT et le mot de passe admin avant tout déploiement.
