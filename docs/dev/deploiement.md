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

### Port HTTP

La pile n'écoute qu'en HTTP, sur `HTTP_BIND:HTTP_PORT` (défaut `127.0.0.1:8080`, réglé en tête du
`Makefile`). Le HTTPS est assuré par un **nginx** installé sur l'hôte, qui relaie vers ce port (voir
[Configurer nginx](#configurer-nginx)). N'ouvrez dans le pare-feu que le port de nginx (443), pas
celui de la pile.

## Installer

```sh
git clone <url-du-dépôt> ~/pharmacie
cd ~/pharmacie
git checkout <version>            # un tag ou un commit validé par make e2e
```

Pour changer le port ou l'adresse d'écoute, modifiez `HTTP_PORT` / `HTTP_BIND` en tête du `Makefile`
ou passez-les à `make up` (`make up HTTP_PORT=8081`).

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
curl http://127.0.0.1:8080/api/health                    # {"status":"ok"}
```

!!! warning "Copiez les secrets hors de la machine"
    `secrets/db_password` et `secrets/secret_key` ne sont pas dans les sauvegardes. Rangez-en une
    copie avec les mots de passe admin et utilisateur, dans un coffre de mots de passe.

## Configurer nginx

nginx termine le TLS avec le certificat de votre choix et relaie tout vers la pile. Il doit
**remplacer** `X-Forwarded-For` par l'adresse du client (pas l'ajouter) : l'api s'en sert pour
limiter les tentatives de connexion par IP, et une valeur fournie par le client la contournerait.

```nginx title="/etc/nginx/conf.d/interventions.conf"
server {
    listen 443 ssl;
    http2 on;
    server_name interventions.officine.local;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    client_max_body_size 1m;   # même limite que Caddy sur /api/*

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Les en-têtes de sécurité (CSP, `X-Frame-Options`…) viennent de Caddy ; HSTS est à la charge de
nginx. Le cookie de session est `Secure` : l'application ne fonctionne qu'en HTTPS derrière nginx
(ou sur `http://localhost` en local).

## Démarrage automatique

`restart: unless-stopped` relance un conteneur qui s'arrête, mais podman n'a pas de démon : après un
redémarrage du serveur, c'est `podman-restart.service` qui relance les conteneurs. Activez-le pour
l'utilisateur `pharmacie` :

```sh
systemctl --user enable --now podman-restart.service
```

Avec le *linger* activé à l'étape 1, la pile repart au démarrage sans que personne ne se connecte.
Testez une fois : `sudo reboot`, puis `curl https://<hôte>/api/health`.

## Avant d'ouvrir à l'équipe

- [ ] `make backup` fonctionne et les sauvegardes sont planifiées et copiées hors machine
  ([Exploitation](operations.md#sauvegardes-planifiees)) ;
- [ ] une restauration a été essayée sur une pile de test ([Sauvegarde et restauration](backup-restore.md)) ;
- [ ] les secrets et mots de passe sont rangés hors de la machine ;
- [ ] `make audit` ne remonte rien de bloquant ;
- [ ] nginx sert l'application en HTTPS avec un certificat reconnu par les postes ;
- [ ] l'administrateur a créé les profils et publié au moins un template
  ([guide utilisateur](../user/administration.md)).
