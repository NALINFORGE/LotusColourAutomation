# Changelog

## 0.2.13

- Passage au format officiel **Home Assistant App Repository**.
- Ajout de `repository.yaml` à la racine du dépôt.
- Déplacement de l’App dans le dossier technique `lotus_automation_monitor`.
- Ajout de l’URL du dépôt dans `config.yaml`.
- Documentation d’installation directe depuis Home Assistant.
- Conservation du slug, du domaine et des URL historiques `lotus_automation_monitor`.
- Aucun changement fonctionnel de la surcouche par rapport à 0.2.12.

## 0.2.12

- Adopte le nom public **Lotus Colour Automation** ; l’identifiant technique `lotus_automation_monitor` reste inchangé pour la compatibilité.
- Ajoute une nouvelle icône d’add-on : lotus rouge pastel avec tête de robot générique.
- Ajoute les ressources `icon.png` (128 × 128) et `logo.png` (512 × 512) sur fond transparent.
- Conserve l’entrée latérale **Automatisations** avec `mdi:robot`, icône générique Home Assistant sans référence Android/Google.
- Aucun changement fonctionnel de la surcouche par rapport à la 0.2.11.

## 0.2.11

- Corrige l’initialisation de la surcouche après la redirection de l’entrée latérale vers la vue native Home Assistant : le runtime ne s’arrête plus avant l’installation de ses écouteurs et timers.
- Ajoute une réconciliation immédiate puis différée après `location-changed`, `popstate` et `pageshow`, complétée par un `MutationObserver` des racines DOM/Shadow DOM afin de décorer les composants Lit rendus tardivement.
- Conserve un balayage de sécurité idempotent et nettoie tous les timers/observateurs lors du remplacement du runtime.
- Agrandit les informations **Début / Fin / Arrêt** et la **durée d’exécution** à `var(--ha-font-size-m)`, la taille de texte standard Home Assistant héritée par le bandeau natif « action désactivée ».

## 0.2.10

- Retour à un **module frontend unique** : `overlay.js?v=0.2.10` contient directement toute la surcouche, sans `runtime.js` secondaire.
- L’URL du module change à chaque version afin d’éviter la réutilisation d’une entrée de cache/service worker Home Assistant.
- Nettoyage des anciennes URL Lotus lors du démarrage de Home Assistant Core et journalisation des URL frontend réellement actives.
- Les anciennes routes `bootstrap.js` et `runtime.js` restent uniquement comme pont de migration.
- Affichage du **temps d’exécution d’une action terminée avec succès** juste avant les commandes natives de la ligne (poignée/menu), sans modifier les actions en attente ou en erreur.
- Conservation des bandeaux vert/orange/rouge avec horaires et du message d’erreur unique.

## 0.2.9

- Ajoute le temps d’exécution d’une opération terminée avec succès directement avant le menu ⋮ de sa ligne dans l’éditeur natif.
- Format compact : millisecondes, secondes, minutes/secondes ou heures/minutes selon la durée.
- Ajoute un pont `overlay.js` de compatibilité pour les instances Home Assistant dont Core conserve encore une ancienne URL Lotus enregistrée.
- La migration définitive visait le bootstrap `bootstrap.js?loader=1`; ce mécanisme est remplacé en 0.2.10 après blocage observé par le service worker.
- Version synchronisée à 0.2.9 dans l’add-on, le compagnon et le runtime.

## 0.2.8

- Renomme l’entrée latérale `Automatismes` en **Automatisations**.
- Utilise l’icône native Home Assistant des automatisations (`mdi:robot`).
- L’entrée latérale redirige désormais directement vers la vue native `/config/automation/dashboard`.
- Intercepte le clic sur l’ancien panneau Ingress et le convertit en navigation native Home Assistant, sans ouvrir une seconde interface.
- Ajoute une redirection de secours si l’ancienne route `/local_lotus_automation_monitor` est atteinte directement.
- Conserve la vue de diagnostic historique uniquement comme outil technique accessible explicitement avec `?diagnostic=1`.
- Conserve toutes les fonctions de suivi 0.2.7 : catégories, états en cours/erreur et bandeaux début/fin/arrêt dans l’éditeur.

## 0.2.7

- Ajoute le suivi visuel de la dernière exécution directement dans l’éditeur natif Home Assistant.
- Une opération déjà exécutée avec succès reçoit un bandeau **vert** avec heure de début et heure de fin.
- L’opération actuellement exécutée reçoit un bandeau **orange** avec son heure de début.
- L’opération fautive reçoit un bandeau **rouge** avec heure de début, heure d’arrêt et message d’erreur.
- Les opérations non encore atteintes restent entièrement natives et sans surcouche.
- Les opérations désactivées conservent le rendu natif « Désactivée » de Home Assistant.
- Charge la trace détaillée `trace/get` uniquement pour l’automatisation ou le script actuellement ouvert et la rafraîchit pendant l’exécution.
- Déduit l’heure de fin d’une opération à partir de l’étape suivante de la trace, ou de l’heure de fin globale de la trace pour la dernière opération.
- Conserve les corrections 0.2.5 : URL frontend stable, suppression des anciennes URL versionnées et runtime direct sans `import()` dynamique.

