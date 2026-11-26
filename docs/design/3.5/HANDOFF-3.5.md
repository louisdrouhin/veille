# HANDOFF 3.5 — Paramètres, menu du compte et raccourcis clavier

Folders 3.5. Maquettes : page « 3.5 · Paramètres et raccourcis » du canvas, en clair et en sombre, desktop et mobile (PWA iPhone).

**Aucun nouveau token.** Composants réutilisés :
- en-têtes de section `bar-2` ;
- `fchip` et `.ctx` ;
- interrupteurs, segmentés et cartes radio de 3.4 ;
- toasts ;
- menu contextuel 3.2.

Rappel : le mode lecture est abandonné. Rien dans ce lot n'y fait référence.

---

## 0. Ce qui ne change pas (prod)

- **En-tête sticky opaque.**
  - Mobile : logo · loupe · bouclier Ma stack · **Actualiser** · menu, soit 4 × 44 px. L'en-tête n'accueille rien de plus.
  - Desktop : navigation · recherche · Actualiser · **menu du compte** (§ 2).
- **Tirer pour rafraîchir** : actif sur les pages Sources et Forums (recharge les états). Inactif dans les formulaires et dans la fenêtre de recadrage.
- **Bouton « remonter en haut » et toasts en bas à droite.** Le retour « Enregistré » des réglages est **en ligne**, à côté du réglage (§ 4), pas dans un toast. L'indicateur de raccourci « g » est en **bas à gauche** (§ 6) et ne croise donc ni le bouton ni les toasts.
- **Menu contextuel desktop (3.2)** : inchangé, sauf l'accélérateur « Enregistrer dans une liste », qui passe de `E` à **`S`** pour s'aligner sur le raccourci global (§ 6).

## 1. Structure et URL

« Mon compte » et « Admin » **disparaissent** : plus de lien, de titre ni de page sous ces noms.

| Groupe | Page | URL | Contenu |
|---|---|---|---|
| Compte | Profil | `/parametres/profil` | photo, prénom, nom, e-mail, identifiant (lecture seule) |
| | Sécurité | `/parametres/securite` | mot de passe, 2FA (TOTP) + codes de secours, sessions |
| Préférences | Apparence | `/parametres/apparence` | thème Système / Clair / Sombre |
| | Notifications | `/parametres/notifications` | appareils, gravité minimale Ma stack, heures calmes, lien vers Briefing |
| | Briefing du matin | `/parametres/briefing` | réglages 3.4 (heure, jours, sections, longueur, aperçu) |
| | Raccourcis clavier | `/parametres/raccourcis` | interrupteur + liste (desktop seulement) |
| Administration | Forums | `/parametres/forums` | liste ordonnable, création, modification |
| | Sources | `/parametres/sources` | sources en erreur d'abord, filtres, ajout |
| | Intégrations | `/parametres/integrations` | fournisseurs IA, modèles utilisés, autres clés d'API |
| | Recherche et IA | `/parametres/recherche-ia` | seuil et fenêtre de fusion, limites quotidiennes, indexation |
| À propos | À propos | `/parametres/a-propos` | version, commit, date de déploiement, Nouveautés |

- **`/parametres`** : sur desktop, redirige vers `/parametres/profil`. Sur mobile, c'est la **liste** (§ 3).
- **Redirections permanentes (308)** depuis les anciennes URL : `/compte` → `/parametres/profil`, `/compte#…` → la page correspondante, `/admin` → `/parametres/forums`, `/admin/sources` → `/parametres/sources`, etc.
- **Liens profonds à brancher** :
  - carte briefing → `/parametres/briefing` ;
  - bandeau « clé refusée » → `/parametres/integrations` ;
  - erreur de source → `/parametres/sources?filtre=erreur` ;
  - notifications Ma stack → `/parametres/notifications`.
- Si l'app gère plusieurs comptes un jour, le groupe **Administration** est réservé aux administrateurs. Pour un compte non admin, il est masqué, et l'URL renvoie 403 puis redirige vers Profil.

