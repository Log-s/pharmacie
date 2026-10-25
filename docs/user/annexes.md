# Annexes

Les annexes sont les notes de référence (protocoles, procédures…) que l'administrateur rédige dans
l'application et range en dossiers. Tout le monde peut les consulter, seul l'administrateur les
modifie.

## Le menu Annexes

À gauche, l'arborescence des dossiers et des notes ; à droite, le contenu du dossier ouvert, avec son
fil d'Ariane. Sur mobile, l'arborescence passe au-dessus du contenu. Un dossier peut contenir des
sous-dossiers et des notes, triés par ordre alphabétique (dossiers d'abord).

- **Rechercher une annexe** cherche dans le titre et dans le texte de toutes les notes ; chaque
  résultat indique le dossier de la note. Choisir un dossier vide la recherche.
- Cliquez sur une note pour la lire. Son titre, sa date de modification et le chemin de son dossier
  s'affichent au-dessus du texte.

## Exporter en PDF

**Exporter en PDF** produit un PDF du dossier ouvert (ou de toutes les annexes depuis la racine) et
l'ouvre dans un nouvel onglet. Chaque sous-dossier devient un titre, chaque note un sous-titre suivi
de son texte. Le titre du dossier choisi est le titre principal, et les signets du PDF suivent les
mêmes niveaux. Les sous-dossiers sans aucune note sont omis.

## Depuis une fiche

Quand un champ renvoie à une note, son libellé est suivi d'une icône **i** :

- au survol, ou quand l'icône reçoit le focus clavier, une infobulle affiche le titre et le début
  de la note ;
- au clic, la note s'ouvre dans un nouvel onglet, sans quitter la fiche en cours de saisie.

La mention **Annexe supprimée** signifie que la note a été supprimée depuis : demandez à
l'administrateur de relier le champ à une autre note.

## Ce que fait l'administrateur

L'administrateur voit en plus des boutons d'édition.

- **Nouveau dossier** crée un dossier dans le dossier ouvert. **Renommer**, **Déplacer** (le dossier
  ne peut pas aller dans lui-même ni dans un de ses sous-dossiers) et **Supprimer** s'appliquent au
  dossier ouvert.
- **Nouvelle note** ouvre l'éditeur : un titre, puis le texte avec la barre d'outils **Mise en
  forme** (gras, italique, souligné, barré, titres 1 à 3, listes à puces ou numérotées, citation et
  lien). Un lien accepte les adresses `http`, `https` et `mailto`. **Enregistrer** crée la note ;
  quitter l'éditeur avec des modifications non enregistrées demande confirmation.
- **Modifier** (sur la page d'une note), **Déplacer** et **Supprimer** (dans la liste du dossier)
  agissent sur une note.
- Supprimer un dossier supprime aussi tout ce qu'il contient ; la boîte de confirmation donne le
  nombre de notes et de sous-dossiers concernés. L'opération est refusée tant que la dernière version
  d'un template utilise une des notes : le message liste les templates, retirez d'abord la note de
  ces templates et republiez-les. Le même refus vaut pour une note supprimée seule.
- Pour relier une note à un champ, voir **Lier une annexe** dans
  [Administration](administration.md#templates).
