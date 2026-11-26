# HANDOFF 3.4 — Le briefing du matin

Folders 3.4. Maquettes : page « 3.4 · Briefing du matin » du canvas, en clair et en sombre, mobile (PWA iPhone) puis desktop.

Principe : chaque matin, à l'heure choisie (7:00 par défaut, du lundi au vendredi), Folders prépare une synthèse de la veille **depuis le dernier briefing** et envoie une notification push. Le briefing se lit en 2 à 4 minutes, et chaque point mène à son topic.

**Aucun nouveau token.** Composants réutilisés :
- `.sev` (3.0) ;
- pile de sources et `.ctx` (3.3) ;
- puce « Généré par IA » (2.11 / 3.3) ;
- en-têtes `bar-2`, `fchip`, toasts ;
- menu contextuel desktop (3.2).

Rappel : le mode lecture est abandonné. Rien dans ce lot n'y fait référence.

---

## 0. Ce qui ne change pas (prod)

- **En-tête sticky opaque** (loupe · bouclier Ma stack · menu) sur la page briefing, l'historique et les réglages.
- **Tirer pour rafraîchir** sur la page briefing : recharge le briefing du jour. Ça ne le régénère pas, il est figé à sa création.
- **Bouton « remonter en haut » et toasts en bas à droite.** Rien n'est collé en bas d'écran. Le pied « C'est tout pour ce matin » est dans le flux, avec `padding-bottom` de la page = safe-area + 110 px comme ailleurs.
- **Menu contextuel desktop** : chaque point du briefing est une ligne de topic. Clic droit ou ⋯ ouvre le même menu (planche « Desktop — briefing »).

## 1. Génération

- **Déclenchement** : tâche planifiée côté serveur, par utilisateur, à l'heure choisie, dans **le fuseau du compte** (Europe/Paris par défaut). Jours : « Du lundi au vendredi » ou « Tous les jours ».
- **Fenêtre** : depuis la génération du briefing précédent. Le lundi en mode semaine, elle couvre donc tout le week-end.
- **Ordre de calcul** :
  1. Ma stack (données des alertes 3.0, sans IA) ;
  2. Mes services ;
  3. sélection À la une / En bref ;
  4. appels IA pour les phrases.
  
  L'objet briefing est enregistré **avant** les appels IA, avec les titres seuls. Les phrases sont ajoutées ensuite. Il est donc toujours affichable, même si l'IA échoue (§ 6).
- **Figé** : un briefing ne change plus une fois prêt (pas de régénération automatique). Exception : « Générer les résumés » en cas d'erreur IA.
- **Conservation** : 30 jours. Les topics restent dans les forums.

**Sélection** (planche « Composants et règles de contenu »)

| Section | Ce qu'elle contient | Texte |
|---|---|---|
| **Ma stack** | Nouvelles alertes 3.0 depuis le dernier briefing, triées par gravité puis date. Max 5, puis « Voir les N alertes à traiter ». | Données de l'alerte (identifiant, « exploitée », version corrigée). **Sans IA**, pas de puce IA. |
| **À la une** | Les 3 à 5 topics les plus repris (≥ 2 sources, 3.3), hors topics déjà en Ma stack. | IA : 2 lignes max. |
| **Mes services** | Nouveaux topics du forum « Mes services » (versions publiées). | IA : 1 phrase tirée des notes de version. |
| **Le reste en bref** | 3 à 6 topics notables (activité, sources fiables, forums suivis), pas déjà cités ailleurs. | IA : 1 ligne. |

- **Un topic n'apparaît qu'une fois** dans le briefing.
- Une section vide est **masquée**, comme son entrée de sommaire.
- Le modèle reçoit uniquement le titre et l'extrait des articles du topic, avec la consigne de rester factuel, en français, sans rien ajouter. Une phrase qui contient un chiffre ou une version absents des extraits est rejetée, et le point s'affiche sans phrase.