## 2. Menu du compte (desktop)

Planche « Desktop — menu du compte ».

- **Bouton** :
  - photo ronde 30 px + « Prénom Nom » + chevron ;
  - `aria-haspopup="menu"`, `aria-expanded`, `aria-label="Menu du compte : Louis Drouhin"` ;
  - ouvert : fond `rgba(255,255,255,.14)`.
  - Sans photo : initiales sur pastille (§ 5).
- **Menu** (`role="menu"`) : 300 px, aligné à droite sous le bouton.
  1. **En-tête** (non interactif) : photo 44 px, nom, e-mail.
  2. **Paramètres** (`g p`) · **Profil** · **Raccourcis clavier** (`?`).
  3. Séparateur, puis **Thème** : groupe de 3 `menuitemradio` (Clair / Sombre / Système), appliqué immédiatement. C'est le même réglage que la page Apparence.
  4. Séparateur, puis **Se déconnecter**.
- **Clavier** :
  - `Entrée`, `Espace` ou `↓` ouvre et focalise le 1er item ;
  - `↑` / `↓` parcourent les items, le groupe Thème compte pour **un arrêt**, et `←` / `→` y changent la valeur ;
  - `Échap` ferme et rend le focus au bouton ; `Tab` ferme.
- La navigation principale perd « Admin ». Il reste Forums · Briefing · Listes · Ma stack.

## 3. Mobile

Planches « Mobile — /parametres et menu burger », « Mobile — Profil… », « Mobile — Forums… ».

- **Menu burger** :
  - **en tête**, une carte compte (photo 48 px, nom, e-mail) qui mène à Profil ;
  - Forums · Briefing · Listes · Ma stack (badges inchangés) ;
  - séparateur, **Paramètres**, **Se déconnecter**.
- **`/parametres`** (liste façon Réglages iOS) :
  - carte Profil (photo 56 px, nom, e-mail) ;
  - groupes Compte · Préférences · Administration · À propos. Chaque ligne fait 50 px : icône dans un carré `accent-soft`, libellé, valeur courante (Sombre, Haute et plus, 7:00, 6…) ou badge, chevron ;
  - « Se déconnecter » ; pied « Folders 3.5.0 · a1b2c3d ».
- **Raccourcis clavier n'apparaît pas sur mobile** : la page reste accessible par URL, avec la mention « Sur ordinateur, avec un clavier ».
- **Page de section** : plein écran, lien « ‹ Paramètres » (44 px) en haut à gauche sous l'en-tête, titre, description, blocs.
  - Les tableaux desktop deviennent des **cartes** (Forums, Sources).
  - Contrôles en 44 px. Les segmentés longs ont des libellés courts (« Haute + »).
- **Réordonner les forums** : appui long puis glisser sur mobile, poignée sur desktop. Alternative clavier ou lecteur d'écran : boutons « Monter / Descendre » dans le formulaire du forum.

## 4. Comportement des réglages

- **Application immédiate**, sans bouton « Enregistrer » :
  - interrupteurs, segmentés, radios, cases, curseur : à chaque changement ;
  - champs texte : au `blur` ou à `Entrée` ;
  - curseur : après 400 ms sans mouvement.
- **Retour « ✓ Enregistré »** :
  - texte `--ok` à côté du libellé du réglage modifié, pendant 2 s puis fondu ;
  - `role="status"`, annoncé une fois ;
  - en cas d'échec : le réglage revient à l'ancienne valeur, avec un message `--err` sous le contrôle et « Réessayer ».
- **Exceptions avec confirmation** (dialogue) :
  - désactiver la 2FA ;
  - régénérer les codes de secours ;
  - déconnecter toutes les sessions ;
  - supprimer une clé ou un forum ;
  - tout réindexer.
