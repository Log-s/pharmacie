# Fiches

Une fiche est remplie à partir d'un **template**, un modèle préparé par l'administrateur : cases à
cocher, choix unique, textes, date, auteur et référence. Toutes les fiches sont visibles par tous
les profils.

## Trouver une fiche

Le menu **Fiches** affiche la liste, des plus récentes aux plus anciennes : référence, template,
profil propriétaire, dates de création et de modification.

Les filtres se combinent :

| Filtre | Effet |
|---|---|
| **Rechercher** | cherche dans la référence et dans le texte saisi dans les fiches |
| **Référence** | une référence précise, par exemple `10-2026-042` |
| **Du** / **Au** | période de création |
| **Auteur** | la personne indiquée dans le champ Auteur de la fiche |
| **Profil propriétaire** | le profil qui a créé la fiche |
| **Template** | le modèle utilisé |

**Réinitialiser** vide tous les filtres. Cliquez sur une ligne pour ouvrir la fiche.

## Créer une fiche

Réservé au compte utilisateur, avec un profil actif.

1. Dans **Fiches**, cliquez sur **Nouvelle fiche**.
2. Choisissez le template à remplir.
3. Remplissez les champs, puis **Enregistrer**.

La fiche appartient au profil actif au moment de sa création ; ce **profil propriétaire** ne change
plus ensuite.

### Les champs

| Champ | Ce qu'il faut savoir |
|---|---|
| **Référence** | proposée automatiquement (format `MM-AAAA-NNN`, par exemple `10-2026-042` : mois et année de création, puis un numéro qui repart de `001` chaque mois), modifiable ; elle doit respecter ce format et être unique, un message l'indique si elle est déjà prise |
| **Date** | préremplie avec la date du jour ; cliquez pour choisir une autre date dans le calendrier |
| **Auteur** | prérempli avec le profil actif ; modifiable dans la liste des profils. Changer l'auteur ne change pas le propriétaire de la fiche |
| **Cases à cocher** | plusieurs options possibles |
| **Choix unique** | une seule option |
| **Texte** | une ligne ou plusieurs ; une longueur maximale peut s'afficher sous le champ |

Un astérisque signale un champ obligatoire. Les erreurs s'affichent au fil de la saisie, sous le
champ concerné.

### Sous-champs conditionnels

Certaines options font apparaître des champs supplémentaires quand on les coche, par exemple un
commentaire sous « Écart constaté ». Un champ masqué n'est ni vérifié ni exporté.

Si vous décochez une option dont les sous-champs contiennent déjà une saisie, l'application demande
**Effacer les champs masqués ?** : confirmez pour effacer, ou **Garder mon choix précédent** pour
revenir en arrière.

### Icône « i »

Un champ peut être suivi d'une icône **i** qui renvoie à une annexe : survolez-la (ou atteignez-la
au clavier) pour lire l'extrait, cliquez pour ouvrir le PDF dans un nouvel onglet. Voir
[Annexes](annexes.md).

## Consulter une fiche

La fiche s'ouvre en lecture : catégories, options cochées et leurs sous-champs, référence, auteur et
date. Si elle appartient à un autre profil, la mention **Fiche de *Nom*** l'indique. Un profil
supprimé par l'administrateur apparaît sous la forme « *Nom* (profil supprimé) ».

## Modifier ou supprimer

Les boutons **Modifier** et **Supprimer** s'affichent :

- pour le compte utilisateur, sur les fiches du **profil actif** uniquement ;
- pour l'administrateur, sur toutes les fiches.

Pour corriger la fiche d'un collègue, passez sur son profil (voir
[Premiers pas](index.md#choisir-son-profil-compte-utilisateur)).

La suppression est **définitive** et demande une confirmation. Elle est notée dans le journal.

Si vous quittez une fiche en cours de saisie, l'application demande **Quitter sans enregistrer ?** ;
choisissez **Rester sur la fiche** pour ne rien perdre.

!!! info "Les fiches ne cassent pas quand un template change"
    Chaque fiche reste liée à la version du template utilisée lors de sa création. Une nouvelle
    version publiée par l'administrateur ne concerne que les fiches créées ensuite.

## Exporter en PDF

Sur une fiche ouverte, **Exporter en PDF** télécharge un fichier nommé d'après la référence
(`10-2026-042.pdf`). Il reprend les catégories, les seules options cochées et leurs sous-champs,
la référence, l'auteur, la date, le profil propriétaire et la date de création, avec la référence et
la pagination en pied de page. Chaque export est noté dans le journal.
