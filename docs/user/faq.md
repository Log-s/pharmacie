# Questions fréquentes

## Le navigateur affiche un avertissement de sécurité

Le certificat HTTPS de l'application est émis par une autorité interne, que les navigateurs ne
connaissent pas. Votre administrateur peut installer cette autorité sur les postes une fois pour
toutes (voir [Déployer en production](../dev/deploiement.md#faire-confiance-au-certificat)) ;
l'avertissement disparaît alors.

Ne contournez pas l'avertissement sur une adresse que vous ne reconnaissez pas.

## « Compte verrouillé » ou « Trop de tentatives »

Plusieurs mots de passe faux ont été saisis. Attendez le délai indiqué (15 minutes au plus), puis
réessayez avec le bon mot de passe. Chaque nouvel échec allonge le délai.

## J'ai oublié le mot de passe utilisateur

L'administrateur en définit un nouveau dans **Compte utilisateur**. Les profils et les fiches sont
conservés.

## J'ai oublié le mot de passe administrateur

Il se réinitialise uniquement sur le serveur, par la personne qui l'exploite :

```sh
make reset-admin-password
```

Voir [Exploitation](../dev/operations.md#reinitialiser-le-mot-de-passe-administrateur).

## Je ne vois pas les boutons Modifier et Supprimer

La fiche appartient à un autre profil (mention **Fiche de *Nom***). Passez sur ce profil depuis
l'en-tête si vous devez vraiment la corriger.

## Je ne vois pas le bouton Nouvelle fiche

Il est réservé au compte utilisateur, avec un profil choisi. L'administrateur ne crée pas de
fiches.

## Mon template n'apparaît pas dans Nouvelle fiche

Seuls les templates publiés et non archivés sont proposés. L'administrateur doit cliquer sur
**Publier la version N** dans l'éditeur.

## J'ai été déconnecté

La session se ferme après 30 minutes sans activité, ou quand l'administrateur change le mot de
passe utilisateur. Reconnectez-vous ; une saisie non enregistrée est perdue.
