# Exploitation

Toutes les commandes se lancent sous l'utilisateur de la pile, depuis le dossier du dépôt.

## Commandes courantes

| Besoin | Commande |
|---|---|
| état des conteneurs | `podman-compose ps` |
| journaux en direct | `podman-compose logs -f api` (ou `proxy`, `db`) |
| santé | `curl -k https://<hôte>/api/health` → `{"status":"ok"}` |
| démarrer / reconstruire | `make up` |
| arrêter | `make down` (les volumes, donc les données, sont conservés) |
| redémarrer un service | `podman-compose restart api` |
| appliquer les migrations | `make migrate` |
| console SQL | `podman-compose exec db psql -U pharmacie pharmacie` |
| place occupée | `podman system df` |
| supprimer les vieilles images | `podman image prune` |

!!! danger "Jamais `podman-compose down -v` en production"
    `-v` supprime les volumes : base de données, annexes et autorité TLS.

## Sauvegardes planifiées

`make backup` écrit une paire de fichiers horodatés dans `backups/` (procédure complète :
[Sauvegarde et restauration](backup-restore.md)). Planifiez-la avec un timer systemd utilisateur :

```ini title="~/.config/systemd/user/pharmacie-backup.service"
[Unit]
Description=Sauvegarde Interventions pharmaceutiques

[Service]
Type=oneshot
WorkingDirectory=%h/pharmacie
ExecStart=/usr/bin/make backup
# rétention : 30 jours
ExecStartPost=/usr/bin/find %h/pharmacie/backups -name '*-*T*Z.*' -mtime +30 -delete
```

```ini title="~/.config/systemd/user/pharmacie-backup.timer"
[Unit]
Description=Sauvegarde quotidienne

[Timer]
OnCalendar=*-*-* 02:00
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now pharmacie-backup.timer
systemctl --user list-timers                 # prochaine exécution
journalctl --user -u pharmacie-backup        # résultat des sauvegardes
```

Copiez ensuite `backups/` hors de la machine (rsync, restic, borg… vers un disque ou un serveur
distinct), chiffré : les sauvegardes contiennent des données personnelles (noms des profils,
journal). Une sauvegarde non copiée ne protège pas d'une panne disque.

Essayez une restauration de temps en temps, sur une pile de test, pas sur la production.

## Réinitialiser le mot de passe administrateur

Il n'existe aucune route web pour cela, par conception. Sur le serveur :

```sh
make reset-admin-password
```

La commande demande le nouveau mot de passe (saisie masquée, confirmation, mêmes règles qu'à
l'installation), ferme les sessions admin ouvertes et l'inscrit au journal.

Le mot de passe du compte **utilisateur**, lui, se change depuis l'interface (menu
**Compte utilisateur** de l'administrateur).

## Débloquer un compte verrouillé

Le verrouillage expire seul (15 minutes au plus). Il n'y a rien à faire côté serveur ; si un compte
est verrouillé en boucle, consultez le journal (échecs de connexion et IP dans les détails).

## Surveiller

- **Santé** : interrogez `/api/health` depuis votre supervision ; il vérifie aussi la base.
- **Journal d'activité** : écran **Journal** de l'administrateur.
- **Mises à jour de sécurité** : `make audit` après chaque mise à jour, et au moins une fois par
  mois ; il construit les images et analyse les dépendances Python et npm et les images (Trivy).
  Code de sortie non nul s'il y a une vulnérabilité (Trivy : HIGH ou CRITICAL). Corrigez en
  rafraîchissant les images ([Mises à jour](migrations.md#rafraichir-les-images-de-base)) ou en
  montant la version de la dépendance.
- **Disque** : le volume `annexes` grossit avec les PDF (20 Mo au plus chacun), `backups/` avec la
  rétention.
