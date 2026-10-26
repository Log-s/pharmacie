# Sauvegarde et restauration

Une sauvegarde est un seul fichier, `db-<AAAAMMJJ>T<HHMMSS>Z.dump` (horodatage UTC), écrit dans
`backups/` (ignoré par git, droits `600`) : un `pg_dump -Fc` de la base, qui contient les comptes,
les profils, les templates, les fiches, les annexes (dossiers et notes) et le journal. Aucun
volume n'est à sauvegarder en plus.

Les secrets (`secrets/db_password`, `secrets/secret_key`) ne sont **pas** dans la sauvegarde :
conservez-les à part. Sans l'ancienne `secret_key`, les sessions ouvertes sont invalidées (les
utilisateurs se reconnectent), rien d'autre n'est perdu.

## Sauvegarder

La pile doit tourner (`make up`).

```sh
make backup
# backups/db-20261024T144151Z.dump
```

Le dump est cohérent (un seul instantané). Copiez ensuite `backups/` sur un support extérieur à la
machine (la sauvegarde contient des données personnelles : noms des profils, journal).

Pour planifier, voir [Exploitation](operations.md#sauvegardes-planifiees) (timer systemd ou cron, avec
purge des anciens fichiers selon votre politique de rétention).

## Restaurer

La restauration **remplace** la base de la pile ciblée.

1. Machine neuve : préparez-la comme indiqué dans [Déploiement](deploiement.md), recopiez vos anciens
   `secrets/*` si vous les avez (sinon `make secrets`), puis `make up`. Ne lancez pas `make install` : les comptes viennent de la sauvegarde.
2. Restaurez le fichier de sauvegarde :

   ```sh
   make restore DB=backups/db-20261024T144151Z.dump
   ```

   Le script procède dans cet ordre :

   1. **Vérification, sans rien arrêter** : le fichier existe, n'est pas vide et se lit en entier
      avec `pg_restore`. Un fichier faux ou tronqué est refusé (code 2) : base et pile intactes, la
      pile continue de tourner. Il demande ensuite de taper `oui` ; sans terminal, ajoutez
      `YES=--yes`.
   2. **Arrêt de `proxy` et `api`**, puis **chargement de la base** : le schéma `public` est recréé
      et le dump chargé dans **une seule transaction**. Échec (code 1) : la transaction est
      annulée, la base reste inchangée et la pile reste arrêtée.
   3. **Relance de toute la pile** (l'api applique les migrations manquantes au démarrage).

   Après un échec à l'étape 2, corrigez la cause (place disque, droits) puis relancez
   `make restore` ou, pour reprendre sans restaurer, `make up`.
3. Vérifiez :

   ```sh
   podman-compose exec -T db psql -U pharmacie pharmacie -c \
     "SELECT (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM activity_log) AS journal"
   curl http://localhost:8080/api/health
   ```

   puis connectez-vous en admin et ouvrez le journal et une note des annexes.

## Test de la procédure

Réalisé sur la pile `u9` (`HTTPS_PORT=19443`, `make install` non interactif, une connexion admin
pour alimenter le journal), puis restauré dans une seconde pile neuve `u9-restore` (volumes
vierges, `HTTPS_PORT=19444`) : `accounts = 2`, `profiles = 1`, `activity_log = 1` identiques à la
source, `alembic_version = u1_initial`, `/api/health` répond `ok`, la connexion admin fonctionne
avec le mot de passe d'origine et le journal restauré est lisible via `/api/journal`. Un `UPDATE`
sur `activity_log` reste refusé après restauration (trigger restauré avec le schéma).

Contrôle des refus (pile `u9` remplie) : dump tronqué ou fichier qui n'est pas un dump sont refusés
avant tout arrêt ; conteneurs et comptes (2/1/1) inchangés. Restauration par-dessus une pile déjà
modifiée (table et profil en trop) : la pile retrouve exactement l'état de la sauvegarde. Ces
essais datent de la version où les annexes étaient des PDF dans un volume ; la partie base n'a pas
changé depuis.
