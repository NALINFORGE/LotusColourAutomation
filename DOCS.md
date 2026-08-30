# Lotus Colour Automation 0.2.12

Lotus Colour Automation 0.2 ajoute les états d’exécution directement aux **interfaces natives Home Assistant** des automatisations et scripts. Depuis la 0.2.8, l’entrée latérale **Automatisations** ouvre directement la vue native Home Assistant au lieu d’afficher une interface Lotus séparée. La 0.2.10 ajoute le temps d’exécution des opérations terminées avec succès juste avant leur menu `⋮`. La 0.2.11 fiabilise l’initialisation automatique de la surcouche et agrandit les informations d’exécution. La 0.2.12 ajoute la nouvelle identité visuelle de l’add-on sans modifier le fonctionnement de la surcouche.

## Mise à jour depuis la v0.1

1. Arrêter **Lotus Colour Automation**.
2. Remplacer le dossier `/addons/lotus_automation_monitor` par celui de la v0.2.12.
3. Dans **Paramètres → Applications**, utiliser **Rechercher les mises à jour** si nécessaire.
4. Mettre à jour puis démarrer **Lotus Colour Automation**.
5. Au premier démarrage, l’application installe son compagnon frontend dans `/config/custom_components/lotus_automation_monitor`.
6. Par défaut, elle sauvegarde `configuration.yaml`, puis ajoute :

   ```yaml
   lotus_automation_monitor:
   ```

7. **Redémarrer Home Assistant une seule fois** afin de charger le compagnon. Le redémarrage de la seule application n’est pas suffisant.
8. Après le redémarrage, actualiser complètement le navigateur si la surcouche n’apparaît pas immédiatement.

Le diagnostic d’installation reste disponible techniquement, mais l’entrée latérale n’ouvre plus ce panneau dans l’usage normal.

## Fonctionnement dans les listes natives

Pour une automatisation ou un script individuel :

- **Normal / au repos** : aucune surcouche ; Home Assistant conserve son apparence native.
- **Désactivé** : aucune surcouche ; Home Assistant conserve son apparence native de désactivation.
- **En cours** : barre et légère surbrillance **orange**.
- **Dernière exécution en erreur** : barre et légère surbrillance **rouge**.

La priorité d’état est : désactivé → en cours → erreur de la dernière exécution → normal. Ainsi, une nouvelle exécution devient orange même si l’exécution précédente avait échoué ; si elle réussit, la surcouche disparaît.

## Catégories

Lotus Colour Automation utilise les catégories natives de Home Assistant. Lorsqu’une catégorie contient plusieurs états, sa barre est divisée en **segments de taille égale selon les états présents**.

La taille des segments ne dépend jamais du nombre d’automatisations ou de scripts :

- 1 état présent : barre entière d’une seule couleur ;
- 2 états présents : deux moitiés ;
- 3 états présents : trois tiers ;
- 4 états présents : quatre quarts.

Ordre constant des segments : **normal/actif → en cours → erreur → désactivé**.

Exemple : une catégorie contenant 30 éléments normaux et un seul élément en erreur affiche tout de même une barre composée d’une moitié « normal » et d’une moitié rouge. L’erreur reste donc immédiatement visible.

Cette barre reste utile lorsque la catégorie est repliée : elle signale les états cachés sans nécessiter l’ouverture de la catégorie.

## Éditeur natif

La v0.2.7 exploite la trace détaillée de la dernière exécution afin d’afficher la progression directement sur les déclencheurs, conditions et actions rendus par l’éditeur Home Assistant :

- **vert — Terminé** : l’opération a été atteinte et s’est terminée sans erreur ; le bandeau affiche `Début HH:MM:SS · Fin HH:MM:SS` ;
- **orange — En cours** : l’opération correspondant à `last_step` est actuellement exécutée ; le bandeau affiche son heure de début ;
- **rouge — Erreur** : l’opération a provoqué une erreur ; le bandeau affiche l’heure de début, l’heure d’arrêt et le message d’erreur lorsqu’il est fourni par Home Assistant ;
- **aucun bandeau** : l’opération n’a pas encore été atteinte dans la trace courante / dernière trace ;
- **désactivée** : Lotus ne remplace pas le bandeau natif Home Assistant.

