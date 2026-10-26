# Architecture

Cette partie s'adresse à qui installe, exploite ou fait évoluer l'application. La
[référence des modules](modules.md) et le [schéma des templates](template-schema.md) sont en
anglais, comme les commentaires du code.

## Vue d'ensemble

```
navigateur ──HTTPS──> nginx (hôte) ──HTTP:${HTTP_PORT:-8080}──> proxy (Caddy, front compilé dans /srv)
                                            │ /api/*            réseau « front »
                                            ▼
                                     api (FastAPI/uvicorn :8000, uid 10001)
                                            │                   réseau « back » (internal)
                                            ▼
                                     db (PostgreSQL 16, volume pgdata, aucun port publié)
```

Trois conteneurs, décrits dans `compose.yaml` et lancés par **podman-compose** sous un utilisateur
non root (podman rootless) :

| Service | Image | Rôle |
|---|---|---|
| `proxy` | `frontend/Containerfile` (Node pour compiler, puis Caddy 2.11) | en-têtes de sécurité, fichiers du front, relais de `/api/*` |
| `api` | `backend/Containerfile`, cible `runtime` (Python 3.12) | API REST, rendu PDF ; applique les migrations au démarrage |
| `db` | `docker.io/library/postgres:16-alpine` | données ; joignable seulement depuis `api` |

Détails : [Infrastructure](infrastructure.md).

## Pile technique

- **Back-end** : FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 16, argon2-cffi + zxcvbn
  (mots de passe), WeasyPrint (PDF). CLI interne `python -m app.cli`
  (`install`, `migrate`, `reset-admin-password`).
- **Front-end** : React 18, TypeScript strict, Vite, shadcn/ui + Tailwind v4, react-hook-form + zod,
  TanStack Query, dnd-kit, react-day-picker (locale `fr`). Aucune ressource tierce : polices et
  scripts sont servis par Caddy.
- **Tests** : pytest contre un PostgreSQL jetable, Vitest, Playwright (scénario de bout en bout sur
  une pile de production jetable).
- **Conteneurs** : podman 5 rootless + podman-compose 1.5. Les images de base sont désignées par
  leur nom complet (`docker.io/library/...`), sans dépendre des registres de recherche configurés.

## Organisation du code

```
backend/
  app/main.py            fabrique de l'app, /api/health, montage des routeurs sous /api
  app/api/               routeurs (auth, profiles, templates, annexes, forms, journal, admin) et deps.py
  app/services/          logique métier (sessions, activity, forms, templates…)
  app/models/            modèles SQLAlchemy (une table par entité de la spécification §8)
  app/schemas/           corps de requêtes et réponses Pydantic, schéma des templates
  app/pdf/               gabarit HTML + CSS de l'export
  app/config/reference.py  le seul endroit qui connaît le format des références (`MM-AAAA-NNN`, séquence mensuelle)
  alembic/versions/      migrations
  tests/                 pytest
frontend/
  src/router.tsx         routes et gardes (miroir de l'autorisation serveur)
  src/{auth,profiles,forms,templates,annexes,admin}/  écrans par domaine
  src/components/ui/     composants shadcn
  e2e/                   scénario Playwright
  DESIGN.md              jetons et conventions visuelles
scripts/                 e2e, tests back, sauvegarde, restauration, audit, secrets
compose.yaml             pile de production ; compose.test.yaml : pile de test jetable
Caddyfile                en-têtes, limites, relais
```

## Principes

- **Autorisation côté serveur**, centralisée dans `backend/app/api/deps.py` : `require_admin`,
  `require_user`, `require_active_profile`, `require_form_owner_or_admin`. Les gardes du front ne
  font que refléter ces règles.
- **Journal en ajout seul** : toute écriture passe par `app.services.activity.log` ; des triggers
  PostgreSQL refusent `UPDATE`, `DELETE` et `TRUNCATE` sur `activity_log`.
- **Données d'une fiche** : un dictionnaire plat `{"<id du nœud>": valeur}` ; les sous-champs
  masqués sont retirés côté serveur.
- **Templates versionnés** : chaque publication crée une version immuable ; une fiche pointe vers
  sa version.
- **Schéma de base** : modifié uniquement par des migrations Alembic ; un test échoue si modèles et
  migrations divergent.
