# Spécification : application de fiches à remplir

> Ce document sert à la fois de plan d'architecture et de prompt d'implémentation pour un agent de développement. Le projet part de zéro (aucun code existant).

## 1. Contexte et objectif

On construit une application web interne pour remplir des fiches structurées à partir de templates : cases à cocher, boutons radio, texte libre, date, auteur, référence. Les fiches sont exportables en PDF et peuvent renvoyer vers des annexes PDF.

L'architecture de l'application est classique, la sécurité repose sur les bonnes pratiques web habituelles (§5). L'UX est une priorité.

Hébergement : en local pendant le développement, hébergeur à choisir ensuite. Volume faible (une poignée de profils).

## 2. Comptes et profils

### 2.1 Deux comptes, créés à l'installation
| Compte | Droits |
|---|---|
| **Admin** (unique) | Consulter, modifier et supprimer **toutes les fiches** (quel que soit le profil propriétaire) ; créer, modifier et supprimer des **profils** ; créer, modifier et supprimer des **templates** ; créer et supprimer des **annexes** (upload de PDF) ; lire le **journal d'activité** ; **réinitialiser le mot de passe** du compte utilisateur |
| **Utilisateur** (unique, partagé) | Choisir un profil puis en changer sans mot de passe ; consulter **toutes** les fiches ; créer des fiches ; modifier et supprimer **uniquement les fiches du profil actif** ; exporter en PDF ; consulter les annexes |

- Il n'y a ni inscription ni création de compte : ces deux comptes sont les seuls de l'instance (contrainte d'unicité par rôle en base).
- L'admin ne crée pas de fiches, mais il peut modifier ou supprimer n'importe quelle fiche, par exemple pour corriger une erreur. Il n'utilise pas de profil : ses modifications sont attribuées au compte admin dans le journal, et le profil propriétaire de la fiche reste inchangé. Son interface contient Fiches, Profils, Templates, Annexes, Journal et Compte utilisateur.
- Les autorisations sont vérifiées **côté serveur** et reflétées dans l'interface.

### 2.2 Profils
- Un profil a un nom affiché, des initiales et une couleur. Il est géré par l'admin.
- Après la connexion du compte utilisateur, un écran de choix affiche les profils sous forme de cartes. Un sélecteur dans l'en-tête permet de changer de profil à tout moment, **sans mot de passe**.
- Le profil actif est stocké dans la session côté serveur. Chaque action d'écriture est attribuée à ce profil.
- **Barrière logique, pas de sécurité.** Un profil ne peut modifier ou supprimer que ses propres fiches. Il est **admis** que l'utilisateur change de profil pour modifier les fiches d'un autre. La règle évite surtout les erreurs de manipulation. Le journal d'activité enregistre les changements de profil, ce qui garde la trace de qui a fait quoi.
- **Suppression d'un profil par l'admin** : si le profil n'a aucune fiche, il est supprimé définitivement. Sinon, il est archivé : il disparaît du sélecteur, ses fiches restent consultables en lecture seule avec la mention « Nom (profil supprimé) ». Une confirmation indique le nombre de fiches concernées.

### 2.3 Installation et réinitialisation
- **Installation** : `make install` (ou `docker compose run --rm api python -m app.cli install`). La commande refuse de s'exécuter si l'instance est déjà installée. Elle demande les mots de passe des comptes admin et utilisateur (saisie masquée, confirmation, contrôle de robustesse), crée les deux comptes dans une seule transaction et propose de créer un premier profil.
- **Réinitialisation du compte utilisateur** par l'admin, depuis l'interface : l'admin définit un nouveau mot de passe, et toutes les sessions utilisateur ouvertes sont fermées. Les profils et les fiches ne sont pas touchés.
- **Réinitialisation du compte admin** : uniquement depuis le serveur, avec `python -m app.cli reset-admin-password`. La commande ferme les sessions admin et est journalisée. Aucune route web ne permet de réinitialiser l'admin.
- Mots de passe : 12 caractères minimum, contrôle de robustesse (zxcvbn), hachage Argon2id. Rate limiting et verrouillage progressif en cas d'échecs.

## 3. Fiches et templates

### 3.1 Fiches
- Toutes les fiches sont visibles par tous les profils.
- Liste avec recherche et filtres (référence, date, auteur, profil propriétaire, template). La recherche se fait côté serveur.
- Le **profil propriétaire** est le profil qui a créé la fiche. Il est fixé à la création. Le champ `author` (§3.2) est une donnée de la fiche : le modifier ne change pas le propriétaire.
- Côté utilisateur, les boutons « Modifier » et « Supprimer » ne s'affichent que pour les fiches du profil actif. Côté admin, ils s'affichent pour toutes les fiches. Les autres fiches s'ouvrent en lecture seule, avec une mention « Fiche de *Nom* ».
- Suppression définitive, avec une confirmation. Elle est journalisée, que l'auteur de la suppression soit un profil ou l'admin.
- Chaque fiche est liée à la **version** du template utilisée pour la créer. Modifier un template ne casse jamais les fiches existantes.
- Avertissement en cas de modifications non sauvegardées, validation au fil de la saisie.

### 3.2 Templates (gérés par l'admin)
Un template est un arbre JSON versionné. Chaque publication crée une version immuable et une entrée dans le journal. L'historique des versions est consultable, et on peut restaurer une version antérieure en la republiant. Un template utilisé par des fiches ne peut pas être supprimé, seulement archivé (il n'est alors plus proposé pour les nouvelles fiches).

