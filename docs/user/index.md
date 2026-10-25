# Premiers pas

L'application s'ouvre dans un navigateur récent (Firefox, Chrome, Edge, Safari), sur un poste de
travail ou une tablette. Votre administrateur vous donne son adresse, par exemple
`https://interventions.officine.local:8443`.

## Les deux comptes

Il n'existe que deux comptes, il n'y a pas d'inscription :

| Compte | Pour qui | Ce qu'il permet |
|---|---|---|
| **Utilisateur** | toute l'équipe, mot de passe partagé | consulter toutes les fiches, créer des fiches, modifier et supprimer les fiches de son profil, exporter en PDF, consulter les annexes |
| **Administrateur** | une seule personne | tout ce qui précède sur **toutes** les fiches (sans en créer), plus les profils, les templates, les annexes, le journal d'activité et le mot de passe du compte utilisateur |

## Se connecter

1. Ouvrez l'adresse de l'application. L'écran **Connexion** s'affiche.
2. Choisissez le compte : **Utilisateur** ou **Administrateur**.
3. Saisissez le mot de passe, puis validez.

Après 5 mots de passe faux de suite, le compte est verrouillé quelques minutes (une minute d'abord,
puis le double à chaque nouvel échec, 15 minutes au plus). Le message indique quand réessayer.

Sans activité pendant 30 minutes, la session se ferme et l'application vous ramène à l'écran de
connexion. Pensez à **Se déconnecter** (en haut à droite) sur un poste partagé.

## Choisir son profil (compte utilisateur)

Chaque membre de l'équipe a un **profil** : un nom, un numéro et une couleur. Le compte
utilisateur étant partagé, c'est le profil qui dit qui fait quoi.

1. Après la connexion, l'écran **Choix du profil** affiche les profils sous forme de cartes.
2. Cliquez sur le vôtre. Son numéro apparaît dans l'en-tête.
3. Pour passer à un autre profil, cliquez sur votre nom dans l'en-tête : la liste
   **Changer de profil** s'ouvre, choisissez le profil. Aucun mot de passe n'est demandé.

Chaque fiche créée, modifiée ou supprimée est attribuée au profil actif, et chaque changement de
profil est noté dans le journal d'activité.

!!! note "Une barrière contre les erreurs, pas une sécurité"
    Un profil ne peut modifier ou supprimer que ses propres fiches. Changer de profil pour corriger
    la fiche d'un collègue est permis : la règle sert à éviter les erreurs de manipulation, et le
    journal garde la trace des changements.

Si l'écran indique **Aucun profil disponible**, l'administrateur doit d'abord créer les profils.

## Se repérer

L'en-tête contient :

- le nom de l'application, qui ramène à la liste des fiches ;
- le menu : **Fiches** et **Annexes** (plus **Profils**, **Templates**, **Journal** et
  **Compte utilisateur** pour l'administrateur) ;
- le profil actif (ou la mention « Administrateur ») ;
- le bouton de thème, pour passer en thème clair ou sombre ;
- **Se déconnecter**.

L'application se pilote entièrement au clavier : ++tab++ pour avancer, ++enter++ pour valider,
++esc++ pour fermer une fenêtre. Le premier ++tab++ propose **Aller au contenu**.

## Pour aller plus loin

- [Fiches](fiches.md) : rechercher, créer, remplir, modifier, exporter en PDF.
- [Annexes](annexes.md) : consulter les documents de référence.
- [Administration](administration.md) : écrans réservés à l'administrateur.
- [Questions fréquentes](faq.md) : avertissement de certificat, mot de passe oublié…
