# Déployer en production

Cette page installe une instance neuve sur un serveur Linux. Pour mettre à jour une instance
existante ou la déplacer sur une autre machine, voir [Mises à jour et migrations](migrations.md).

## Préparer le serveur

Il faut :

- un Linux récent avec **podman** 5+, **podman-compose** 1.5+, **git**, **make**, **bash**, **curl** ;
- 2 Go de RAM et quelques Go de disque (images ~1,5 Go, plus les données et les sauvegardes) ;
- un nom d'hôte que les postes résolvent, par exemple `interventions.officine.local`.

```sh
# Debian / Ubuntu
sudo apt install podman podman-compose git make curl
# Fedora / RHEL
sudo dnf install podman podman-compose git make curl
```

Créez un utilisateur dédié, sans droits d'administration : toute la pile tourne sous ce compte
(podman rootless).

```sh
sudo useradd --create-home --shell /bin/bash pharmacie
grep pharmacie /etc/subuid /etc/subgid   # une plage de sous-uid doit exister (créée par useradd)
sudo loginctl enable-linger pharmacie    # ses conteneurs vivent sans session ouverte
```

Connectez-vous ensuite **directement** sous ce compte (`ssh pharmacie@serveur` ou
`sudo machinectl shell pharmacie@`) : un simple `su` ne crée pas l'environnement systemd utilisateur
dont podman a besoin. Vérifiez :

```sh
podman info --format '{{.Host.Security.Rootless}}'   # true
```

### Port HTTPS

Un utilisateur non root ne peut pas ouvrir les ports inférieurs à 1024. Deux possibilités :

- **garder 8443** (défaut) : l'adresse sera `https://interventions.officine.local:8443` ;
- **servir sur 443**, en abaissant le seuil des ports privilégiés (une fois, en root) :

    ```sh
    echo 'net.ipv4.ip_unprivileged_port_start=443' | sudo tee /etc/sysctl.d/90-unprivileged-443.conf
    sudo sysctl --system
    ```

Ouvrez ce port dans le pare-feu, et seulement celui-là (par exemple
`sudo firewall-cmd --permanent --add-port=443/tcp && sudo firewall-cmd --reload`, ou
`sudo ufw allow 443/tcp`). L'application n'écoute pas en HTTP.

## Installer

```sh
git clone <url-du-dépôt> ~/pharmacie
cd ~/pharmacie
git checkout <version>            # un tag ou un commit validé par make e2e
```

Créez `~/pharmacie/.env` (ignoré par git, lu par podman-compose) :

```sh
SITE_HOST=interventions.officine.local
HTTPS_PORT=443
```

Puis :

```sh
make secrets     # secrets/db_password et secrets/secret_key
make up          # construit les images et démarre proxy, api, db
make install     # crée les comptes admin et utilisateur, propose un premier profil
```

`make install` demande les deux mots de passe (saisie masquée, confirmation, 12 caractères au moins,
contrôle de robustesse) et refuse de s'exécuter si l'instance est déjà installée.

Vérifiez :

```sh
podman-compose ps                                          # 3 conteneurs « Up », db « healthy »
curl -k https://interventions.officine.local/api/health     # {"status":"ok"}
```

!!! warning "Copiez les secrets hors de la machine"
    `secrets/db_password` et `secrets/secret_key` ne sont pas dans les sauvegardes. Rangez-en une
    copie avec les mots de passe admin et utilisateur, dans un coffre de mots de passe.

## Faire confiance au certificat

Caddy émet le certificat avec son autorité interne. Exportez la racine :

```sh
podman-compose exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > interventions-root.crt
```

Puis installez `interventions-root.crt` sur chaque poste, comme autorité racine de confiance :

| Système | Méthode |
|---|---|
| Windows | double-clic sur le fichier > Installer le certificat > Ordinateur local > « Autorités de certification racines de confiance » (ou par GPO pour tout le parc) |
| macOS | Trousseaux d'accès > Système > importer, puis « Toujours approuver » |
| Linux | copier dans `/usr/local/share/ca-certificates/` puis `sudo update-ca-certificates` (Debian/Ubuntu) ; `/etc/pki/ca-trust/source/anchors/` puis `sudo update-ca-trust` (Fedora/RHEL) |
| Firefox | utilise son propre magasin : Paramètres > Vie privée et sécurité > Certificats > Importer, ou la stratégie d'entreprise `ImportEnterpriseRoots` |

La racine est valable 10 ans ; Caddy renouvelle seul le certificat du site. Elle est stockée dans le
volume `caddy_data` : si ce volume est perdu, une nouvelle racine est créée et il faut la
redistribuer (voir [migrer vers un autre serveur](migrations.md#migrer-vers-un-autre-serveur) pour
la conserver).

### Utiliser un certificat de l'entreprise

Si vous disposez d'un certificat émis par votre propre autorité, remplacez `tls internal` dans une
copie locale du `Caddyfile` et montez-la par-dessus celui de l'image :

```sh
mkdir -p ~/pharmacie/certs && cp fullchain.pem privkey.pem ~/pharmacie/certs/
podman unshare chown -R 10002:10002 ~/pharmacie/certs   # lisibles par l'uid de Caddy dans le conteneur
sed 's#tls internal#tls /certs/fullchain.pem /certs/privkey.pem#' Caddyfile > Caddyfile.local
```

```yaml title="compose.override.yaml"
services:
  proxy:
    volumes:
      - ./Caddyfile.local:/etc/caddy/Caddyfile:ro,z
      - ./certs:/certs:ro,z
```

Puis `make up`. Pensez à reporter les changements du `Caddyfile` versionné dans votre copie lors
des mises à jour.

## Démarrage automatique

`restart: unless-stopped` relance un conteneur qui s'arrête, mais podman n'a pas de démon : après un
redémarrage du serveur, c'est `podman-restart.service` qui relance les conteneurs. Activez-le pour
l'utilisateur `pharmacie` :

```sh
systemctl --user enable --now podman-restart.service
```

Avec le *linger* activé à l'étape 1, la pile repart au démarrage sans que personne ne se connecte.
Testez une fois : `sudo reboot`, puis `curl -k https://<hôte>/api/health`.

## Avant d'ouvrir à l'équipe

- [ ] `make backup` fonctionne et les sauvegardes sont planifiées et copiées hors machine
  ([Exploitation](operations.md#sauvegardes-planifiees)) ;
- [ ] une restauration a été essayée sur une pile de test ([Sauvegarde et restauration](backup-restore.md)) ;
- [ ] les secrets et mots de passe sont rangés hors de la machine ;
- [ ] `make audit` ne remonte rien de bloquant ;
- [ ] la racine du certificat est installée sur les postes ;
- [ ] l'administrateur a créé les profils et publié au moins un template
  ([guide utilisateur](../user/administration.md)).