Types de nœuds :

| Type | Comportement |
|---|---|
| `category` | Nom ; contient d'autres champs (imbrication autorisée) |
| `checkbox_group` | Liste d'options ; **chaque option** peut avoir des `children` affichés seulement quand l'option est cochée |
| `radio_group` | Idem, une seule option possible ; `children` par option |
| `date` | Prérempli avec la date du jour, modifiable via un date picker |
| `author` | Prérempli avec le profil actif, modifiable via une liste déroulante des profils |
| `reference` | Générée automatiquement, modifiable, validée et unique. **Format provisoire : `FIXME-\d{6}`** (ex. `FIXME-000042`, séquence incrémentale). Le motif et la regex sont centralisés dans un seul module de configuration pour être remplacés facilement plus tard. |
| `text` | Une ligne ou plusieurs (`multiline`), longueur max configurable |

Attributs communs : `id` stable (UUID), `label`, `required`, `help`, `annex_ref` (optionnel : `{annex_id}`).
Règles pour les sous-champs conditionnels : un sous-champ masqué n'est ni validé ni exporté, et sa valeur est effacée quand l'option parente est décochée (avec une confirmation si la valeur n'était pas vide).

Éditeur : arbre avec glisser-déposer, panneau de propriétés et **aperçu en direct** à côté. Le schéma est validé par Pydantic côté serveur et par zod côté client.

### 3.3 Export PDF
Généré côté serveur à partir d'un gabarit HTML. Le rendu est fidèle à la fiche : catégories, seules les options cochées et leurs sous-champs visibles, commentaires, référence, auteur et date, avec un pied de page qui reprend la référence et la pagination. Le fichier est nommé d'après la référence.

## 4. Annexes (gérées par l'admin)
- Fichiers **PDF** uploadés par l'admin : taille maximale configurable, type vérifié par les octets magiques et pas seulement par l'extension. Les fichiers sont stockés sur un volume dédié, avec leurs métadonnées en base.
- Un **extrait** est extrait automatiquement à l'upload (pypdf). L'admin peut le modifier.
- Un menu « Annexes » liste les annexes, avec une recherche. Il est accessible au compte utilisateur.
- Tout champ d'un template peut référencer une annexe. Le label est alors suivi d'une icône **« i »** :
  - au survol (et au focus clavier) : une infobulle cliquable affiche l'extrait ;
  - au clic : le PDF s'ouvre dans un nouvel onglet (`Content-Disposition: inline`).
- Suppression : elle est bloquée tant que l'annexe est référencée par la version publiée d'un template, et le message liste les templates concernés. Dans les anciennes versions, une référence vers une annexe supprimée affiche « Annexe supprimée ».

## 5. Sécurité
- HTTPS obligatoire (Caddy, avec une CA interne en local).
- Sessions côté serveur : cookie `HttpOnly; Secure; SameSite=Strict`, expiration après inactivité (configurable), protection CSRF.
- En-têtes HSTS, CSP stricte (`default-src 'self'`), `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`.
- Autorisations centralisées dans des dépendances FastAPI : `require_admin`, `require_user`, `require_active_profile`, `require_form_owner_or_admin`.
- PostgreSQL sur un réseau interne, non exposé. Secrets dans des secrets compose, jamais dans l'image. Conteneurs non-root.
- Analyse des dépendances (pip-audit, npm audit) et des images (Trivy).
- Sauvegardes : script `make backup` (dump de la base et archive du volume des annexes) et procédure de restauration documentée.
- RGPD : seules des données minimales sur les personnes sont stockées (noms des profils).

## 6. Journal d'activité (lu par l'admin)
En ajout seul, filtrable par date, type d'action et profil. Il enregistre :
- connexions, échecs, verrouillages et réinitialisations de mot de passe (y compris par la commande CLI) ;
- changements de profil actif ;
- création, modification, suppression et export de fiches (profil ou admin, référence) ;
- modifications des templates, des annexes et des profils.

## 7. Stack technique

### Back-end (Python)
- **FastAPI** + Pydantic v2, **SQLAlchemy 2** + **Alembic**, **PostgreSQL 16**.
- `argon2-cffi` pour les mots de passe, **WeasyPrint** pour les PDF, **pypdf** pour les extraits d'annexes.
- CLI interne (`app.cli`) : `install`, `reset-admin-password`, `migrate`.
- Tests : pytest et httpx, avec une base Postgres de test lancée en conteneur.

### Front-end (proposition)
- **React 18 + TypeScript + Vite**.
- **Mantine** (composants accessibles, `DatePicker` localisé en français, tooltips, notifications, thème clair et sombre) ; **react-hook-form** + **zod** pour les formulaires dynamiques ; **TanStack Query** pour les appels API ; **dnd-kit** pour l'éditeur de template.
- Interface en français, accessible (WCAG 2.1 AA). Optimisée pour poste de travail, utilisable sur tablette. Aucune ressource tierce (CDN, polices, analytics).
- Tests : Vitest pour la logique, **Playwright** pour l'end-to-end.

### Déploiement
`compose.yaml`, compatible docker compose et podman-compose, avec 3 services :
1. `proxy` : Caddy (TLS, en-têtes de sécurité, sert le build statique du front) ;
2. `api` : FastAPI/uvicorn, image slim, utilisateur non-root, volume `annexes` ;
3. `db` : PostgreSQL, volume nommé, réseau interne.

Un `Makefile` fournit `up`, `down`, `install`, `migrate`, `backup`, `test`.

## 8. Modèle de données (PostgreSQL)
`accounts(id, role ∈ {admin, user} UNIQUE, password_hash, password_changed_at, failed_attempts, locked_until)`
`profiles(id, display_name, initials, color, archived_at, created_at)`
`templates(id, name, archived_at)` · `template_versions(id, template_id, version, schema_json, published_at)`
`forms(id, template_version_id, reference UNIQUE, owner_profile_id, data JSONB, created_at, updated_at)`
`annexes(id, title, filename, storage_path, size, sha256, excerpt, created_at)`
`reference_counters(prefix, value)` · `activity_log(id, at, account_role, profile_id, action, target_type, target_id, details JSONB)` · `sessions(id, account_id, active_profile_id, expires_at)`

## 9. Arborescence cible
```
/compose.yaml  /Caddyfile  /Makefile  /README.md
/backend/  app/{main.py, cli.py, api/, models/, schemas/, services/, pdf/, config/reference.py}  alembic/  tests/  Dockerfile
/frontend/ src/{auth/, profiles/, forms/renderer/, templates/editor/, annexes/, admin/}  tests/  e2e/
```

## 10. Jalons
1. **Socle** : compose, FastAPI, Postgres, Alembic, Caddy, squelette React, CI et tests.
2. **Comptes** : commande `install`, connexion, sessions, verrouillage, réinitialisation du compte utilisateur par l'admin, commande `reset-admin-password`.
3. **Profils** : gestion par l'admin, écran de choix, changement de profil, archivage.
4. **Templates** : schéma, validation, éditeur arborescent avec aperçu, versionnement, archivage.
5. **Fiches** : moteur de rendu dynamique, sous-champs conditionnels, champs date, auteur et référence `FIXME-\d{6}`, liste, recherche, règles de propriété, suppression.
6. **Annexes** : upload de PDF, extraits, menu, icône « i » avec infobulle et ouverture dans un onglet.
7. **Export PDF**.
8. **Journal d'activité** et durcissement (en-têtes, rate limiting, audits, sauvegardes).

## 11. Vérification
- **Unitaires** : back (schémas de template, unicité et format de la référence, extraction d'extrait, génération PDF) ; front (logique conditionnelle des sous-champs, regex de référence).
- **Matrice d'autorisations** (tests API paramétrés) :
  - le compte utilisateur reçoit un 403 sur toutes les routes admin (profils, templates, annexes en écriture, journal, réinitialisation) ;
  - l'admin peut modifier et supprimer les fiches de n'importe quel profil, le propriétaire reste inchangé et le journal attribue l'action au compte admin ; l'admin reçoit un 403 sur la création de fiches ;
  - le profil A peut modifier et supprimer ses fiches, et reçoit un 403 sur celles du profil B ; après un changement de profil vers B, l'écriture réussit et le journal contient le changement de profil ;
  - une action d'écriture sans profil actif reçoit un 403 ;
  - la suppression d'une annexe référencée par une version publiée est refusée ;
  - la suppression d'un profil qui a des fiches l'archive sans supprimer les fiches.
- **CLI** : un second `install` échoue ; `reset-admin-password` change le mot de passe et ferme les sessions admin.
- **E2E Playwright** : installation, connexion admin, création de profils, d'un template avec sous-champs et d'une annexe ; connexion utilisateur, choix d'un profil, remplissage d'une fiche, export PDF, infobulle de l'annexe et ouverture dans un nouvel onglet ; changement de profil et lecture seule sur la fiche de l'autre profil ; modification puis suppression de cette fiche par l'admin ; réinitialisation du mot de passe utilisateur par l'admin.
- **Déploiement** : `docker compose up` et `podman-compose up` démarrent tous les deux sur une machine vierge, puis `make install` initialise l'instance.

## 12. Points clés
- Deux comptes uniques (admin et utilisateur), créés à l'installation, sans inscription.
- Plusieurs profils sur le compte utilisateur, avec changement sans mot de passe. La séparation entre profils est logique et ne constitue pas une sécurité.
- L'admin peut modifier et supprimer toutes les fiches, mais n'en crée pas.
- Le compte utilisateur est réinitialisé par l'admin. Le compte admin n'est réinitialisable que par une commande serveur.
- Annexes au format PDF.
- Format de référence provisoire `FIXME-\d{6}`.
