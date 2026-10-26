# Développement

## Prérequis

- **podman** 5 ou plus, en mode rootless, avec **podman-compose** 1.5 ou plus ;
- GNU **make** et **bash** ;
- **Node.js** 22 ou plus (lint, typecheck et Vitest du front tournent sur l'hôte).

Python n'est pas nécessaire sur l'hôte : le back-end, ses tests, l'audit et la documentation tournent
dans des conteneurs.

```sh
podman --version && podman-compose --version
podman info --format '{{.Host.Security.Rootless}}'   # true attendu
```

## Démarrer

```sh
npm ci --prefix frontend
make dev
```

`make dev` crée les secrets s'ils manquent, démarre `db`, puis un conteneur `api` avec rechargement
automatique (le dossier `backend/` est monté dans `/app`) publié sur `http://127.0.0.1:8000`, et le
serveur Vite sur `http://localhost:5173`, qui relaie `/api` vers l'api. ++ctrl+c++ arrête Vite, le
conteneur api de dev et la base.

Première fois : créez les comptes avec `make install` (dans un autre terminal, `make dev` en
cours).

Ports changeables : `make dev API_DEV_PORT=8100 VITE_PORT=5273`.

## Vérifier

| Commande | Contenu | Durée |
|---|---|---|
| `make check` | ruff (lint + format) et pytest du back-end dans un PostgreSQL 16 jetable, puis oxlint, `tsc -b` et Vitest du front | ~1 min |
| `make test` | pytest + Vitest seulement | |
| `make e2e` | pile de production complète sur un projet jetable, `install` non interactif, scénario Playwright de la spécification §11 | 2 à 4 min |
| `make smoke` | même montage que `e2e`, sans Playwright : santé + `install` | ~1 min |
| `make audit` | pip-audit, `npm audit --omit=dev`, Trivy sur les images | plusieurs minutes |
| `make docs` | construit cette documentation en mode strict (lien cassé = échec) | |

`make check` est la porte minimale avant chaque commit ; `make e2e` avant une livraison.

### Tests du back-end

`scripts/test-backend.sh [commande]` construit la cible `test` de `backend/Containerfile` et la lance
à côté d'un PostgreSQL jetable (`compose.test.yaml`, nom de projet unique par exécution, aucun port
publié, tout est supprimé à la fin). Exemples :

```sh
scripts/test-backend.sh pytest -k forms -x
scripts/test-backend.sh ruff format .     # n'écrit pas sur l'hôte : le code est copié dans l'image
```

Les fixtures (`backend/tests/conftest.py`) migrent le schéma une fois par session puis vident toutes
les tables après chaque test. La matrice d'autorisation (`tests/test_authz_matrix.py`) doit être
complétée pour toute nouvelle route.

### Tests de bout en bout

`scripts/e2e.sh` lance la pile de production (`compose.yaml`, Caddy en HTTP) sous un nom de projet
unique (`pharmacie-e2e-<pid>`), avec des volumes neufs et des secrets et mots de passe générés dans
un dossier temporaire privé. Il exécute `python -m app.cli install` sans interaction (un second
`install` doit échouer), puis Playwright dans `mcr.microsoft.com/playwright:v1.64.1-noble`
(`--network host`, `--userns=keep-id` pour que le rapport appartienne à votre utilisateur) sur
`http://localhost:18080`. La pile, ses volumes et ses images sont supprimés à la fin, même en cas
d'échec.

Rapport : `frontend/playwright-report/index.html`. Port : `make e2e HTTP_PORT=19080`.

Le scénario (`frontend/e2e/scenario.spec.ts`) suit la spécification §11 : connexion admin, profils,
dossier, sous-dossier et note d'annexe (gras, souligné), template avec sous-champ conditionnel lié à
la note, puis côté utilisateur le choix du profil, une fiche, l'export PDF, l'infobulle de la note,
l'export PDF du dossier (titres vérifiés), le changement de
profil (lecture seule), la modification et la suppression par l'admin, et la réinitialisation du
mot de passe utilisateur.

## Conventions

- **Interface en français**, accessible (WCAG 2.1 AA), aucune ressource tierce (CDN, polices,
  analytics). Jetons visuels et règles : `frontend/DESIGN.md`.
- **Composants shadcn** dans `frontend/src/components/ui/`. Sous React 18, `Button` ne transmet pas
  `ref` : les déclencheurs de popover/menu utilisent `buttonVariants` sur un `<button>` natif.
- **Autorisation** : toute route utilise une dépendance de `app/api/deps.py` ; toute écriture
  appelle `app.services.activity.log` dans la même transaction.
- **Schéma de base** : uniquement par migration Alembic, voir
  [Mises à jour et migrations](migrations.md#ecrire-une-migration).
- **Format des références** : seulement dans `backend/app/config/reference.py` et
  `frontend/src/config/reference.ts`.
- **Schéma des templates** : le modèle Pydantic fait foi ; régénérez le JSON Schema du front après
  toute modification ([Schéma des templates](template-schema.md)).

## Documentation

Ce site est construit avec MkDocs (thème Material) dans un conteneur :

```sh
make docs         # site statique dans site/ (ignoré par git)
make docs-serve   # aperçu en direct sur http://127.0.0.1:8001
```

Les pages sont dans `docs/`, la navigation dans `mkdocs.yml`. Le guide utilisateur (`docs/user/`)
décrit l'usage de l'instance déployée, sans détail technique ; tout le reste va dans `docs/dev/`.
Mettez à jour la page concernée dans le même commit que le changement de comportement.