**Longueur** (réglage)
- **Détaillé** (par défaut, ~4 min) : une phrase par point, 2 lignes pour À la une.
- **Court** (~1 min) : titres seuls, sauf Ma stack, qui garde sa phrase non IA. Pas d'appel IA, donc pas de puce IA.
- Temps de lecture affiché = nombre de mots / 200, arrondi à la minute, minimum 1.

## 2. Notification push

Planche « Notification push du matin ».

- **Envoyée quand le briefing est prêt**, à l'heure choisie, **même pendant les heures calmes** (3.0) : l'utilisateur a choisi cette heure. Les alertes Ma stack retenues pendant la nuit **et reprises dans le briefing** ne sont pas renvoyées dans le message groupé de 07:30.
- **Aperçu complet** (par défaut). Le texte est **construit sans IA**, pour pouvoir partir même si le modèle est en panne :
  - **Titre** : « Briefing · » + le point le plus important, dans cet ordre de priorité :
    1. faille critique Ma stack (« 1 faille critique sur ta stack ») ;
    2. sinon le nombre de failles ;
    3. sinon le 1er sujet à la une ;
    4. sinon « N points ce matin ».
  - **Corps** (2 lignes max) : l'action Ma stack, puis 1 sujet à la une, puis les versions (« Vaultwarden 1.33 et 2 autres versions »).
  - Pas d'emoji, pas de couleur : la gravité s'écrit en mots.
- **Aperçu discret** (réglage) : titre « Ton briefing du matin est prêt », corps « N min de lecture. Touche pour l'ouvrir. ». Aucun nom de produit.
  - **Une PWA ne peut pas savoir quel mode de concentration iOS est actif.** Le mode Travail ne peut donc pas déclencher la version discrète tout seul. C'est un réglage, et l'utilisateur peut aussi couper Folders dans son mode Travail. Le texte d'aide des réglages le dit.
- **Toucher la notification** ouvre `/briefing/AAAA-MM-JJ`, ce qui marque le briefing **lu**. Les topics, eux, ne sont pas marqués lus (voir le bouton du pied, § 3).
- **« Rien de neuf »** : pas de notification.
- `tag` de notification = `briefing-AAAA-MM-JJ`, pour qu'un renvoi remplace la notification au lieu de la doubler.

## 3. Page du briefing

Routes : `/briefing` (le plus récent) et `/briefing/AAAA-MM-JJ`. Planches « Briefing du jour » et « Desktop — briefing ».