- **Pages sensibles : Sécurité et Intégrations.** On reprend la re-confirmation existante :
  - si la dernière confirmation date de plus de 10 min, la carte **« Confirme ton identité »** (mot de passe **ou** code 2FA) s'affiche en haut ;
  - le contenu dessous est flouté et `inert` ;
  - une fois confirmé : bandeau `--ok-soft` « Identité confirmée. Modifications possibles jusqu'à 14:24. » ;
  - la confirmation vaut pour les deux pages pendant 10 min.
  - Planches : mobile « Intégrations : confirmer l'identité », desktop Sécurité et Intégrations déverrouillées.

## 5. Profil et photo

Planches « Desktop — Paramètres › Profil » et « Desktop — photo… ».

- **Champs** :
  - **Prénom** et **Nom** séparés, obligatoires, 50 caractères max ;
  - **E-mail** : changer l'adresse envoie une vérification ; l'ancienne reste active tant que la nouvelle n'est pas confirmée ;
  - **Identifiant** (`louis.drouhin`) en lecture seule.
  - **Migration** : découper l'actuel `louis.drouhin` en « Louis » / « Drouhin » (sur `.` ou `_`, première lettre en majuscule). L'utilisateur peut corriger ensuite.
- **Nom affiché partout** : « Prénom Nom » (menu du compte, carte mobile).
- **Photo** :
  - formats JPG, PNG et WebP ; 5 Mo max ;
  - **recadrage carré** dans une fenêtre : glisser pour déplacer, molette, pincement ou curseur pour zoomer, flèches pour déplacer au clavier, `+` / `−` pour zoomer ;
  - **aperçu rond** à 96 et 32 px ;
  - stockage en carré 512 px WebP, plus une version 64 px. Les métadonnées EXIF sont supprimées.
  - Mobile : recadrage en plein écran, avec « Annuler » et « Enregistrer » dans la barre.
- **États** :
  - **Envoi en cours** : anneau de progression autour de l'aperçu + « Envoi en cours… 64 % » + « Annuler l'envoi ».
  - **Erreur de format** : « Format non pris en charge (HEIC). Utilise un JPG, PNG ou WebP. Ta photo actuelle est conservée. » Le format est vérifié avant l'envoi.
  - **Erreur de taille** : « Fichier trop lourd : 12,4 Mo. Maximum 5 Mo. »
  - Les erreurs sont affichées sous les boutons en `--err`, avec `role="alert"`.
- **Sans photo** : initiales (Prénom[0] + Nom[0]) sur une pastille `--list-*` choisie par hachage de l'identifiant (stable). Texte `--surface` : contraste AA dans les deux thèmes, car les couleurs de liste sont foncées en clair et claires en sombre.
- **Supprimer** : sans confirmation, avec toast « Photo supprimée · Annuler ».

## 6. Raccourcis clavier (desktop)

Planches « Desktop — raccourcis » et « Paramètres › Raccourcis clavier ».

**Règles générales**
- **Actifs** si `pointer: fine` et l'interrupteur des paramètres activé (valeur par défaut).
- **Ignorés** si le focus est dans `input`, `textarea`, `select` ou `[contenteditable]`, si une touche Ctrl, Alt ou Méta est enfoncée (sauf `Ctrl+K`, `Ctrl+Entrée`), si un menu ou un dialogue est ouvert (ils gèrent leurs propres touches), et si un menu contextuel est ouvert.
- **Existant, inchangé** : `/` et `Ctrl+K` pour la recherche ; `u` et `Échap` pour remonter d'un niveau.
- **Désactivables** (WCAG 2.1.4, raccourcis à une seule touche) : interrupteur dans Paramètres › Raccourcis clavier.

**Listes de topics** (forums, accueil, listes, résultats de recherche, briefing)

| Touche | Action |
|---|---|
| `j` / `k` | ligne suivante / précédente (la 1ʳᵉ pression sélectionne la 1ʳᵉ ligne visible) |
| `Entrée` | ouvrir le topic (`Ctrl+Entrée` : nouvel onglet) |
| `o` | ouvrir l'article d'origine (nouvel onglet) |
| `m` | marquer lu / non lu |
| `s` | enregistrer dans une liste : ouvre **le sous-menu Listes du menu contextuel**, ancré sous le bouton ⋯ de la ligne |
| `Maj+C` | copier le lien Folders, avec toast « Lien Folders copié » |
| `n` / `p` | page suivante / précédente de la liste |

