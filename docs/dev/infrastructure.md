# Infrastructure

## Moteur de conteneurs

L'application tourne sur **podman** rootless, orchestré par **podman-compose** à partir de
`compose.yaml`. Les cibles `make` utilisent les variables :

| Variable | Défaut | Usage |
|---|---|---|
| `COMPOSE` | `podman-compose` | commande compose (toutes les cibles et les scripts) |
| `ENGINE` | `podman` | commande du moteur (`make e2e`, `make audit`, `make dev`, `make docs`) |

Les conteneurs tournent sous l'utilisateur qui lance `make` ; à l'intérieur, chaque service a son
propre uid non root (api : 10001, proxy : 10002, db : `postgres`), projeté sur les sous-uid de
l'utilisateur hôte (`/etc/subuid`). Aucun démon, aucun privilège root sur l'hôte.

## Services

### proxy

- Image construite par `frontend/Containerfile` depuis la racine du dépôt (fichier d'exclusion
  `.containerignore`) : étape Node 24 qui compile le front (`npm ci && npm run build`), puis
  Caddy 2.11 avec le `Caddyfile` et le front dans `/srv`.
- Écoute **8080** en HTTP dans le conteneur, publié sur `${HTTP_BIND:-127.0.0.1}:${HTTP_PORT:-8080}`
  (`make up` les prend en tête du `Makefile`). Pas de TLS : nginx, sur l'hôte, termine le HTTPS
  et relaie vers ce port. Caddy conserve les `X-Forwarded-*` venus d'une adresse privée
  (`trusted_proxies static private_ranges`).
- Relais de `/api/*` vers `api:8000` ; corps de requête limité à 21 MB sur `/api/*` ; `/` sert le
  front avec repli sur `index.html`.

### api

- Image construite par `backend/Containerfile`, cible `runtime` (contexte `backend/`, exclusions
  `backend/.containerignore`) : Python 3.12, bibliothèques de WeasyPrint (pango, harfbuzz) et
  polices locales (Liberation, DejaVu) ; le rendu PDF ne va jamais chercher de ressource externe.
- Au démarrage : `python -m app.cli migrate` puis `uvicorn` sur le port 8000, un seul worker (la
  limitation des tentatives de connexion est en mémoire du processus).
- Lit ses secrets dans `/run/secrets/` et sa configuration dans l'environnement
  ([Configuration](configuration.md)).
- Ne stocke aucun fichier : les annexes (dossiers et notes) vivent dans la base.

### db

- `docker.io/library/postgres:16-alpine`, base et rôle `pharmacie`, mot de passe lu dans le secret
  `db_password` (`POSTGRES_PASSWORD_FILE`).
- Données dans le volume `pgdata`. Contrôle de santé `pg_isready` : `api` attend que la base soit
  prête.

Les trois services ont `restart: unless-stopped`. Avec podman, ce redémarrage ne survit à un
redémarrage de la machine que si `podman-restart.service` est activé : voir
[Déploiement](deploiement.md#demarrage-automatique).

## Réseaux

| Réseau | Membres | Particularité |
|---|---|---|
| `front` | proxy, api | |
| `back` | api, db | `internal: true` : pas de sortie vers l'extérieur |

La base n'a aucun port publié et n'est joignable que depuis `api`.

## Volumes

podman-compose préfixe les volumes par le nom du projet (par défaut le nom du dossier du dépôt,
`pharmacie`) : `pharmacie_pgdata`, etc.

| Volume | Contenu | Sauvegardé par `make backup` |
|---|---|---|
| `pgdata` | base PostgreSQL | oui (`pg_dump`) |

```sh
podman volume ls --filter name=pharmacie
podman volume inspect pharmacie_pgdata --format '{{.Mountpoint}}'
```

## Secrets

`secrets/db_password` et `secrets/secret_key` (ignorés par git, dossier en `700`) sont créés par
`make secrets` (32 octets aléatoires chacun) et jamais écrasés. podman-compose les monte en lecture
seule dans `/run/secrets/` ; ils ne sont jamais copiés dans une image.

- `db_password` : mot de passe du rôle PostgreSQL. Il est fixé à la **première** initialisation de
  `pgdata` ; le changer ensuite demande aussi un `ALTER ROLE` dans la base.
- `secret_key` : clé HMAC des jetons CSRF. La changer invalide les sessions ouvertes, rien d'autre.

## Images

| Image | Source |
|---|---|
| `localhost/pharmacie_proxy` | construite (`frontend/Containerfile`) |
| `localhost/pharmacie_api` | construite (`backend/Containerfile`, cible `runtime`) |
| `docker.io/library/postgres:16-alpine` | registre |

Outils ponctuels : `mcr.microsoft.com/playwright:v1.64.1-noble` (e2e),
`docker.io/aquasec/trivy:0.76.1` (audit), `docker.io/squidfunk/mkdocs-material:9.6.14` (docs).

Les noms d'image sont complets : podman n'a pas à deviner le registre
(`unqualified-search-registries`), ce qui évite une question interactive ou un échec sur une machine
neuve.

## Fichiers

| Fichier | Rôle |
|---|---|
| `compose.yaml` | pile de production |
| `compose.test.yaml` | base jetable + image de test du back-end (`scripts/test-backend.sh`) |
| `compose.override.yaml` | facultatif, non versionné : réglages locaux, chargé automatiquement par podman-compose |
| `Caddyfile` | en-têtes, limites, relais |
| `Makefile` | point d'entrée de toutes les opérations (chaque cible est commentée par `##`) |
| `scripts/` | e2e, tests, sauvegarde, restauration, audit, secrets |
