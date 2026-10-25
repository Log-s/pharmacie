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

Le dump est cohérent (un seul
instantané) ; l'archive des annexes est prise juste après, hors transaction : sauvegardez de
préférence hors des heures d'usage. Copiez ensuite `backups/` sur un support extérieur à la
machine (la sauvegarde contient des données personnelles : noms des profils, journal).

Pour planifier, voir [Exploitation](operations.md#sauvegardes-planifiees) (timer systemd ou cron, avec
purge des anciens fichiers selon votre politique de rétention).

## Restaurer

La restauration **remplace** la base et les annexes de la pile ciblée.

1. Machine neuve : préparez-la comme indiqué dans [Déploiement](deploiement.md), recopiez vos anciens
   `secrets/*` si vous les avez (sinon `make secrets`), puis `make up`. Ne lancez pas `make install` : les comptes viennent de la sauvegarde.
2. Restaurez les deux fichiers d'un même horodatage :

   ```sh
   make restore DB=backups/db-20261024T144151Z.dump ANNEXES=backups/annexes-20261024T144151Z.tar.gz
   ```

   Le script procède dans cet ordre, et chaque étape dit ce qu'il advient de la base et des annexes
   si elle échoue :

   1. **Vérification, sans rien arrêter** : les deux fichiers existent et ne sont pas vides,
      l'archive des annexes est une `tar.gz` lisible, le dump est lisible en entier par
      `pg_restore`. Un fichier faux, tronqué ou des arguments inversés sont refusés (code 2) : base,
      annexes et pile intactes, la pile continue de tourner. Il demande ensuite de taper `oui` ;
      sans terminal, ajoutez `YES=--yes`.
   2. **Arrêt de `proxy` et `api`**, puis **dépôt des annexes** dans un dossier temporaire `.new`
      du volume (c'est l'étape qui peut échouer faute de place ou d'accès en écriture). Échec
      (code 1) : `.new` est supprimé, base et annexes intactes, la pile reste arrêtée.
   3. **Chargement de la base** : le schéma `public` est recréé et le dump chargé dans **une seule
      transaction**. Échec (code 1) : la transaction est annulée, `.new` est supprimé, base et
      annexes intactes, la pile reste arrêtée.
   4. **Bascule des annexes** : uniquement des renommages dans le volume (les anciens fichiers vont
      dans `.old`, les nouveaux prennent leur place, puis `.old` est supprimé), puis relance de
      toute la pile (l'api applique les migrations manquantes au démarrage). Cette étape n'écrit
      plus de données et n'est pas censée échouer ; si elle échouait, la base est déjà restaurée :
      relancez la même commande `make restore`, elle est rejouable.

   Après un échec aux étapes 2 ou 3, corrigez la cause (place disque, droits) puis relancez
   `make restore` ou, pour reprendre sans restaurer, `make up`.
3. Vérifiez :

   ```sh
   podman-compose exec -T db psql -U pharmacie pharmacie -c \
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

Contrôle des refus (pile `u9` remplie, `test-results/U9-C3c.log`) : dump tronqué et arguments
inversés sont refusés avant tout arrêt ; conteneurs, comptes (2/1/1) et `sha256` des annexes
inchangés. Échecs simulés à l'étape 2, pile `u9` volontairement différente de la sauvegarde (profil
et fichier d'annexe en trop) : archive valide pour `tar -tzf` mais non extractible, puis volume des
annexes en lecture seule. Dans les deux cas : code 1, `.new` absent, le profil et le fichier en trop
sont toujours là (ni la base ni les annexes n'ont été touchées), `make up` relance la pile.
Restauration par-dessus une pile déjà modifiée (table et profil en trop, fichiers d'annexes en
trop) : la pile retrouve exactement l'état de la sauvegarde.
