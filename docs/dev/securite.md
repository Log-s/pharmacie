# Sécurité

## Transport et en-têtes

- **HTTPS seul.** Caddy sert tout en HTTPS (`tls internal` : autorité interne, certificat pour
  `SITE_HOST`) ; il n'y a pas d'écoute HTTP.
- **En-têtes** (`Caddyfile`) : HSTS, CSP `default-src 'self'` (aucune ressource tierce ; styles
  `'unsafe-inline'` seulement, pour les primitives Radix) avec `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` et `Cross-Origin-Resource-Policy` en
  `same-origin`, `Cache-Control: no-store` sur `/api/*`, en-tête `Server` supprimé.
- **Taille des requêtes** : 1 MB au plus sur `/api/*` (réponse 413 au-delà) ; les corps sont du JSON, le plus gros étant une note d'annexe.

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
- **Annexes** : voir [Annexes, HTML assaini](#annexes-html-assaini). Le rendu PDF des fiches et des
  annexes ne charge aucune ressource distante (récupérateur local seulement, gabarit Jinja
  auto-échappé).
- **Journal** en ajout seul : aucune route d'écriture, et des triggers PostgreSQL refusent tout
  `UPDATE`, `DELETE` ou `TRUNCATE` sur `activity_log`.
- **RGPD** : seules des données minimales sur les personnes sont stockées (nom, numéro et couleur
  des profils, IP dans le journal). Les sauvegardes en contiennent : droits `600`, copie chiffrée.

## Annexes, HTML assaini

Une note d'annexe est du HTML écrit par l'administrateur dans l'éditeur Tiptap, puis affiché aux deux
rôles et injecté dans un PDF. Rien de ce HTML n'est cru tel quel :

- **Liste blanche nh3 à chaque écriture** (`POST` et `PATCH`, `services/annexes.sanitize`) : balises
  `p h1 h2 h3 strong em u s ul ol li blockquote code pre a br hr`, seul attribut `href` sur `a`.
  Tout le reste est retiré (`<script>` et `<style>` avec leur contenu, `onclick`, `style`, `img`,
  `iframe`). Le HTML stocké est déjà assaini : la lecture ne le retraite pas.
- **Liens** : `href` limité à `http`, `https` et `mailto` (`javascript:` et `data:` sont supprimés, ainsi que les liens relatifs) ;
  nh3 ajoute `rel="noopener noreferrer"` à chaque lien. L'éditeur applique la même règle côté
  navigateur, mais seul le serveur fait foi.
- **Taille** : `body_html` est limité à 200 000 caractères, et Caddy refuse les corps de plus de 1 MB.
- **Affichage** : `NotePage` utilise `dangerouslySetInnerHTML`, ce qui n'est acceptable que parce
  que le serveur assainit à l'écriture. La CSP `default-src 'self'` limite de toute façon les dégâts
  d'un contournement.
- **PDF** : `annexes.html` insère le corps avec `|safe`. C'est justifié par deux protections
  indépendantes : nh3 a déjà retiré tout ce qui n'est pas dans la liste, et `LocalFetcher` empêche
  WeasyPrint de charger la moindre ressource externe. Les titres de dossiers et de notes, eux,
  passent par l'échappement automatique de Jinja. Les niveaux de titre sont décalés par une
  expression régulière sur `<h1>`...`<h6>`, sûre parce que nh3 ne laisse aucun attribut sur ces
  balises.

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
