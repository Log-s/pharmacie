# Mises à jour et migrations

## Mettre à jour une instance

Le conteneur `api` applique les migrations Alembic manquantes à chaque démarrage
(`python -m app.cli migrate`). Une mise à jour revient donc à reconstruire et relancer la pile.

1. **Prévenez l'équipe** : la pile est indisponible une à deux minutes.
2. **Sauvegardez**, et notez la version en place :

    ```sh
    cd ~/pharmacie
    git rev-parse HEAD > backups/version-avant-maj.txt
    make backup
    ```

3. **Récupérez la nouvelle version**, de préférence un tag validé par `make e2e` :

    ```sh
    git fetch --tags
    git log --oneline HEAD..<version>    # ce qui va changer
    git checkout <version>
    ```

    Lisez les messages de commit à la recherche de migrations (`backend/alembic/versions/`) ou de
    nouveaux réglages.

4. **Relancez** :

    ```sh
    make up                       # reconstruit les images, recrée les conteneurs, migre au démarrage
    podman-compose logs api | tail -20
    curl -k https://<hôte>/api/health
    ```

5. **Vérifiez** : connexion admin, une fiche, un export PDF, le journal.

### Revenir en arrière

Si la nouvelle version pose problème, revenez à la version notée **et** à la sauvegarde prise juste
avant : une migration a pu modifier le schéma, et l'ancienne version ne connaît pas le nouveau.

```sh
git checkout "$(cat backups/version-avant-maj.txt)"
podman-compose build          # anciennes images ; restore relance la pile avec elles
make restore DB=backups/db-<horodatage>.dump ANNEXES=backups/annexes-<horodatage>.tar.gz
```

Les fiches saisies entre la sauvegarde et le retour arrière sont perdues : décidez vite.

### Rafraîchir les images de base

`make up` réutilise les images de base déjà téléchargées. Pour intégrer les correctifs de sécurité
de Python, Node, Caddy et PostgreSQL (même version majeure) :

```sh
podman pull docker.io/library/postgres:16-alpine
podman-compose build --pull-always
make up
make audit
```

## Écrire une migration

Toute modification du schéma passe par une migration Alembic, dans
`backend/alembic/versions/`. Un test (`backend/tests/`) échoue si les modèles SQLAlchemy et les
migrations divergent.

1. Modifiez les modèles dans `backend/app/models/`.
2. Générez la migration dans le conteneur de développement (`make dev` en cours ; `--user 0`
   pour que le fichier créé appartienne à votre utilisateur sur l'hôte) :

    ```sh
    podman exec --user 0 pharmacie-api-dev \
      alembic revision --autogenerate --rev-id <slug> -m "<description>"
    ```

    Convention : l'identifiant de révision est un nom court explicite (`u1_initial`,
    `ship_activity_truncate`), pas un hachage.

3. **Relisez** le fichier : l'autogénération ne voit ni les triggers, ni les fonctions, ni les
   données à transformer. Écrivez `downgrade()`.
4. Appliquez-la : le conteneur de dev ne migre qu'à son lancement, relancez `make dev` (ou
   `make migrate`), puis `make check`.

Sur une instance, `make migrate` applique les migrations sans attendre un redémarrage de l'api.

## Migrer vers un autre serveur

Pour déplacer une instance (changement de machine, d'hébergeur) :

1. **Sur l'ancien serveur** : prévenez l'équipe, puis

    ```sh
    cd ~/pharmacie
    make backup
    podman-compose stop proxy                 # plus aucun accès, donc plus aucune écriture
    make backup                               # sauvegarde finale, cohérente
    podman volume export pharmacie_caddy_data > backups/caddy_data.tar   # garde l'autorité TLS
    ```

2. **Copiez** sur le nouveau serveur, par un canal chiffré : la dernière paire
   `db-*.dump` / `annexes-*.tar.gz`, `caddy_data.tar`, le dossier `secrets/` et `.env`.

    ```sh
    scp -r backups/db-<h>.dump backups/annexes-<h>.tar.gz backups/caddy_data.tar secrets .env \
      pharmacie@nouveau:~/transfert/
    ```

3. **Sur le nouveau serveur** : suivez [Déployer en production](deploiement.md) jusqu'au clonage,
   à la même version que l'ancien, puis, **sans** `make install` :

    ```sh
    cd ~/pharmacie
    cp -r ~/transfert/secrets ~/transfert/.env .
    chmod 700 secrets
    podman volume create pharmacie_caddy_data
    podman volume import pharmacie_caddy_data ~/transfert/caddy_data.tar
    make up
    make restore DB=~/transfert/db-<h>.dump ANNEXES=~/transfert/annexes-<h>.tar.gz
    ```

4. **Basculez** le nom d'hôte (DNS) vers le nouveau serveur. Gardant `caddy_data`, les postes
   reconnaissent déjà la racine du certificat. Vérifiez la connexion, une fiche, une annexe.
5. **Arrêtez l'ancien** une fois la bascule validée (`make down`), puis effacez ses données selon
   votre politique (elles contiennent des données personnelles).

Si `SITE_HOST` change, Caddy émet un nouveau certificat avec la même racine : rien à faire sur les
postes.

## Changer de version majeure de PostgreSQL

Le volume `pgdata` d'une version majeure n'est pas lisible par la suivante : on passe par une
sauvegarde logique.

```sh
make backup
make down
podman volume rm pharmacie_pgdata
# modifier l'image de db dans compose.yaml et compose.test.yaml (ex. postgres:17-alpine)
make check                     # les tests passent sur la nouvelle version
make up
make restore DB=backups/db-<h>.dump ANNEXES=backups/annexes-<h>.tar.gz
```

Gardez la sauvegarde tant que la nouvelle version n'est pas validée.