## 0.2.5

- Supprime le `import()` dynamique de `runtime.js`, bloqué par le service worker Home Assistant sur certaines connexions HTTPS.
- Sert désormais directement la surcouche complète via `/lotus_automation_monitor/overlay.js`.
- Ajoute des en-têtes `Cache-Control: no-store` afin d’éviter les anciennes versions persistantes du frontend.
- Supprime explicitement les anciennes URL Lotus versionnées avant d’enregistrer l’URL frontend stable.
- La route relit le fichier JavaScript à chaque chargement afin que les futures corrections du runtime n’imposent plus de changer l’URL enregistrée.
- Conserve le correctif anti-duplication des bandeaux d’erreur de la 0.2.3.

## 0.2.3

- Corrige l'accumulation répétitive du même bandeau d'erreur dans l'éditeur natif Home Assistant.
- Déduplication par signature `état + étape + message` : un message identique reste unique pendant les rafraîchissements.
- Le bandeau n'est remplacé que si l'étape, l'état ou le texte d'erreur change.
- Nettoyage des anciens bandeaux rendu compatible avec les `ShadowRoot` sans dépendre de `:scope`.

## 0.2.2

- Corrige le chargement de la surcouche après mise à jour.
- Remplace l’URL JavaScript versionnée par un chargeur stable.
- Le chargeur importe le runtime avec un paramètre anti-cache à chaque chargement complet du frontend.
- Conserve la logique 0.2.1 : orange uniquement pendant une exécution, rouge pour la dernière erreur, rendu HA natif au repos/désactivé.

## 0.2.1

- Corrige la couleur des catégories : orange est désormais strictement réservé aux exécutions en cours.
- L’état normal utilise la couleur primaire native Home Assistant au lieu de `state-active-color`.
- Les catégories ouvertes n’affichent plus la barre de synthèse.
- Supprime l’injection de `div` directement dans les lignes `<tr>` de Home Assistant afin de préserver la mise en page native.
- Les lignes en cours/erreur sont décorées sans modifier la structure du tableau.

## 0.2.0

- Ajout d’une **surcouche sur les listes natives** Automatisations et Scripts de Home Assistant.
- Les éléments au repos et désactivés conservent leur rendu natif ; seuls les états **En cours** (orange) et **Erreur** (rouge) sont ajoutés.
- Ajout d’un indicateur sur les **catégories Home Assistant**, y compris lorsqu’elles sont repliées.
- La barre d’une catégorie représente uniquement les **types d’états présents** : 1 couleur = 100 %, 2 couleurs = moitiés égales, 3 = tiers égaux, 4 = quarts égaux. Elle n’est jamais proportionnelle au nombre d’éléments.
- États de catégorie pris en compte : normal/actif, en cours, dernière exécution en erreur, désactivé.
- Ajout de la mise en évidence de l’**étape courante ou fautive directement dans l’éditeur natif** Home Assistant.
- Conservation des interactions natives : clic, édition, déplacement et suppression des actions restent gérés par Home Assistant.
- Ajout d’un compagnon `custom_component` installé automatiquement dans `/config/custom_components/lotus_automation_monitor`.
- Sauvegarde de `configuration.yaml` avant enregistrement automatique de `lotus_automation_monitor:`.
- Ajout d’un indicateur dans le panneau Ingress pour signaler si un redémarrage de Home Assistant est nécessaire.
- Conservation du panneau de diagnostic v0.1 comme vue globale et solution de repli.

## 0.1.0

- Première version installable sous Home Assistant OS/Supervisor.
- Interface Ingress intégrée à la barre latérale Home Assistant.
- Découverte automatique des entités `automation.*` et `script.*`.
- Mise en couleur de l’état : repos, en cours, exécution longue, dernière exécution en erreur, désactivé.
- Lecture des traces `trace/list` et `trace/get` via l’API WebSocket interne de Home Assistant.
- Détail au clic avec chemin de trace, étape courante, étapes exécutées et message d’erreur.
- Recherche et filtres Automatisations / Scripts / En cours / Erreurs.

### Chargement frontend 0.2.7
- Remplace le runtime directement enregistré par un bootstrap immuable `bootstrap.js?loader=1`.
- Le bootstrap injecte `runtime.js?ts=<horodatage>` comme script classique, sans `import()` dynamique.
- Purge dynamiquement toutes les anciennes URL Lotus déjà présentes dans le gestionnaire frontend Home Assistant.
- Après la migration 0.2.7 et un redémarrage de Core, les futures mises à jour du runtime ne nécessitent plus de nouvelle URL enregistrée par Core.