Les bandeaux ne capturent aucun clic : toutes les opérations restent éditables, déplaçables et supprimables normalement. Pour les blocs imbriqués, Lotus colore l’opération dont le nœud de configuration correspond à la trace ; un conteneur encore en train d’exécuter un enfant n’est pas marqué comme terminé prématurément.

Home Assistant horodate nativement l’entrée dans chaque élément de trace mais ne fournit pas un champ « fin » propre à chaque étape. Lotus reconstruit donc l’heure de fin à partir du début de l’étape suivante située hors du sous-arbre courant ; pour la dernière opération, l’heure de fin globale de la trace est utilisée. Cette reconstruction est exacte pour les séquences usuelles et doit être considérée comme indicative dans des structures réellement parallèles.

## Installation automatique du compagnon

La v0.2 utilise deux options :

- `install_native_overlay` : installe le compagnon frontend ; activé par défaut.
- `auto_register_frontend` : ajoute automatiquement `lotus_automation_monitor:` à `configuration.yaml` ; activé par défaut.

L’application monte la configuration Home Assistant en écriture uniquement pour installer ce compagnon et enregistrer son domaine. Avant toute modification automatique de `configuration.yaml`, une copie est créée sous la forme :

`configuration.yaml.lam-backup-AAAAMMJJ-HHMMSS`

Si `auto_register_frontend` est désactivé, ajoutez manuellement :

```yaml
lotus_automation_monitor:
```

puis redémarrez Home Assistant.

## Désinstallation de la surcouche native

1. Arrêter Lotus Colour Automation.
2. Retirer `lotus_automation_monitor:` de `configuration.yaml`.
3. Supprimer `/config/custom_components/lotus_automation_monitor`.
4. Redémarrer Home Assistant.
5. Supprimer éventuellement les fichiers `configuration.yaml.lam-backup-*` après vérification.

La suppression de la surcouche ne modifie aucune automatisation ni aucun script.

## Limites de la v0.2

- La collecte d’état repose sur les états et traces Home Assistant. Une automatisation sans trace exploitable reste simplement dans son état natif.
- Une exécution longue n’est pas assimilée à une erreur tant que Home Assistant ne remonte pas d’erreur.
- L’intégration dans les listes et l’éditeur repose sur la structure du frontend Home Assistant. Elle est volontairement non destructive : si un composant frontend attendu n’est plus reconnu après une future mise à jour, la surcouche concernée ne doit plus s’afficher plutôt que bloquer l’éditeur natif.
- La v0.2 vise Home Assistant 2026.8.x. Le premier essai sur l’instance réelle reste la validation déterminante pour les sélecteurs du frontend et les catégories.

## Entrée latérale Automatisations

Depuis la 0.2.8, l’entrée de barre latérale de l’application porte le nom **Automatisations**, reprend l’icône native d’automatisation (`mdi:robot`) et ouvre directement :

`/config/automation/dashboard`

La surcouche Lotus s’applique à cette liste et à l’éditeur natifs Home Assistant. La vue Ingress historique reste uniquement comme outil technique de secours ; elle peut être atteinte explicitement avec `?diagnostic=1`.


## Chargement frontend depuis 0.2.5

La ressource enregistrée dans Home Assistant utilise l’URL stable `/lotus_automation_monitor/overlay.js`. Depuis la 0.2.5, **tout le runtime est servi directement par cette URL** : il n’existe plus d’`import()` dynamique vers `runtime.js`. Le composant Home Assistant répond avec `Cache-Control: no-store` et relit le fichier à chaque requête.

Le passage depuis 0.2.3 vers 0.2.5 nécessite un redémarrage de Home Assistant Core afin d’enregistrer cette nouvelle route HTTP. Après cette migration, les mises à jour purement JavaScript peuvent conserver la même URL et être récupérées par un rechargement complet du navigateur.



## Mise à jour vers 0.2.9 et ancien module encore chargé

Si l’application indique 0.2.9 mais que la console affiche encore une version antérieure ou une requête `overlay.js?v=...`, cela signifie que Home Assistant Core utilise encore l’ancienne inscription frontend chargée en mémoire. Après installation et démarrage de la 0.2.9, redémarrez **Home Assistant Core une fois**. Le module enregistré doit ensuite être `bootstrap.js?loader=1`, qui charge `runtime.js?ts=...`.

