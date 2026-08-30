# Lotus Colour Automation

Version : **0.2.12** — expérimental

Lotus Colour Automation ajoute un diagnostic temps réel aux **pages natives Home Assistant** des automatisations et scripts, sans remplacer leur éditeur.

> **Compatibilité :** l’identifiant technique historique `lotus_automation_monitor` est volontairement conservé (slug, domaine Home Assistant et URL frontend) afin de ne pas casser les installations existantes.

## Principe de la v0.2

- Une automatisation ou un script **normal / au repos** conserve intégralement son apparence Home Assistant.
- Un élément **désactivé** conserve également l’apparence native Home Assistant.
- Une exécution **en cours** reçoit une surcouche orange.
- Une dernière exécution **en erreur** reçoit une surcouche rouge.
- Les catégories affichent une barre synthétique divisée en **parts égales selon les états présents**, jamais selon le nombre d’éléments.
- Dans l’éditeur natif, les opérations déjà exécutées sont marquées en vert avec leurs horaires, l’opération courante en orange et l’opération fautive en rouge, tout en restant entièrement éditables.

L’entrée latérale **Automatisations** ouvre directement la vue native Home Assistant. La vue Ingress historique reste uniquement disponible comme diagnostic technique de secours.

Voir `DOCS.md` pour l’installation, le premier redémarrage requis et les limites de compatibilité.


### Note 0.2.12

La 0.2.12 conserve sans changement le comportement fonctionnel de la 0.2.11, adopte le nom public **Lotus Colour Automation** et ajoute l’identité visuelle de l’add-on : un **lotus rouge pastel avec une tête de robot générique**.

L’entrée latérale **Automatisations** conserve `mdi:robot`, l’icône générique de Home Assistant déjà utilisée depuis la 0.2.8. Elle ne dépend d’aucun visuel Android/Google.

### Note 0.2.11

La 0.2.11 fiabilise l’apparition automatique de la surcouche lors des navigations internes Home Assistant, notamment après le clic sur l’entrée latérale **Automatisations**. Le runtime reste actif après la redirection et réapplique la décoration lorsque les composants Lit/Shadow DOM apparaissent.

Les informations **Début / Fin / Arrêt** et le **temps d’exécution** utilisent désormais `var(--ha-font-size-m)`, la typographie normale de Home Assistant, pour une lisibilité identique au bandeau natif d’action désactivée.

### Note 0.2.10

La 0.2.10 supprime le chargement frontend en deux fichiers qui était intercepté par le service worker Home Assistant. La surcouche complète est maintenant chargée directement par une **URL unique à la version** : `/lotus_automation_monitor/overlay.js?v=0.2.10`. Après installation, un redémarrage de Home Assistant Core est requis une fois pour enregistrer cette URL.

Le temps d’exécution d’une action terminée avec succès est affiché juste avant les commandes natives à droite de la ligne.

### Note 0.2.9

La 0.2.9 a introduit le temps d’exécution des actions réussies et un pont de compatibilité pour les anciennes URL frontend. Son chargement secondaire de `runtime.js` s’est révélé incompatible avec le service worker sur l’instance testée ; la 0.2.10 le remplace.

### Note 0.2.8

La 0.2.8 simplifie la navigation : l’entrée latérale **Automatisations**, avec l’icône native `mdi:robot`, ouvre directement `/config/automation/dashboard`. La surcouche Lotus reste appliquée à la liste et à l’éditeur natifs ; il n’y a plus de seconde interface dans le parcours normal.

### Note 0.2.7

La 0.2.7 transforme l’éditeur natif en vue de progression de la dernière exécution : vert = terminé avec début/fin, orange = en cours avec heure de début, rouge = erreur avec début/arrêt. Les opérations non atteintes et désactivées conservent le rendu Home Assistant.
