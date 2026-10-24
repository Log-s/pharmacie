# Pharmacie : fiches

Application web interne pour remplir des fiches à partir de templates, les exporter en PDF et
consulter des annexes PDF. Spécification : [`specification.md`](specification.md). Architecture :
[`docs/architecture.md`](docs/architecture.md).

## Prérequis

Docker 29+ avec compose (ou podman + podman-compose), GNU make, Node 22+ pour le développement du
front.

## Démarrage rapide

```sh
make secrets   # crée secrets/db_password et secrets/secret_key s'ils n'existent pas
make up        # construit et démarre proxy + api + db, puis https://localhost:8443
make install   # crée les comptes admin et utilisateur (à faire une fois)
make down      # arrête la pile
```

Le certificat est émis par la CA interne de Caddy : le navigateur affiche un avertissement tant
que la racine (`docker compose exec proxy cat /data/caddy/pki/authorities/local/root.crt`) n'est
pas approuvée.

Avec podman : `make COMPOSE=podman-compose ENGINE=podman up`, puis
`make COMPOSE=podman-compose ENGINE=podman install`. `make smoke-podman` vérifie ce parcours sur un
projet jetable (voir plus bas).

## Commandes `make`

| Cible | Rôle |
|---|---|
| `secrets` | crée `secrets/db_password` et `secrets/secret_key` s'ils manquent |
| `up` / `down` | construit et démarre la pile (proxy, api, db) / l'arrête |
| `install` | crée les comptes admin et utilisateur (interactif, une seule fois) |
| `migrate` | applique les migrations Alembic |
| `backup` / `restore` | sauvegarde et restauration, voir [`docs/backup-restore.md`](docs/backup-restore.md) |
| `test` | pytest (Postgres jetable) + vitest |
| `check` | `test` + ruff, lint et typecheck du front |
| `e2e` | scénario Playwright (spécification §11) sur une pile de production jetable |
| `smoke-podman` | `podman-compose up`, santé, `install` non interactif, sur un projet jetable |
| `audit` | `pip-audit`, `npm audit`, Trivy |
| `dev` | db + api (rechargement) + Vite, pour le développement |

## Développement

```sh
npm ci --prefix frontend
make dev       # db + api (rechargement auto) + serveur Vite qui relaie /api
make check     # ruff + pytest (Postgres jetable) + lint, typecheck et vitest du front
make test      # pytest + vitest seulement
make migrate   # applique les migrations Alembic sur la pile
```

`make dev` sert le front sur http://localhost:5173 et l'api sur http://127.0.0.1:8000.
`Ctrl+C` arrête le serveur Vite, le conteneur api de dev et la base.

## Tests de bout en bout

`make e2e` ne demande rien : il lance `scripts/e2e.sh`, qui monte la pile de production
(`compose.yaml`, Caddy en HTTPS) sous un nom de projet unique (`pharmacie-e2e-<pid>`) avec des
volumes neufs, des secrets et des mots de passe générés dans un dossier temporaire, exécute
`python -m app.cli install` sans interaction, puis déroule Playwright (Chromium, image
`mcr.microsoft.com/playwright:v1.64.1-noble`, `--network host`) sur `https://localhost:18443`.
La pile, ses volumes et ses images sont supprimés à la fin, même en cas d'échec. Prérequis :
Docker et accès à l'image Playwright.

Le scénario (`frontend/e2e/scenario.spec.ts`) suit la spécification §11 : connexion admin, profils,
annexe PDF (générée pendant le test), template avec sous-champ conditionnel et annexe, puis côté
utilisateur le choix du profil, une fiche, l'export PDF, l'infobulle de l'annexe, le changement de
profil (lecture seule), la modification et la suppression par l'admin, et la réinitialisation du
mot de passe utilisateur. Rapport HTML : `frontend/playwright-report/index.html`.

`make smoke-podman` fait le même montage avec `podman-compose` sur le port 18444, vérifie
`GET /api/health` et l'`install` non interactif, puis démonte tout. Les ports d'essai se changent
avec `HTTPS_PORT`.

Sauvegarde et restauration : [`docs/backup-restore.md`](docs/backup-restore.md).

## Ports et variables

