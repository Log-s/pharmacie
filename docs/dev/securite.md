# Sécurité

## Transport et en-têtes

- **HTTPS seul.** Caddy sert tout en HTTPS (`tls internal` : autorité interne, certificat pour
  `SITE_HOST`) ; il n'y a pas d'écoute HTTP.
- **En-têtes** (`Caddyfile`) : HSTS, CSP `default-src 'self'` (aucune ressource tierce ; styles
  `'unsafe-inline'` seulement, pour les primitives Radix) avec `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` et `Cross-Origin-Resource-Policy` en
  `same-origin`, `Cache-Control: no-store` sur `/api/*`, en-tête `Server` supprimé.
- **Taille des requêtes** : 21 MB au plus sur `/api/*` (réponse 413 au-delà).

## Authentification et sessions

- **Deux comptes** uniques par rôle (contrainte en base), aucune inscription.
- **Mots de passe** : 12 caractères minimum, score zxcvbn ≥ 3, hachage Argon2id. Le mot de passe
  admin ne se réinitialise que sur le serveur (`make reset-admin-password`).
- **Sessions** côté serveur : cookie `session` `HttpOnly; Secure; SameSite=Strict`, jeton aléatoire
  dont seul le hachage SHA-256 est stocké, expiration après `SESSION_IDLE_MINUTES` d'inactivité.
- **CSRF** : jeton HMAC lié à la session, exigé dans l'en-tête `X-CSRF-Token` sur tout POST, PUT,
  PATCH et DELETE (hors connexion). Toujours actif, sans réglage pour le désactiver.
- **Verrouillage et limitation** : `LOCKOUT_THRESHOLD` échecs consécutifs verrouillent le compte,
  durée doublée à chaque échec jusqu'à `LOCKOUT_MAX_SECONDS` ; `LOGIN_RATE_LIMIT` tentatives par
  minute et par IP (mémoire du processus, un seul worker uvicorn).

## Autorisation

Centralisée dans `backend/app/api/deps.py` (`require_admin`, `require_user`,
`require_active_profile`, `require_form_owner_or_admin`). Une matrice de tests
(`backend/tests/test_authz_matrix.py`) vérifie chaque route pour chaque rôle ; toute route
d'écriture sans jeton CSRF est refusée par un test automatique.

Le profil actif est une **barrière logique**, pas une frontière de sécurité : le compte utilisateur
peut changer de profil sans mot de passe (spécification §2.2). Le journal trace ces changements.

## Conteneurs et données

- **podman rootless** : aucun démon, aucun privilège root sur l'hôte ; dans les conteneurs, chaque
  service a un uid non root.
- **PostgreSQL** sur un réseau interne (`internal: true`), sans port publié.
- **Secrets** dans `secrets/` (dossier `700`, ignoré par git), montés dans `/run/secrets`, jamais
  copiés dans une image.
- **Annexes** : type vérifié par les octets magiques (`%PDF-`), taille bornée, servies en
  `Content-Disposition: inline` avec un type forcé. Le rendu PDF des fiches ne charge aucune
  ressource distante (récupérateur local seulement, gabarit Jinja auto-échappé).
- **Journal** en ajout seul : aucune route d'écriture, et des triggers PostgreSQL refusent tout
  `UPDATE`, `DELETE` ou `TRUNCATE` sur `activity_log`.
- **RGPD** : seules des données minimales sur les personnes sont stockées (nom, numéro et couleur
  des profils, IP dans le journal). Les sauvegardes en contiennent : droits `600`, copie chiffrée.

## Audits

`make audit` lance `pip-audit` (dans l'image api, sans l'ajouter aux dépendances),
`npm audit --omit=dev` et Trivy sur les images `api`, `proxy` et `postgres:16-alpine`. Code de
sortie non nul s'il y a des vulnérabilités (Trivy : HIGH ou CRITICAL ; les niveaux inférieurs sont
affichés). Relancez-le après chaque mise à jour de dépendance ou d'image de base.

## Limites connues

- Le verrouillage progressif peut être déclenché volontairement pour bloquer un compte (compromis
  de la spécification).
- L'api se connecte à PostgreSQL avec le rôle propriétaire de la base ; un rôle aux droits réduits
  serait préférable.
- Pas de règle `prefers-reduced-motion` dans le front (les transitions sont de courts fondus).
