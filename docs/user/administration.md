# Administration

Ces écrans sont réservés au compte **Administrateur**. L'administrateur n'utilise pas de profil :
ses actions sont attribuées au compte admin dans le journal. Il ne crée pas de fiches, mais peut
modifier ou supprimer n'importe laquelle, par exemple pour corriger une erreur ; le profil
propriétaire de la fiche ne change pas.

## Profils

Le menu **Profils** liste les profils de l'équipe.

- **Nouveau profil** : nom affiché (100 caractères au plus), numéro (nombre entier de 1 à 999,
  proposé automatiquement : le plus petit libre) et couleur. Le nom et le numéro apparaissent dans
  l'en-tête et sur les fiches. Deux profils actifs ne peuvent pas avoir le même numéro ; un profil
  archivé garde le sien, qu'un nouveau profil peut alors reprendre.
- **Modifier** : change le nom, le numéro ou la couleur. Les fiches existantes affichent les
  nouvelles valeurs.
- **Supprimer** : la fenêtre de confirmation indique combien de fiches sont liées au profil.
    - sans fiche : le profil est **supprimé définitivement** ;
    - avec des fiches : le profil est **archivé**. Il disparaît du choix de profil, ses fiches
      restent consultables en lecture seule avec la mention « *Nom* (profil supprimé) ».

## Templates

Un template est le modèle d'une fiche. Le menu **Templates** liste les templates avec leur version
publiée et leur état (**Actif**, **Archivé**, **Jamais publié**).

### Créer et modifier

1. **Créer un template**, donnez-lui un nom, puis validez : l'éditeur s'ouvre.
2. L'éditeur a trois zones :
    - **Structure** : l'arbre des champs. **Ajouter un champ** propose les types ci-dessous.
      Réorganisez par glisser-déposer (poignée **Déplacer**) ou avec les boutons **Monter** et
      **Descendre** ; le champ **Emplacement** du panneau de propriétés déplace aussi un champ.
    - **Propriétés** : les réglages du champ sélectionné.
    - **Aperçu** : la fiche telle que l'équipe la verra, en mode **Saisie** ou **Lecture seule**.
      Rien n'y est enregistré.
3. **Publier la version N** enregistre une nouvelle version. Tant que vous n'avez pas publié, rien
   n'est visible pour l'équipe ; quitter l'éditeur demande **Quitter sans publier ?**.

| Type | Usage |
|---|---|
| **Catégorie** | regroupe d'autres champs, sous un titre ; les catégories s'imbriquent |
| **Cases à cocher** | plusieurs options possibles |
| **Choix unique** | une seule option parmi plusieurs |
| **Texte** | une ligne, ou **Plusieurs lignes** ; **Longueur maximale** facultative |
| **Date** | préremplie avec la date du jour |
| **Auteur** | prérempli avec le profil actif |
| **Référence** | numéro unique proposé automatiquement ; une seule par template |

Réglages communs : **Libellé**, **Champ obligatoire**, **Aide** (affichée sous le libellé) et
**Annexe** (**Lier une annexe** ajoute l'icône « i » après le libellé).

**Sous-champs conditionnels.** Sur une option de **Cases à cocher** ou de **Choix unique**, ajoutez
des champs « si l'option est cochée » : ils n'apparaissent dans la fiche que lorsque l'option est
cochée ou choisie. Supprimer une option supprime aussi ses sous-champs.

### Versions

Chaque publication crée une version figée. Les fiches restent liées à la version qui a servi à
les créer : publier une nouvelle version ne modifie jamais les fiches existantes.

**Historique des versions** liste les versions publiées. **Restaurer la version N** republie
l'ancienne structure comme nouvelle version (cela remplace aussi les modifications non publiées
en cours).

### Archiver ou supprimer

- **Archiver** : le template n'est plus proposé pour les nouvelles fiches ; les fiches existantes
  restent consultables. Un template archivé ne peut pas être désarchivé.
- **Supprimer** : le template et toutes ses versions disparaissent. C'est refusé si des fiches
  l'utilisent : archivez-le plutôt.

## Annexes

Dans le menu **Annexes**, l'administrateur voit en plus le formulaire d'ajout et les boutons
**Modifier** et **Supprimer**.

- **Ajouter** : glissez un PDF dans la zone prévue, ou **Choisir un fichier** (20 Mo au plus).
  **Titre (facultatif)** : par défaut, le nom du fichier. Seuls les vrais PDF sont acceptés, le
  contenu du fichier est vérifié et pas seulement son extension.
- **Extrait** : il est tiré automatiquement du PDF à l'ajout. C'est le texte affiché au survol de
  l'icône « i ». **Modifier** permet de le corriger, ainsi que le titre.
- **Supprimer** : refusé tant qu'une version publiée d'un template utilise l'annexe ; le message
  liste les templates concernés. Retirez d'abord l'annexe de ces templates et republiez-les. Les
  anciennes versions affichent ensuite « Annexe supprimée ».

## Journal

Le menu **Journal** liste l'activité, la plus récente en premier : date, auteur (profil,
administrateur ou serveur), action, cible et détails. Filtres : période, **Action** et **Profil**.

Sont enregistrés : connexions, échecs, verrouillages, déconnexions, réinitialisations de mot de
passe, changements de profil, création, modification, suppression et export PDF des fiches,
modifications des profils, des templates et des annexes.

Le journal ne peut être ni modifié ni effacé, pas même par l'administrateur.

## Compte utilisateur

Le menu **Compte utilisateur** change le mot de passe partagé de l'équipe : saisissez le
**Nouveau mot de passe** puis la **Confirmation**. Toutes les sessions utilisateur ouvertes sont
fermées ; les profils et les fiches ne changent pas.

Règles de mot de passe : 12 caractères au moins, et assez difficile à deviner (une suite de mots
sans rapport, par exemple). Le formulaire explique pourquoi un mot de passe est refusé.

Le mot de passe **administrateur** ne se change pas depuis l'interface : voir
[Questions fréquentes](faq.md#jai-oublie-le-mot-de-passe-administrateur).