- **Ligne sélectionnée** :
  - fond `--accent-soft` + barre gauche 4 px `--accent` ;
  - différente du survol (`--surface-hover`) et du menu ouvert (accent-soft + contour 2 px) ;
  - pattern `role="listbox"` + `aria-activedescendant`, ou focus déplacé sur la ligne : choisir l'un des deux et s'y tenir ;
  - défilement automatique : `scrollIntoView({ block: 'nearest' })`, avec 80 px de marge sous l'en-tête sticky.
- **Cible des actions** : la ligne sélectionnée au clavier, sinon la ligne survolée. Bouger la souris ne déplace pas la sélection ; un clic la place.
- **Retour visuel** : la ligne change d'état (lu ↔ non lu, ★ qui apparaît). **Pas de toast** pour lu / non lu.

**Page d'un topic**
- **Barre de position** sous le fil d'Ariane, seulement si on vient d'une liste : « Depuis **Accueil · Derniers non lus** 3 / 21 » + boutons `k` Précédent / Suivant `j`.
- `j` / `k` : topic suivant / précédent de la **liste d'origine** (ids et index gardés en `sessionStorage`), sans y revenir. Au bout de la liste : petit message « Fin de la liste », sans effet.
- `m`, `s`, `o`, `Maj+C` : mêmes actions sur ce topic.
- `Espace` / `Maj+Espace` : défilement natif conservé (non intercepté).
- **Retour à la liste** (`u`, `Échap` ou Précédent du navigateur) : position de défilement restaurée **et** sélection sur le dernier topic vu.

**Navigation `g` + lettre**
- `g h` accueil · `g f` forums · `g b` briefing · `g l` listes · `g s` Ma stack · `g p` paramètres.
- Après `g` : pastille en **bas à gauche** « g puis h accueil · f forums… », `role="status"`, pendant 1,5 s maximum. Une touche inconnue ou le délai écoulé annule sans rien faire.