La 0.2.9 fournit également un `overlay.js` de compatibilité afin qu’une ancienne route encore active puisse charger le runtime courant lorsqu’elle n’est pas servie depuis un cache de service worker. Le redémarrage Core reste la migration fiable et définitive.

Après migration, vérifiez dans la console :

```javascript
window.__LOTUS_AUTOMATION_MONITOR_BOOTSTRAP__
// "1"
window.__LOTUS_AUTOMATION_MONITOR_OVERLAY__
// "0.2.10"
```

## Mise à jour vers 0.2.7

La 0.2.7 change une dernière fois le mécanisme d’injection frontend. Home Assistant charge désormais un **bootstrap immuable** (`bootstrap.js?loader=1`). Ce bootstrap injecte ensuite le runtime courant avec une URL `runtime.js?ts=...`, sous forme de script classique et sans `import()` dynamique.

Pour la migration vers 0.2.7 :

1. Mettre à jour et démarrer l’application.
2. Redémarrer **Home Assistant Core une fois** afin d’enregistrer le bootstrap.
3. Effectuer un rechargement complet du navigateur.

Après cette migration, les futures mises à jour limitées au runtime seront récupérées au prochain chargement complet de la page sans modifier l’URL enregistrée par Core.

### Vérification

Dans la console :

```javascript
window.__LOTUS_AUTOMATION_MONITOR_BOOTSTRAP__
// "1"

window.__LOTUS_AUTOMATION_MONITOR_OVERLAY__
// "0.2.7"
```

Dans l’onglet Réseau, la ressource frontend doit être `bootstrap.js?loader=1`, suivie de `runtime.js?ts=...`. `overlay.js` ne doit plus être chargé.

## Mise à jour vers 0.2.8

La 0.2.8 ne modifie pas le bootstrap introduit en 0.2.7. Après mise à jour et démarrage de l’application, un rechargement complet du navigateur suffit normalement pour récupérer `runtime.js` 0.2.8. Aucun redémarrage de Home Assistant Core n’est nécessaire pour cette évolution de navigation.

## Identité visuelle 0.2.12

La 0.2.12 ajoute `icon.png` et `logo.png` à l’add-on. Ils utilisent le lotus rouge pastel validé avec une tête de robot générique.

L’entrée latérale **Automatisations** continue d’utiliser `mdi:robot`, l’icône générique de Home Assistant. Aucun visuel Android/Google n’est utilisé.

## Correctif frontend 0.2.11

La 0.2.11 conserve le module unique versionné introduit en 0.2.10, désormais enregistré comme `/lotus_automation_monitor/overlay.js?v=0.2.11`. Elle corrige le cas où l’arrivée depuis le panneau Ingress redirigeait vers la vue native puis quittait le runtime avant d’installer ses écouteurs.

Après chaque navigation Home Assistant, plusieurs passes de réconciliation et un observateur DOM/Shadow DOM permettent d’appliquer la surcouche dès que les listes ou l’éditeur sont réellement rendus, sans nécessiter de rafraîchissement manuel.

Les bandeaux Début/Fin/Arrêt et l’indicateur de durée utilisent `var(--ha-font-size-m)`.

## Chargement frontend depuis 0.2.10

La version 0.2.10 charge une seule ressource complète et versionnée :

```text
/lotus_automation_monitor/overlay.js?v=0.2.10
```

Il n’existe plus de dépendance normale vers `runtime.js`. Après mise à jour vers 0.2.10, redémarrez Home Assistant Core une fois afin d’enregistrer cette nouvelle URL. Les anciennes URL Lotus sont supprimées du gestionnaire frontend lors du démarrage.

Pour chaque version suivante, l’URL changera avec le numéro de version, ce qui évite de réutiliser une ancienne entrée du cache de modules/service worker.

### Vérification 0.2.10

Après le redémarrage de Core, la console doit afficher :

```text
[Lotus Colour Automation 0.2.10] Surcouche native chargée
```

La ressource Lotus normale doit être `overlay.js?v=0.2.10`. Aucune requête `runtime.js?compat=...` ou `runtime.js?ts=...` n’est nécessaire au fonctionnement courant.