- **En-tête** :
  - kicker ☀ « Briefing du matin » ;
  - **date** en titre (« Jeudi 26 novembre ») ;
  - méta « Depuis mer. 7:00 · 142 articles · 4 min de lecture » (articles couverts = articles reçus dans la fenêtre) ;
  - lien « Historique » sur mobile (sur desktop, l'historique est dans la colonne de droite).
- **Sommaire** : puces ancres « Ma stack 2 · À la une 4 · Mes services 3 · En bref 5 ». Le compteur Ma stack est rouge **seulement** s'il y a une alerte critique (règle 3.0 : rouge = critique ou erreur). Défilement horizontal sur mobile, sans barre visible.
- **Sections** : en-tête `bar-2` avec titre + nombre en mono, et la nature à droite (« nouvelles failles », « les plus repris », « nouvelles versions »). Sous l'en-tête des sections IA, une bande `surface-alt` porte la puce **« Généré par IA »**.
- **Point** (ligne de topic) :
  - **Ma stack** : badge de gravité (`.sev`), puis le titre.
  - **Titre** : en gras si non lu ; atténué (`--text-read`) + « · lu » une fois le topic ouvert.
  - **Une phrase.**
  - **Méta** : pile de sources (20 px) + « N sources » + forum `.ctx`.
  - Toute la ligne est un lien vers le topic. Chevron sur mobile, ⋯ au survol sur desktop. Cible ≥ 48 px sur mobile.
- **En bref** : une ligne par point, « **Titre** — phrase », nombre de sources en mono à droite.
- **Pied « C'est tout pour ce matin. »** :
  - rappel « 14 points tirés de 142 articles. Il te reste 21 non lus » ;
  - bouton principal **Voir les 21 non lus** ;
  - bouton secondaire **Marquer ces 14 topics lus**, avec toast « 14 topics marqués lus · Annuler » ;
  - « Prochain briefing vendredi à 7:00 · Réglages ».
- **Desktop** : colonne de 820 px max ; colonne droite sticky de 300 px avec « Briefings précédents » (7 jours, le jour courant surligné), un résumé des réglages (lien « Modifier ») et une aide sur le menu contextuel.

## 4. Historique

`/briefing/historique`. Planche « Historique : 7 / 30 jours ».

- Segmenté **7 derniers jours / 30 derniers jours**. En 30 jours, les lignes sont groupées par semaine.
- **Ligne** :
  - pastille accent si non lu ;
  - date (gras si non lu) et étiquette « Aujourd'hui » ;
  - « 14 points · 2 failles » ;
  - aperçu des 3 premiers titres ;
  - temps de lecture en mono.
- **Jours sans briefing** : « Pas de briefing · Envoi du lundi au vendredi », en atténué, sans lien. « Rien de neuf » est atténué mais cliquable.
- Note de bas de page : « Les briefings sont gardés 30 jours. »

## 5. Entrées

Planches « Entrées » et « Desktop — accueil ».

- **Bloc « Ton briefing de ce matin »**, en haut de l'accueil :
  - **Affiché** si un briefing du jour existe, **non lu** et **avant midi** (heure locale).
  - **Disparaît** à la lecture, après midi, ou avec ✕ (« Masquer jusqu'à demain », 44 px sur mobile).
  - **Contenu** :
    - heure · nombre de points · temps de lecture ;
    - 3 lignes d'aperçu : critique Ma stack s'il y en a, « À la une : … et N autres sujets », « Services : … et N autres » ;
    - bouton **Lire le briefing**.
  - Bordure gauche 4 px `--accent`.
  - Sur mobile, tant que le bloc est affiché, **il remplace le bandeau Ma stack (3.0)** pour éviter le doublon. Une nouvelle alerte arrivée après la génération du briefing réaffiche le bandeau au-dessus du bloc.
  - Desktop : une seule ligne horizontale (titre et méta | aperçu | bouton), ✕ en haut à droite.
- **Navigation** :
  - Mobile : entrée « Briefing » (icône soleil) en 2ᵉ position du menu, pastille « nouveau » (`bar-accent`) tant que le briefing du jour n'est pas lu.
  - Desktop : entrée « Briefing » après « Forums », avec un point `bar-accent` si non lu (`aria-label` « Briefing, nouveau briefing non lu »).

## 6. États

Planche « États ».

- **En préparation** (entre l'heure prévue et la fin de génération, ~1 min) :
  - statut avec étapes (Ma stack ✓, Mes services ✓, Résumés…) ;
  - les sections sans IA s'affichent déjà, les autres en skeleton ;
  - mise à jour par polling ou SSE ;
  - `aria-live="polite"` : annonce « Briefing prêt » une seule fois.
- **Rien de neuf** : « Rien de neuf depuis hier », puis ce qui a été regardé (« 6 articles reçus. Aucune faille sur ta stack, aucun sujet repris par plusieurs sources, aucune nouvelle version. Pas de notification ce matin. »). Boutons « Voir les 6 articles » et « Briefing d'hier ».
- **Erreur IA** :
  - encart `--err-soft` : « Résumés indisponibles. Le service IA n'a pas répondu à 7:00. Voici le briefing sans les phrases générées. » + **Générer les résumés** ;
  - Ma stack s'affiche normalement ;
  - les autres sections montrent titres + sources, **sans puce IA**, avec la bande « Résumés indisponibles : titres et nombre de sources seulement ».
- **Première fois** (première ouverture après la mise à jour, ou briefing désactivé) :
  - carte « Nouveau dans Folders 3.4 · Ta veille en 2 minutes, chaque matin » ;
  - les 4 sections expliquées en une ligne chacune ;
  - mention IA ;
  - **Activer : 7:00, du lundi au vendredi** (demande la permission de notification si besoin), **Choisir l'heure et le contenu**, **Voir un aperçu d'abord** (génère un briefing de la veille à la demande, sans notification).

## 7. Réglages

`Mon compte › Notifications`, nouvelle section en tête. Planches « Réglages ».

| Réglage | Contrôle | Défaut |
|---|---|---|
| Recevoir le briefing | interrupteur + « Prochain : vendredi 27 nov. à 7:00 » | activé après l'écran « Première fois » |
| Heure d'envoi | bouton heure (sélecteur natif `type="time"`, pas de 15 min) | 07:00 |
| Jours | segmenté Du lundi au vendredi / Tous les jours | lundi–vendredi |
| Sections incluses | 4 cases avec description (Ma stack « sans IA », À la une « résumés IA »…) | toutes |
| Longueur | 2 cartes radio Court / Détaillé avec durée estimée | Détaillé |
| Notification | segmenté Aperçu complet / Discret + aperçu miniature en direct | Aperçu complet |
| Test | « Recevoir un briefing maintenant (test) » | — |

- Textes d'aide (heures calmes, section vide, mode de concentration) : voir les planches.
- Si toutes les sections sont décochées, l'interrupteur se coupe, avec un message.
- Desktop : colonne de 700 px dans Mon compte, sous-navigation Profil · Apparence · **Notifications** · Intégrations · Sécurité. Les cartes de longueur sont côte à côte.

## 8. Accessibilité

- La page est un `<article>` avec `h1` = date. Une section par bloc avec `aria-labelledby`. Le sommaire est un `<nav aria-label="Sommaire du briefing">`.
- La puce « Généré par IA » est du texte, pas seulement une icône.
- **Gravité** : badges en mots (« Critique », « Haute »), jamais uniquement en couleur.
- **Point** : un seul lien, nom accessible = titre. La phrase et les sources sont lues comme contenu du lien. Pour un nom plus court, utiliser `aria-describedby` vers la phrase.
- **Cibles** : 44 px minimum sur mobile ; points et lignes d'historique ≥ 48 px.
- **Contrastes** : aucune nouvelle couleur. Tous les couples utilisés (`--text-muted` sur `--surface-alt`, `--bar-muted` sur `--bar-2`, `.sev-*`, accent) sont déjà vérifiés AA en 3.0 / 3.3.
- `prefers-reduced-motion` : pas de défilement animé vers les ancres du sommaire.

## 9. Checklist de recette

- [ ] Briefing généré à l'heure choisie dans le fuseau du compte ; le lundi (mode semaine), il couvre le week-end.
- [ ] Ma stack sans IA ; sections IA avec la puce ; un topic n'apparaît qu'une fois ; section vide masquée.
- [ ] Court : titres seuls hors Ma stack, aucun appel IA.
- [ ] Push : texte sans IA, titre selon la priorité ; envoyé pendant les heures calmes ; pas de doublon à 07:30.
- [ ] Discret : aucun nom de produit.
- [ ] Rien de neuf : page dédiée, aucune notification.
- [ ] Toucher la notification : briefing ouvert et marqué lu ; topics inchangés.
- [ ] « Marquer ces N topics lus » + toast Annuler.
- [ ] Bloc accueil : visible avant midi si non lu ; ✕ masque jusqu'à demain ; remplace le bandeau Ma stack sauf nouvelle alerte.
- [ ] Menu mobile et navigation desktop : entrée Briefing avec indicateur de non lu.
- [ ] Erreur IA : briefing affiché sans phrases ; « Générer les résumés » fonctionne.
- [ ] Préparation : sections sans IA d'abord, annonce « Briefing prêt ».
- [ ] Historique 7 / 30 jours ; jours sans briefing non cliquables.
- [ ] Desktop : clic droit et ⋯ sur un point ouvrent le menu contextuel 3.2.
- [ ] Rien ne recouvre le bouton remonter ni les toasts ; tirer pour rafraîchir actif.
- [ ] Clair, sombre et système conformes aux maquettes.
