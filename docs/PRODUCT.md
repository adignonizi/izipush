# Product

## Register

product

## Users

L'équipe COM / marketing d'Izichange : non technique, elle prépare et suit des campagnes (push, email) plusieurs fois
par semaine, au bureau, sur un ordinateur portable, souvent entre deux autres tâches. Elle doit comprendre sans aide
qui recevra quoi et quand, et lire les résultats sans interprétation technique. Un profil technique intervient
ponctuellement pour dépanner (ingestion, fournisseurs email).

## Product Purpose

izipush est un fork de Novu devenu CRM : il tient à jour le profil de chaque client à partir des événements
d'Izichange, regroupe les clients en segments, envoie des campagnes (un segment, un workflow, un moment) et en mesure
les résultats. Réussite : une campagne se prépare en quelques minutes, sans erreur d'audience, et son rapport se lit
d'un coup d'œil.

## Brand Personality

Clair, rassurant, efficace. On n'impressionne pas, on aide à envoyer juste. Ton direct, en langage métier
(« chaque lundi à 9 h », pas `0 9 * * 1`), sans jargon ni exclamation.

## Anti-references

- Jargon technique visible : identifiants, cron, topic, transactionId, JSON à saisir.
- Modales empilées pour des tâches qui méritent une page.
- Écrans qui ne ressemblent pas au reste du dashboard Novu (autres boutons, autres formulaires, autres couleurs).
- Tableaux de chiffres sans explication de ce qu'ils mesurent.
- Envoi par surprise : un bouton qui déclenche des milliers de messages sans récapitulatif.

## Design Principles

1. Parler le langage de la COM : chaque réglage se lit comme une phrase.
2. Qui / quoi / quand toujours visibles avant d'envoyer.
3. Rien ne part par surprise : brouillon par défaut, activation explicite et récapitulée.
4. Natif Novu : mêmes composants, mêmes gestes, mêmes couleurs.
5. Chaque chiffre dit ce qu'il mesure, et ses limites.

## Accessibility & Inclusion

WCAG 2.1 AA : contrastes, navigation au clavier, focus visible, libellés associés aux champs. Interface CRM en
français par défaut et en anglais (langue du navigateur).
