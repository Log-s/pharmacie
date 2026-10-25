# Interventions pharmaceutiques

Application web interne pour remplir des fiches à partir de templates, les exporter en PDF et
consulter des annexes PDF. Spécification : [`specification.md`](specification.md).

## Documentation

La documentation est un site MkDocs, source dans [`docs/`](docs/) :

- **guide utilisateur** (`docs/user/`) : se servir de l'instance déployée ;
- **documentation technique** (`docs/dev/`) : architecture, infrastructure podman, déploiement en
  production, mises à jour et migrations, sauvegardes, configuration, sécurité.

```sh
make docs         # construit le site dans site/
make docs-serve   # aperçu sur http://127.0.0.1:8001
```

## Démarrage rapide

Prérequis : podman 5+ (rootless) avec podman-compose 1.5+, GNU make, Node 22+ pour le
développement du front.

```sh
make secrets   # crée secrets/db_password et secrets/secret_key s'ils n'existent pas
make up        # construit et démarre proxy + api + db, puis https://localhost:8443
make install   # crée les comptes admin et utilisateur (à faire une fois)
make down      # arrête la pile
```

## Commandes `make`

| Cible | Rôle |
|---|---|
| `secrets` | crée les secrets s'ils manquent |
| `up` / `down` | construit et démarre la pile / l'arrête |
| `install` | crée les comptes admin et utilisateur (interactif, une seule fois) |
| `migrate` | applique les migrations Alembic |
| `reset-admin-password` | nouveau mot de passe admin (serveur uniquement) |
| `backup` / `restore` | sauvegarde et restauration |
| `dev` | db + api (rechargement) + Vite |
| `check` | ruff + pytest (Postgres jetable) + lint, typecheck et vitest du front |
| `test` | pytest + vitest seulement |
| `e2e` | scénario Playwright sur une pile de production jetable |
| `smoke` | pile de production jetable : santé + `install` |
| `audit` | `pip-audit`, `npm audit`, Trivy |
| `docs` / `docs-serve` | documentation |

Détails : `docs/dev/developpement.md`, `docs/dev/deploiement.md`, `docs/dev/operations.md`.
