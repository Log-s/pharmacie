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

Avec podman : `make COMPOSE=podman-compose ENGINE=podman up`.

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

`make backup` (U9) et `make e2e` (U13) ne sont pas encore implémentés.

## Ports et variables

| Variable | Défaut | Rôle |
|---|---|---|
| `HTTPS_PORT` | `8443` | port HTTPS publié par le proxy |
| `SITE_HOST` | `localhost` | nom d'hôte du certificat Caddy |
| `API_DEV_PORT` | `8000` | port local de l'api pour `make dev` |
| `VITE_PORT` | `5173` | port du serveur Vite pour `make dev` |
| `COMPOSE` / `ENGINE` | `docker compose` / `docker` | moteur de conteneurs |

Plusieurs copies du dépôt peuvent tourner en parallèle en changeant ces ports.