| Variable | Défaut | Rôle |
|---|---|---|
| `HTTPS_PORT` | `8443` | port HTTPS publié par le proxy (`make e2e` : `18443`, `make smoke-podman` : `18444`) |
| `SITE_HOST` | `localhost` | nom d'hôte du certificat Caddy |
| `API_DEV_PORT` | `8000` | port local de l'api pour `make dev` |
| `VITE_PORT` | `5173` | port du serveur Vite pour `make dev` |
| `COMPOSE` / `ENGINE` | `docker compose` / `docker` | moteur de conteneurs |

Plusieurs copies du dépôt peuvent tourner en parallèle en changeant ces ports.

## Sécurité

- **HTTPS seul.** Caddy sert tout en HTTPS (`tls internal` : CA interne, certificat pour
  `SITE_HOST`) ; il n'y a pas d'écoute HTTP. Pour éviter l'avertissement du navigateur, importez la
  racine `docker compose exec proxy cat /data/caddy/pki/authorities/local/root.crt` dans le magasin
  de confiance des postes.
- **En-têtes** (`Caddyfile`) : HSTS, CSP `default-src 'self'` (aucune ressource tierce) avec
  `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` et
  `Cross-Origin-Resource-Policy` en `same-origin`, `Cache-Control: no-store` sur `/api/*`, en-tête
  `Server` supprimé. Corps de requête limité à 21 MB sur `/api/*` (`request_body` dans le
  `Caddyfile`, réponse 413 au-delà) : c'est la limite des annexes `ANNEX_MAX_BYTES` (20 MiB par
  défaut) plus l'enveloppe multipart ; si vous augmentez `ANNEX_MAX_BYTES`, augmentez-la aussi.
- **Sessions.** Cookie `session` `HttpOnly; Secure; SameSite=Strict`, jeton aléatoire dont seul le
  hachage SHA-256 est stocké. Expiration après inactivité : `SESSION_IDLE_MINUTES` (30).
- **CSRF.** Jeton lié à la session, exigé dans l'en-tête `X-CSRF-Token` sur tout POST, PUT, PATCH et
  DELETE (hors connexion). Il n'existe pas de réglage pour le désactiver : il est toujours actif.
- **Verrouillage et limitation.** `LOCKOUT_THRESHOLD` (5) échecs consécutifs verrouillent le compte
  `LOCKOUT_BASE_SECONDS` (60) secondes, doublées à chaque échec jusqu'à `LOCKOUT_MAX_SECONDS` (900) ;
  `LOGIN_RATE_LIMIT` (10) tentatives de connexion par minute et par IP (mémoire du processus, un seul
  worker uvicorn).
- **Réglages.** Ces variables se lisent dans l'environnement du service `api` ; ajoutez-les dans un
  `compose.override.yaml` (chargé automatiquement par compose) :

  ```yaml
  services:
    api:
      environment:
        SESSION_IDLE_MINUTES: "15"
        LOCKOUT_THRESHOLD: "5"
  ```

- **Secrets.** `secrets/db_password` et `secrets/secret_key` (créés par `make secrets`) sont des
  secrets compose montés dans `/run/secrets`, jamais copiés dans une image ni versionnés. Les
  mots de passe admin et utilisateur sont hachés en Argon2id (12 caractères minimum, score zxcvbn
  ≥ 3) ; le mot de passe admin ne se réinitialise que sur le serveur
  (`python -m app.cli reset-admin-password`). PostgreSQL est sur un réseau interne sans port publié ;
  les conteneurs tournent sans root.
- **Journal.** `GET /api/journal` (admin seulement) lit un journal en ajout seul : aucune route
  d'écriture et un trigger PostgreSQL refuse tout `UPDATE` ou `DELETE`.
- **Audits.** `make audit` lance `pip-audit` (dans l'image api, sans l'ajouter aux dépendances),
  `npm audit --omit=dev` et Trivy sur les images `api`, `proxy` et `postgres:16-alpine` (conteneur
  `aquasec/trivy`). Le code de sortie est non nul s'il y a des vulnérabilités (Trivy : HIGH ou
  CRITICAL ; les niveaux inférieurs sont affichés). Relancez-le après chaque mise à jour de
  dépendance ou d'image de base.
- **Sauvegardes.** `make backup` / `make restore`, voir [`docs/backup-restore.md`](docs/backup-restore.md).
  Les fichiers de `backups/` contiennent des données personnelles : droits `600`, copie hors machine.
