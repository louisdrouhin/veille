# Folders v3 — Listes de favoris · note de passation pour Claude Code

Nouvelle fonctionnalité : enregistrer un topic dans **une ou plusieurs listes** créées par l'utilisateur (ex. « Homelab », « Partner Informatique », « À lire plus tard »).

Références : canvas « Veille — maquettes », page **v3 · Listes de favoris**. Chaque maquette montre le clair et le sombre côte à côte ; la feuille et le popover fonctionnent en mode Play.
Tokens : `veille-tokens.css` **v3** = v2 + 11 variables (§ 7). Il remplace le fichier actuel dans `app/globals.css`.

---

## 0. À lire d'abord

### Le mode lecture est abandonné
- Ne pas implémenter : route `/t/[id]/lire`, bouton « Mode lecture », réglage A− / A+, barre fine. S'il en reste du code (route, composant, clé `localStorage` `folders-reading-size`), le supprimer.
- L'article complet s'affiche déjà dans la page topic (en production). Le lien vers la source reste un simple lien texte en fin d'article (`font-mono text-xs`, « proxmox.com ↗ »), pas un bouton.
- Sur la page v2 du canvas, les planches concernées sont marquées « ABANDONNÉ ».

### Ce qui est en production et que la v3 doit respecter
- En-tête **sticky et opaque** (pas de `black-translucent`).
- **Tirer pour rafraîchir** en app installée (roue sous l'en-tête) : à activer aussi sur `/listes` et `/listes/[id]`.
- Bouton flottant **« Remonter en haut »** en bas à droite sur mobile : les nouvelles pages ne doivent jamais le recouvrir (§ 5).
- Accueil mobile : 3 « Derniers non lus » puis « + N autres non lus » (8 sur desktop). Pas touché par la v3, sauf le repère ★ dans les lignes (§ 3.6).

---

## 1. Données

```sql
lists (
  id          uuid pk,
  name        text not null check (length(trim(name)) between 1 and 60),
  color       text not null check (color in ('slate','blue','teal','green','mustard','orange','rose','violet')),
  position    int  not null,              -- ordre d'affichage, 0 = premier
  created_at  timestamptz not null default now()
)
list_items (
  list_id     uuid references lists(id) on delete cascade,
  topic_id    uuid references topics(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (list_id, topic_id)
)
index on list_items(topic_id)             -- repère « enregistré » dans les listes de topics
index on list_items(list_id, added_at desc)
```

- Le nom n'a pas besoin d'être unique, mais un doublon exact déclenche l'avertissement « Une liste porte déjà ce nom ».
- Couleur à la création : **la première couleur de la palette pas encore utilisée** (ordre slate → violet), puis on reboucle. Modifiable ensuite dans Listes.
- Supprimer une liste supprime ses `list_items` (cascade) ; les topics ne sont pas touchés.

### Server Actions (`app/listes/actions.ts`)

| Action | Effet | Retour |
|---|---|---|
| `toggleTopicInList(topicId, listId, on)` | insert / delete idempotent | `{ savedCount }` |
| `createList({ name, topicId? })` | crée la liste ; si `topicId`, y ajoute le topic | `{ list }` |
| `renameList(id, name)` | | |
| `setListColor(id, color)` | | |
| `moveList(id, direction: 'up' \| 'down')` et `reorderLists(ids[])` | échange ou réécrit `position` dans une transaction | |
| `deleteList(id)` | après confirmation | |
| `removeFromList(listId, topicId)` | | `{ undoToken }` (les données de la ligne, pour Annuler) |
| `restoreToList(undoToken)` | réinsère avec le `added_at` d'origine | |

Toutes les actions appellent `revalidatePath` sur `/listes`, `/listes/[id]` et la page topic concernée. Côté client : **`useOptimistic`** pour un effet immédiat, rollback et toast d'erreur si l'action échoue.

---

## 2. Routes et navigation

- `/listes` : toutes les listes. `/listes/[id]` : une liste.
- **Desktop** : l'en-tête devient `Forums · Listes · Admin` + « Mon compte » à droite. « Listes » a une petite étoile en contour de 14 px avant le libellé et prend l'état actif (`aria-current="page"`) sur `/listes` et `/listes/*`.
- **Mobile**, menu burger : Forums (21 non lus) · **Listes (5)** · Admin (pastille « 1 erreur » si besoin) · Mon compte, puis Se déconnecter. Lignes de 52 px, icône 20 px, compteur `font-mono text-bar-muted`. L'item actif a un fond `bg-white/10` et un trait `bar-accent` de 3 px à gauche.

---

## 3. Composants

```
components/lists/
  SaveButton.tsx          bouton ★ de la page topic (ouvre le picker)
  SaveListPicker.tsx      Sheet (< md) ou Popover (≥ md), même contenu
  ListPickerContent.tsx   cases + « Nouvelle liste » + ligne d'état
  ListCheckRow.tsx
  NewListInline.tsx       champ + « Créer » sur place
  ListChips.tsx           « Dans [■ Homelab] [■ À lire plus tard] » sous le bouton
  SavedMark.tsx           étoile 13 px dans les lignes de topic
  ListSwatch.tsx          pastille (carré arrondi) et tuile (signet) d'une couleur
  ListsIndex.tsx          page Listes (consultation / Modifier)
  ListColorPicker.tsx     8 couleurs en radio
  ListPage.tsx            en-tête + CopyMarkdownButton + lignes
  CopyMarkdownButton.tsx
  RemoveFromListButton.tsx
  UndoToast.tsx           (réutilise Toast + action « Annuler »)
lib/lists/markdown.ts
lib/lists/palette.ts      ['slate','blue','teal','green','mustard','orange','rose','violet'] + libellés FR
```

### 3.1 SaveButton (page topic)
- **Seul**, jamais à côté d'un bouton de lecture.
  - Mobile : sous le titre, à droite de la ligne de méta (« Proxmox Blog · il y a 2 h / 2 messages »).
  - Desktop : à droite du titre (`ml-auto`), même ligne que « N messages ».
- Vide : `h-11 md:h-[34px] px-3.5 rounded-sm border border-line-strong bg-surface text-fg font-semibold`, étoile en contour (`stroke-current`), libellé « Enregistrer ».
- Plein : `border-saved bg-saved-soft`, étoile `fill-saved`, libellé « Enregistré », pastille `bg-saved text-saved-soft font-mono text-xs font-bold rounded-full px-1.5` avec le nombre de listes.
- Attributs : `aria-haspopup="dialog"`, `aria-expanded`, `aria-label` en état plein : « Enregistré dans 2 listes, modifier ».
- `ListChips` sous le bouton en état plein (mobile et desktop) : chips de 28 px, pastille de couleur 10 px + nom ; chaque chip renvoie vers la liste.
- Étoile SVG (viewBox 20) : `M10 2.8l2.15 4.5 4.95.62-3.63 3.42.93 4.9L10 13.85l-4.4 2.39.93-4.9L2.9 7.92l4.95-.62z`.

### 3.2 SaveListPicker — feuille mobile (< md)
- `<dialog>` modal ouvert avec `showModal()`, ou `vaul` si le projet l'utilise déjà.
- Voile `bg-scrim` sur toute la page, en-tête compris.
- Feuille `fixed inset-x-0 bottom-0 rounded-t-[14px] border-t border-line-strong bg-surface shadow-[0_-8px_30px_rgba(0,0,0,.25)] pb-[calc(env(safe-area-inset-bottom)+12px)] max-h-[85dvh]`. La liste défile à l'intérieur si elle est longue.
- Poignée 40 × 5 px, titre « Enregistrer dans… » (`font-cond text-lg font-bold`) + titre du topic tronqué. « Fermer » (lien, 44 px) en haut à droite. **Pas de bouton Valider.**
- Fermeture : Fermer, tap sur le voile, glisser vers le bas, Échap (clavier externe). Le focus revient au SaveButton.
- Clavier iOS : quand le champ « Nouvelle liste » a le focus, remonter la feuille au-dessus du clavier (`visualViewport` resize → `bottom: keyboardHeight`).

### 3.3 SaveListPicker — popover desktop (≥ md)
- Ancré sous le bouton, aligné à droite, `w-80`, flèche à 28 px du bord droit.
- En-tête `bg-bar-2` « ENREGISTRER DANS… ».
- Lignes de 38 px, case de 16 px. Échap ou clic extérieur ferment.
- Implémentation : `@radix-ui/react-popover`, ou l'API `popover` native avec positionnement manuel.

### 3.4 ListPickerContent (commun)
- `ListCheckRow` = `<label>` qui englobe `<input type="checkbox" class="size-[22px] accent-accent">` (16 px sur desktop) + pastille 14 px de la couleur + nom (`text-base`, `font-semibold` si cochée) + nombre d'articles en mono. Ligne de 52 px en mobile. Ligne cochée : `bg-accent-soft`.
- **Effet immédiat** au changement : `toggleTopicInList` (optimiste). Le SaveButton en arrière-plan se met à jour en direct.
- Ligne d'état `role="status"` en bas (`text-ok text-sm`) : « Ajouté à « Homelab » » / « Retiré de « Homelab » ». **Pas de toast pendant que la feuille est ouverte** (il serait caché ou superposé).
- « + Nouvelle liste » (texte accent, 52 px) remplace la ligne par `NewListInline` : aperçu de la couleur attribuée + champ 44 px (focus auto, `enterKeyHint="done"`) + bouton « Créer ». Entrée crée la liste **et y ajoute le topic**. Aide : « Le topic y sera ajouté tout de suite. Couleur modifiable dans Listes. » Échap ou champ vide + blur referment le champ.
- **État vide** (aucune liste) : tuile étoile `bg-saved-soft text-saved` 44 px, « Aucune liste pour l'instant », « Crée ta première liste : ce topic y sera ajouté tout de suite. », champ déjà ouvert, puis « Ou en un geste : » avec 3 chips de suggestion (« À lire plus tard », « Homelab », « Travail ») qui créent la liste d'un tap.

### 3.5 Page Listes `/listes`
- Titre « Listes » + « 5 listes · 50 articles ».
- **Mobile, mode consultation** (par défaut) : lignes de 64 px, tuile signet 36 px (`border-2` + icône signet remplie de la couleur de la liste), nom en gras, « 12 articles · ajout il y a 2 h », chevron. Toute la ligne renvoie vers `/listes/[id]`.
- **Mobile, mode Modifier** (bouton « Modifier » / « Terminé », `aria-pressed`) : par ligne, pastille de couleur 44 px (ouvre `ListColorPicker` en dessous : 8 radios de 44 px, cochée = double anneau `ring` couleur du texte) · champ nom 44 px (enregistré au blur ou à Entrée) · ↑ ↓ 40 × 44 · supprimer `text-err` 44 px.
- **Desktop** : tableau `grid-cols-[20px_36px_minmax(0,1fr)_90px_130px_196px]` : poignée (`@dnd-kit/sortable`) | tuile couleur (bouton qui ouvre le sélecteur) | nom (lien) | articles | dernier ajout | ↑ ↓ Renommer · Copier en Markdown · Supprimer. Renommer passe la cellule en champ + OK / Annuler.
- Création : formulaire « Nouvelle liste » en bas de page (mobile et desktop).
- Suppression : `ConfirmDialog` « Supprimer la liste « Idées projets » ? » / « Ses 3 articles n'y seront plus. Les topics restent dans leurs forums et dans tes autres listes. » / Annuler · Supprimer (danger plein).
- État vide de la page : `EmptyState` étoile + « Aucune liste » + « Enregistre un topic avec ★ pour créer ta première liste. » + formulaire de création.

### 3.6 Page d'une liste `/listes/[id]`
- Fil d'Ariane « Listes › Homelab ». Tuile signet 40 px + h1 + « 12 articles · du plus récent ajout au plus ancien ».
- Actions : `CopyMarkdownButton` (secondaire, pleine largeur sur mobile) + bouton « … » 44 px vers la gestion (renommer, couleur, supprimer).
- Lignes : **TopicRow avec `showForum`** (déjà en prod sur l'accueil), états lu / non lu / chaud inchangés. La date affichée est **la date d'ajout** (« ajouté il y a 2 h »), pas celle de publication. Tri `added_at desc`, pagination de 25 comme les forums.
  - Mobile : le bouton « retirer » (✕, 48 px de large, toute la hauteur de la ligne) est **à côté** du lien, pas dedans.
  - Desktop : dernière colonne de 36 px, `title="Retirer de la liste"`.
- Retrait : optimiste, puis `UndoToast` « Retiré de **Homelab** · Annuler » (5 s, `role="status"`). Annuler appelle `restoreToList`.
- Desktop : colonne latérale de 230 px avec toutes les listes (pastille, nom, compteur ; active en `bg-accent-soft font-bold`) et un lien « Gérer » vers `/listes`.
- État vide : « Cette liste est vide » + « Ajoute des topics avec ★ Enregistrer depuis n'importe quelle page topic. »

### 3.7 Copier en Markdown (`lib/lists/markdown.ts`)

```md
## Homelab
_12 articles · exporté de Folders le 24/11/2026_

- [Proxmox VE 9.2 disponible](https://www.proxmox.com/…) — Proxmox Blog · Proxmox & homelab
- [Kubernetes : vulnérabilité dans ingress-nginx](https://news.ycombinator.com/…) — Hacker News · DevOps
```
- Ordre affiché (ajout le plus récent en premier), **toute la liste** (pas seulement la page courante). URL = lien de l'article d'origine.
- Échapper `[` `]` dans les titres.
- `navigator.clipboard.writeText` dans le geste utilisateur. Succès : le bouton passe 2 s en « ✓ Copié · 12 articles » (`border-ok bg-ok-soft text-ok`) avec une annonce `aria-live`. Si la copie échoue (rare en PWA iOS) : `navigator.share({ text })`.

### 3.8 SavedMark (repère dans les listes de topics)
- Étoile pleine 13 px `text-saved`, `role="img"`, `aria-label` / `title` « Enregistré dans N listes ».
- Mobile : en tête de la ligne de méta, avant le badge Chaud. Desktop : juste après le titre, avant le badge Chaud.
- Partout où il y a une TopicRow : forums, Derniers non lus de l'accueil, À la une.
- Donnée : `savedCount` via un `LEFT JOIN … GROUP BY` ou un sous-select `count(*)` sur `list_items(topic_id)`.

---

## 4. Palette des listes

8 couleurs, une valeur claire et une sombre chacune, **≥ 4,5:1 sur surface, surface-alt, surface-hover et accent-soft** dans les deux thèmes (le détail est sur la planche « Tokens v3 + composants Listes »). Elles peuvent donc servir de texte (nom de la liste) autant que de pastille.

| clé | libellé | clair | sombre |
|---|---|---|---|
| slate | Ardoise | #55606B | #A9B4BE |
| blue | Bleu | #2560A8 | #80AFEA |
| teal | Sarcelle | #0E7068 | #4CC2B4 |
| green | Vert | #2A7436 | #7CC48A |
| mustard | Moutarde | #806400 | #D8B84C |
| orange | Orange | #A54A0A | #F2A465 |
| rose | Framboise | #AD2E68 | #F28CBB |
| violet | Violet | #6B47AE | #BBA4F2 |

- La couleur n'est **jamais seule** : le nom de la liste est toujours affiché à côté.
- Le rouge est volontairement absent, pour ne pas concurrencer « chaud » (`--hot`) et les erreurs.
- Classes : `bg-list-teal`, `border-list-teal`, `text-list-teal`. Côté code, mapper la clé vers la classe dans `palette.ts`, **sans classe construite dynamiquement** (sinon Tailwind ne la génère pas).

---

## 5. Bas d'écran mobile : rien ne se chevauche

Pile, du bas vers le haut :
1. Indicateur d'accueil : `env(safe-area-inset-bottom)`.
2. **Remonter en haut** (prod) : 48 px, `right-4`, `bottom-[calc(env(safe-area-inset-bottom)+16px)]`.
3. **Toasts** : `inset-x-2.5 bottom-[calc(env(safe-area-inset-bottom)+76px)]`, toujours **au-dessus** du bouton, jamais dessous ni à côté.
4. Contenu : `pb-[calc(env(safe-area-inset-bottom)+96px)]` sur `<main>` des nouvelles pages, pour que la dernière ligne (pagination, formulaire de création) passe au-dessus du bouton.

Quand la feuille est ouverte, voile et feuille couvrent tout. Le bouton « Remonter en haut » et la zone des toasts sont rendus `inert` / masqués ; le retour se fait dans la feuille (ligne d'état).

Le tirer-pour-rafraîchir reste sous l'en-tête sticky ; il est désactivé pendant que la feuille est ouverte.

---

## 6. Accessibilité
- Contraste : nouvelles couleurs ≥ 4,5:1 (texte) ; étoile `--saved` 4,8:1 en clair et 8:1 en sombre sur les surfaces ; pastille du compteur 5,1:1 / 9:1.
- Cibles ≥ 44 px partout sur mobile, y compris les cases de la feuille (ligne entière cliquable) et les pastilles de couleur.
- Feuille et popover : `role="dialog"`, titre relié par `aria-labelledby`, piège de focus (feuille), retour du focus au bouton.
- Les cases sont de vraies `<input type="checkbox">` dans un `<label>` ; les couleurs sont des radios dans un `<fieldset>` avec `<legend>Couleur</legend>`.
- Changements annoncés via `role="status"` (ajout, retrait, copie).

---

## 7. Tokens ajoutés (`veille-tokens.css` v3)

| variable | rôle | clair | sombre |
|---|---|---|---|
| `--saved` | étoile pleine, bord du bouton plein | #8F5B00 | #F2C04E |
| `--saved-soft` | fond du bouton plein, état vide | #FBF0D6 | #2E2410 |
| `--scrim` | voile derrière la feuille | rgba(20,24,26,.48) | rgba(0,0,0,.62) |
| `--list-*` (8) | voir § 4 | | |

Exposés à Tailwind via `@theme inline` (`--color-saved`, `--color-scrim`, `--color-list-*`). Mêmes conventions que la v2 : une valeur par thème, présentes dans les trois blocs (clair, sombre forcé, système en sombre).

---

## 8. Recette
- [ ] Page topic : ★ seul, aucun bouton de lecture nulle part ; vide → plein dès la première case cochée, sans recharger.
- [ ] Feuille : cocher / décocher plusieurs listes, créer une liste sur place (topic ajouté), état vide avec suggestions, fermeture par voile / glisser / Fermer, focus rendu.
- [ ] Clavier iOS ouvert sur « Nouvelle liste » : la feuille reste visible.
- [ ] Popover desktop : Échap, clic extérieur, Tab dans l'ordre.
- [ ] Page Listes : renommer, couleur, ↑ ↓, glisser (desktop), supprimer avec confirmation.
- [ ] Page d'une liste : tri par date d'ajout, retrait + Annuler, Copier en Markdown collé dans Obsidian / GitHub.
- [ ] Repère ★ visible dans forums, accueil et À la une.
- [ ] Mobile : toasts toujours au-dessus de « Remonter en haut », jamais de chevauchement ; tirer-pour-rafraîchir sur les nouvelles pages.
- [ ] Clair, sombre, système : contrastes vérifiés avec axe.
