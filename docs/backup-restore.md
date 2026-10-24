# Sauvegarde et restauration

Une sauvegarde se compose de deux fichiers de même horodatage (UTC), écrits dans `backups/`
(ignoré par git, droits `600`) :

- `db-<AAAAMMJJ>T<HHMMSS>Z.dump` : `pg_dump -Fc` de la base (comptes, profils, templates, fiches,
  journal) ;
- `annexes-<AAAAMMJJ>T<HHMMSS>Z.tar.gz` : archive du volume des annexes (`/data/annexes`).

Les secrets (`secrets/db_password`, `secrets/secret_key`) ne sont **pas** dans la sauvegarde :
conservez-les à part. Sans l'ancienne `secret_key`, les sessions ouvertes sont invalidées (les
utilisateurs se reconnectent), rien d'autre n'est perdu.

## Sauvegarder

La pile doit tourner (`make up`).

```sh
make backup
# backups/db-20261024T144151Z.dump
# backups/annexes-20261024T144151Z.tar.gz
```

Avec podman : `make COMPOSE=podman-compose ENGINE=podman backup`. Le dump est cohérent (un seul
instantané) ; l'archive des annexes est prise juste après, hors transaction : sauvegardez de
préférence hors des heures d'usage. Copiez ensuite `backups/` sur un support extérieur à la
machine (la sauvegarde contient des données personnelles : noms des profils, journal).

Pour planifier : `0 2 * * * cd /chemin/du/depot && make backup` (cron), avec purge des anciens
fichiers selon votre politique de rétention.

## Restaurer

La restauration **remplace** la base et les annexes de la pile ciblée.

1. Machine neuve : `make secrets` puis recopiez vos anciens `secrets/*` si vous les avez, puis
   `make up`. Ne lancez pas `make install` : les comptes viennent de la sauvegarde.
2. Restaurez les deux fichiers d'un même horodatage :

   ```sh
   make restore DB=backups/db-20261024T144151Z.dump ANNEXES=backups/annexes-20261024T144151Z.tar.gz
   ```

   Le script demande de taper `oui` ; sans terminal, ajoutez `YES=--yes`. Il arrête `proxy` et
   `api`, vide le schéma `public`, exécute `pg_restore` (`--no-owner`, arrêt à la première erreur),
   vide puis réalimente le volume des annexes, puis relance toute la pile (l'api applique les
   migrations manquantes au démarrage).
3. Vérifiez :

   ```sh
   docker compose exec -T db psql -U pharmacie pharmacie -c \
     "SELECT (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM activity_log) AS journal"
   curl -k https://localhost:8443/api/health
   ```

   puis connectez-vous en admin et ouvrez le journal et une annexe.

## Test de la procédure

Réalisé sur la pile `u9` (`HTTPS_PORT=19443`, `make install` non interactif, une connexion admin
pour alimenter le journal, un fichier dans le volume des annexes), puis restauré dans une seconde
pile neuve `u9-restore` (volumes vierges, `HTTPS_PORT=19444`) : `accounts = 2`, `profiles = 1`,
`activity_log = 1` identiques à la source, `sha256` du fichier d'annexe identique,
`alembic_version = u1_initial`, `/api/health` répond `ok`, la connexion admin fonctionne avec le
mot de passe d'origine et le journal restauré est lisible via `/api/journal`. Un `UPDATE` sur
`activity_log` reste refusé après restauration (trigger restauré avec le schéma).
