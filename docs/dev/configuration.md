# Configuration

## Où régler quoi

| Fichier | Pour | Versionné |
|---|---|---|
| `Makefile` (en tête) | port et adresse d'écoute de la pile (`HTTP_PORT`, `HTTP_BIND`) | oui |
| `compose.override.yaml` | réglages du service `api`, montages supplémentaires ; fusionné automatiquement avec `compose.yaml` | non |
| `secrets/` | `db_password`, `secret_key` ([Infrastructure](infrastructure.md#secrets)) | non |
| ligne de commande `make` | ports de développement, moteur de conteneurs | — |

Après une modification, `make up` recrée les conteneurs concernés.

## Pile (`Makefile`)

Réglées en tête du `Makefile`, ou sur la ligne de commande (`make up HTTP_PORT=8081`). La pile
n'écoute qu'en HTTP ; le HTTPS est assuré par nginx ([Déployer](deploiement.md#configurer-nginx)).

| Variable | Défaut | Rôle |
|---|---|---|
| `HTTP_PORT` | `8080` | port HTTP publié sur l'hôte (`make e2e` : 18080, `make smoke` : 18081) |
| `HTTP_BIND` | `127.0.0.1` | adresse d'écoute du port publié ; nginx sur l'hôte s'y connecte |

## Application (service `api`)

Ces variables se lisent dans l'environnement du conteneur `api`. Exemple :

```yaml title="compose.override.yaml"
services:
  api:
    environment:
      SESSION_IDLE_MINUTES: "15"
      LOCKOUT_THRESHOLD: "5"
```

| Variable | Défaut | Rôle |
|---|---|---|
| `SESSION_IDLE_MINUTES` | `30` | fermeture de session après inactivité (glissante) |
| `LOGIN_RATE_LIMIT` | `10` | tentatives de connexion par minute et par IP |
| `LOCKOUT_THRESHOLD` | `5` | échecs consécutifs avant verrouillage du compte |
| `LOCKOUT_BASE_SECONDS` | `60` | première durée de verrouillage, doublée à chaque nouvel échec… |
| `LOCKOUT_MAX_SECONDS` | `900` | …jusqu'à ce plafond |
| `EXPOSE_API_DOCS` | `false` | `true` publie `/api/docs`, `/api/redoc`, `/api/openapi.json` ; développement seulement |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | `db`, `5432`, `pharmacie`, `pharmacie` | connexion à PostgreSQL |
| `DB_PASSWORD`, `SECRET_KEY` | — | lus dans `/run/secrets/` ; ne les mettez pas dans l'environnement en production |

Les annexes sont des notes stockées dans la base : elles n'ont ni dossier de fichiers, ni volume, ni
réglage de taille. Seule limite : `request_body max_size 1MB` dans le `Caddyfile` sur `/api/*`
(réponse 413 au-delà), qui couvre une note de 200 000 caractères au plus (limite du schéma de
l'API). Pour l'augmenter, modifiez les deux, puis `make up`.

## Format des références

Le format `MM-AAAA-NNN` (mois, année, puis un numéro de 3 chiffres, ou 4 chiffres et plus sans zéro
initial au-delà de 999) est défini à deux endroits seulement : `backend/app/config/reference.py`
(génération et validation, fait foi) et `frontend/src/config/reference.ts` (aide à la saisie).
Le numéro repart de `001` chaque mois, le mois étant celui de la création en heure de Paris
(un compteur par mois dans `reference_counters`, clé `MM-AAAA`). Changer de format demande de
modifier les deux, leurs tests, et de vérifier que les références existantes restent valides ou de
les migrer.

## Développement (`make`)

| Variable | Défaut | Rôle |
|---|---|---|
| `COMPOSE` | `podman-compose` | commande compose |
| `ENGINE` | `podman` | moteur de conteneurs |
| `API_DEV_PORT` | `8000` | port local de l'api de `make dev` |
| `VITE_PORT` | `5173` | port du serveur Vite de `make dev` |
| `VITE_API_TARGET` | `http://127.0.0.1:$API_DEV_PORT` | cible du relais `/api` de Vite |
| `DOCS_PORT` | `8001` | port de `make docs-serve` |
| `YES`, `DB` | — | arguments de `make restore` |

Plusieurs copies du dépôt peuvent tourner en parallèle en changeant ces ports et `HTTP_PORT`.