**Aide `?`**
- Fenêtre modale de 940 px, 3 colonnes (Partout · Listes de topics · Page d'un topic), touches en `<kbd>`.
- Pied : « Inactifs pendant la saisie dans un champ » + lien « Désactiver ou voir dans les paramètres ».
- `Échap` ferme. Focus piégé dans la fenêtre, puis rendu à l'élément d'origine.

## 7. Contenu des pages (rappel des blocs)

- **Sécurité** :
  - Mot de passe (« Changer ») ;
  - Double authentification (état, texte actuel, Codes de secours « 8 restants sur 10 » + Régénérer, « Désactiver la double authentification » en bouton `--err`) ;
  - Sessions (appareil, dernière activité, « Cette session » en `--ok`, Déconnecter, « Déconnecter toutes les autres sessions »).
- **Apparence** : les 3 cartes de thème de la prod (aperçus), sélection = bordure 2 px accent + coche, « Enregistré ».
- **Notifications** :
  - Appareils (un interrupteur par appareil abonné, « Cet appareil » en premier) ;
  - Alertes Ma stack (gravité minimale, segmenté) ;
  - Heures calmes (interrupteur + heures) ;
  - carte lien vers Briefing du matin.
- **Briefing du matin** : bloc 3.4 inchangé, titré « Envoi et contenu ».
- **Forums** : tableau (poignée, nom, sources, topics, non lus en accent, Modifier) + « Nouveau forum ». Cartes sur mobile.
- **Sources** :
  - filtres Toutes / En erreur / Désactivées ;
  - **bloc « En erreur » en premier**, bordure `--err`, chaque ligne avec message précis (HTTP 404 depuis 2 jours, délai dépassé…), Réessayer et Modifier ;
  - puis toutes les sources (pastille d'état, forum, URL en mono, dernière récupération) ;
  - le badge du menu « 2 en erreur » reprend ce nombre.
- **Intégrations** :
  - fournisseurs IA (clé masquée `•••• 4f2a`, état testé, Remplacer, Tester), avec l'erreur « La clé Mistral AI a été refusée… » en tête quand une clé est refusée ;
  - Modèles utilisés (résumés et traductions, Demande à ta veille, embeddings, avec la mention « changer impose de réindexer ») ;
  - Autres clés d'API (GitHub).
  - Badge de menu « Clé refusée » tant que l'erreur dure.
- **Recherche et IA** :
  - seuil de similarité (curseur 0,75–0,95 avec simulation sur 7 jours) et fenêtre de fusion ;
  - limites quotidiennes (utilisé / limite modifiable + barre) ;
  - indexation (état, modèle, « Tout réindexer » avec durée estimée).
- **À propos** : version, commit (copiable), date de déploiement, Nouveautés (3.5 → 3.1). Badge « Nouveau » dans le menu jusqu'à la première visite après une mise à jour.

## 8. Accessibilité

- **Menu latéral** : `<nav aria-label="Paramètres">`, titres de groupe en `h2`, item actif `aria-current="page"` + fond, barre et graisse (pas uniquement la couleur).
- **Badges** : texte explicite (« 2 en erreur », « Clé refusée »), inclus dans le nom accessible du lien.
- **Changement de page** : le titre du document devient « Sources · Paramètres · Folders » ; le focus va sur le `h1`.
- **Recadrage** : `role="dialog"` + `aria-modal`, zone de recadrage manipulable au clavier, curseur de zoom `role="slider"` avec valeurs.
- **Raccourcis** : désactivables, jamais actifs dans un champ, aide accessible par `?` et par le menu du compte.
- **Mobile** : toutes les cibles ≥ 44 px.
- **Contrastes** : uniquement des couples déjà vérifiés AA (3.0 → 3.4). Pastille d'initiales : `--surface` sur `--list-*`, AA dans les deux thèmes.

## 9. Checklist de recette

- [ ] Plus aucune occurrence de « Mon compte » ou « Admin » dans l'interface ; anciennes URL redirigées.
- [ ] Chaque page a sa propre URL, ouvrable directement ; `/parametres` redirige vers Profil (desktop) ou affiche la liste (mobile).
- [ ] Menu latéral sticky, item actif visible, badges Sources et Intégrations à jour.
- [ ] Menu du compte : photo, nom, e-mail ; Paramètres, Profil, Raccourcis, Thème, Se déconnecter ; clavier complet.
- [ ] Mobile : compte en tête du menu burger ; liste `/parametres` ; pages plein écran avec « ‹ Paramètres ».
- [ ] Prénom / Nom migrés depuis l'identifiant ; affichés partout.
- [ ] Photo : recadrage, envoi avec progression, erreurs de format et de taille, suppression + Annuler, initiales sans photo.
- [ ] Réglages appliqués immédiatement avec « Enregistré » ; rollback en cas d'échec.
- [ ] Sécurité et Intégrations : confirmation d'identité valable 10 min.
- [ ] `j` / `k`, `Entrée`, `o`, `m`, `s`, `Maj+C`, `n` / `p` sur toutes les listes ; sélection visible et défilement.
- [ ] Topic : barre de position, `j` / `k` dans la liste d'origine, retour à la bonne position.
- [ ] `g` + lettre avec indicateur en bas à gauche ; `?` ouvre l'aide.
- [ ] Raccourcis inactifs dans un champ ; désactivables ; aucun conflit avec `/`, `Ctrl+K`, `u`, `Échap`.
- [ ] Menu contextuel : accélérateur `S` pour « Enregistrer dans une liste ».
- [ ] Rien ne recouvre le bouton remonter ni les toasts ; tirer pour rafraîchir actif.
- [ ] Clair, sombre et système conformes aux maquettes.
