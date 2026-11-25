# HANDOFF 3.2 — Menu contextuel des lignes de topic

Folders 3.2 (note rédigée pour la 3.1 ; la version a glissé avec Administration › Intégrations, livrée en 3.1.0).
Desktop seulement. Maquettes : page « 3.1 · Menu contextuel » du canvas, en clair et en sombre.

**Pas de nouveau token.** Le menu utilise uniquement les tokens 3.0 :
- `--surface`, `--border`, `--border-strong`, `--shadow-md` ;
- `--surface-hover`, `--accent`, `--accent-soft`, `--focus` ;
- `--text`, `--text-muted`, `--err`, `--saved`, `--saved-soft` ;
- `--list-*` pour les pastilles de liste.

Rappel : le mode lecture est abandonné. Rien dans ce lot n'y fait référence.

---

## 1. Périmètre et déclenchement

| | |
|---|---|
| **Où** | Toutes les listes de topics : forum, accueil (« Derniers non lus »), page d'une liste. Mêmes composants de ligne partout. |
| **Quand** | Activé seulement si `(min-width: 768px) and (pointer: fine)`. Sinon : aucun menu custom et pas de bouton ⋯. Le mobile garde l'existant : appui long natif et feuille ★. |
| **Clic droit** | Ouvre le menu au curseur. |
| **Maj + clic droit** | Laisse le menu natif du navigateur. Utile pour « Copier l'adresse du lien », les extensions, etc. |
| **Clavier** | Sur une ligne focalisée : `Maj+F10` ou la touche Menu (`ContextMenu`) ouvre le même menu, ancré sous le bouton ⋯ de la ligne. |
| **Bouton ⋯** | Dernière colonne de la ligne. Ouvre le menu ancré sous lui. |

Suggestion d'implémentation :
- Radix `ContextMenu` pour le clic droit, Radix `DropdownMenu` pour ⋯ et le clavier.
- Les deux s'appuient sur un composant commun `<TopicMenuItems topic={…} context="forum|home|list" listId?>`. Il rend les items via un petit adaptateur, car les primitives Item diffèrent entre ContextMenu et DropdownMenu.
- Laisser le menu natif avec Maj : sur `onContextMenu`, si `e.shiftKey` est vrai, ne rien faire. Radix ne l'intercepte pas si le Trigger est `disabled`. Le plus simple : un state `shiftHeld`, mis à jour sur `keydown`/`keyup` de `Shift` et réinitialisé sur `blur` de la fenêtre, puis `<ContextMenu.Trigger disabled={shiftHeld}>`.
- Ne jamais intercepter le clic droit hors des lignes : titre de page, champ de recherche, texte d'un topic, etc.

## 2. Contenu du menu

Largeur 284 px, padding vertical 4 px, rayon 6 px, bordure 1 px `--border-strong`, fond `--surface`, ombre `--shadow-md`.

**En-tête**, non interactif (`role="presentation"`) : titre du topic tronqué, 12 px, `--text-muted`, filet `--border` dessous. Il sert de rappel visuel de la ligne visée.

**Items** :
- hauteur 32 px (cible pointeur fin, le mobile n'est pas concerné) ;
- icône 16 px `--text-muted` ;
- libellé 13,5 px ;
- raccourci à droite en `--font-mono` 11,5 px `--text-muted` ;
- item actif (survol ou focus clavier) en fond `--surface-hover`.

Les groupes sont séparés par un filet 1 px `--border`, avec 4 px de marge.

| Groupe | Item | Raccourci | Remarques |
|---|---|---|---|
| Ouvrir | Ouvrir le topic | `Entrée` | |
| | Ouvrir dans un nouvel onglet | `Ctrl+Entrée` (`⌘+Entrée` sur macOS) | `window.open(url, '_blank', 'noopener')` |
| État | Marquer comme lu / Marquer comme non lu | `M` | Libellé et icône selon l'état actuel |
| | Enregistrer dans une liste ›  | — (flèche → ou `E`) | Ouvre le sous-menu. S'il y a déjà N listes : « · N » et étoile pleine `--saved` |
| Article | Ouvrir l'article d'origine ↗ | `O` | Nouvel onglet, `noopener noreferrer` |
| Copier | Copier le lien de l'article | `C` | URL d'origine |
| | Copier le lien Folders | `Maj+C` | URL absolue du topic dans Folders |
| Liste | Retirer de « Nom de la liste » | `Suppr` | **Page d'une liste uniquement**, toujours en dernier, texte et icône `--err` |

Les raccourcis sont des **accélérateurs du menu ouvert**. Ils servent aussi sur une ligne focalisée quand aucun champ n'a le focus. Ce ne sont pas des raccourcis globaux. Ne pas les afficher si une version les désactive.

Variantes selon le contexte : planche « Contenu du menu selon le contexte » (forum non lu, accueil lu et déjà enregistré, page d'une liste).

## 3. Sous-menu « Enregistrer dans une liste »

- Largeur 248 px. Il s'ouvre à droite de l'item, aligné sur lui (−5 px pour compenser le padding).
- Items `role="menuitemcheckbox"` avec `aria-checked`. Chaque item contient : coche ✓ en `--accent`, pastille 10 × 10 de la couleur de liste, nom, compteur en mono à droite.
- Une liste cochée a un fond `--accent-soft` et un nom en 600.
- **Cocher ou décocher ne ferme pas le menu**, pour pouvoir enregistrer dans plusieurs listes d'affilée. Sous Radix : `onSelect={e => e.preventDefault()}`.
- La ★ de la ligne et le « · N » de l'item parent se mettent à jour tout de suite (optimistic update). En cas d'échec : rollback et toast d'erreur.
- Ordre des listes identique au popover ★ de la page topic (2.8). Au-delà de 8 listes : zone scrollable `max-height: 8 × 32px`.
- Séparateur, puis « Nouvelle liste… » (`N`, couleur `--accent`). Cet item **ferme le menu** et ouvre le popover ★ existant, ancré sur la ligne (ou le bouton ⋯), avec le champ de création déjà ouvert et focalisé. Pas de second formulaire.

## 4. Ligne et bouton ⋯

Les colonnes de la grille desktop deviennent :

```css
grid-template-columns: 28px minmax(0,1fr) 170px 48px 112px 32px;
```

La colonne du ⋯ (32 px) est **toujours réservée**, pour que rien ne bouge au survol.

| État | Ligne | Bouton ⋯ |
|---|---|---|
| Repos | fond normal (alternance) | `opacity: 0` (reste focalisable) |
| Survol | `--surface-hover` | visible, fond `--surface`, bordure `--border-strong` |
| Focus clavier sur la ligne | `outline: 2px solid var(--focus); outline-offset: -2px` | visible |
| Menu ouvert (quel que soit le déclencheur) | fond `--accent-soft` + `outline 2px var(--accent)` | enfoncé : bordure et icône `--accent`, `aria-expanded="true"` |

Le bouton ⋯ fait 28 × 28 px :

```html
<button aria-label="Actions pour « {titre} »" aria-haspopup="menu" aria-expanded>
```

Utiliser `.row:hover .more, .row:focus-within .more, .more[aria-expanded=true] { opacity: 1 }`.

L'état « menu ouvert » sur la ligne vient d'un attribut `data-menu-open` posé par le composant via `onOpenChange`. Il est retiré à la fermeture.

## 5. Retour visuel après une action

Planche « Retour visuel après une action ». Toasts : le composant existant, en bas à droite sur desktop, largeur 340 px. Ils ne doivent rien recouvrir d'autre.

| Action | Retour |
|---|---|
| Marquer comme lu / non lu | Mise à jour immédiate de la ligne : dossier plein ↔ contour, titre gras ↔ normal, couleur `--text-read`. Compteur « N non lus » de l'en-tête mis à jour. **Pas de toast.** |
| Enregistrer (cocher une liste) | ★ immédiate sur la ligne. À la fermeture du menu, la ligne fait un fondu `--saved-soft` → fond normal en 600 ms (supprimé si `prefers-reduced-motion`). Pas de toast. |
| Copier un lien | Toast « Lien de l'article copié » ou « Lien Folders copié », 2 s, sans action. Si `navigator.clipboard` échoue : toast d'erreur « Impossible de copier le lien ». |
| Retirer de la liste | La ligne se replie (hauteur → 0 et fondu, 200 ms ; instantané si `reduced-motion`). Toast « Retiré de « Homelab » » + bouton **Annuler**, 5 s. Annuler réinsère la ligne à sa place. La suppression côté serveur peut être immédiate avec une ré-insertion sur Annuler, ou différée de 5 s : au choix, tant que l'UI reste la même. |
| Ouvrir / nouvel onglet / article | Navigation, aucun retour particulier. Ouvrir un topic le marque lu, comme aujourd'hui. |

Après une action qui ferme le menu, le focus revient sur la ligne (ou sur le ⋯ s'il a servi à ouvrir le menu). Après « Retirer », il va sur la ligne suivante, ou sur la précédente si c'était la dernière.

## 6. Positionnement près des bords

Planche « Près des bords ». Logique type floating-ui : `flip()` + `shift({ padding: 8 })`. Radix le fait nativement avec `collisionPadding={8}`.

- **Clic droit** : le coin haut-gauche du menu est au curseur (+2 px).
  - Pas la place en bas : le menu s'ouvre vers le haut, son bord bas calé sur le curseur.
  - Pas la place à droite : il s'ouvre vers la gauche, son bord droit calé sur le curseur.
- **Sous-menu** : à droite de l'item par défaut, sinon à gauche du menu. Verticalement, il est aligné sur l'item puis recalé (`shift`) pour ne pas dépasser la marge de 8 px.
- **Depuis ⋯ ou le clavier** : ancré sous le bouton, aligné à droite (`align="end"`, `sideOffset={4}`). Près du bas, il passe au-dessus du bouton.
- Le menu ne dépasse jamais la marge de 8 px de la fenêtre. Fermeture au scroll de la page : comportement Radix par défaut, à garder.

## 7. Accessibilité

- Conteneur `role="menu"` avec `aria-label="Actions pour « titre »"`. Items `role="menuitem"`, cases `role="menuitemcheckbox"`, filets `role="separator"`. Radix fournit tout ça.
- `↑` / `↓` : item précédent / suivant (boucle). `Home` / `End` : premier / dernier. La saisie d'une lettre va à l'item correspondant (typeahead Radix). Les raccourcis du tableau sont des accélérateurs en plus.
- `→` ou `Entrée` sur « Enregistrer dans une liste » : ouvre le sous-menu, focus sur la première liste. `←` ou `Échap` dans le sous-menu : retour à l'item parent.
- `Échap` dans le menu : ferme et rend le focus au déclencheur (ligne ou ⋯). `Tab` ferme le menu.
- L'item « Retirer » n'est pas annoncé uniquement par la couleur : son libellé est explicite.
- Contrastes vérifiés AA dans les deux thèmes :
  - `--text-muted` sur `--surface` et sur `--surface-hover` ;
  - `--err` sur `--surface` ;
  - `--accent` sur `--accent-soft`.
- Lignes de topic : chaque `<li>` focalisable reçoit `tabindex="0"`. Sinon, le lien du titre reste le point de focus et les raccourcis s'appliquent à la ligne parente (`:focus-within`). Choisir une seule approche et la garder partout.

## 8. Cohérence avec l'existant

- Même ordre d'actions et mêmes libellés que le menu « … » de l'admin mobile et la feuille / le popover ★ de la page topic. « Enregistrer dans une liste » réutilise le même hook de listes que le popover ★.
- Aucune action n'est disponible *uniquement* dans le menu contextuel : tout reste faisable depuis la page topic. Le menu est un raccourci, pas une fonctionnalité cachée.

## 9. Checklist de recette

- [ ] Clic droit sur une ligne : menu au curseur, ligne en état « menu ouvert ».
- [ ] Maj + clic droit : menu natif.
- [ ] Clic droit ailleurs que sur une ligne : menu natif.
- [ ] < 768 px ou `pointer: coarse` : ni menu custom ni ⋯.
- [ ] ⋯ invisible au repos, visible au survol et au focus. Aucun décalage de colonne.
- [ ] `Maj+F10` / touche Menu sur une ligne focalisée ouvre le menu sous ⋯.
- [ ] Sous-menu : cocher deux listes d'affilée sans fermeture, ★ et « · N » à jour.
- [ ] « Nouvelle liste… » ouvre le popover ★ existant avec le champ focalisé.
- [ ] Retirer (page d'une liste) : repli, toast avec Annuler, Annuler restaure la ligne.
- [ ] Copier : toast 2 s ; erreur gérée.
- [ ] Clic droit en bas à droite de la fenêtre : menu vers le haut et la gauche, marge 8 px respectée.
- [ ] Sous-menu près du bord droit : bascule à gauche.
- [ ] `Échap` rend le focus au déclencheur.
- [ ] `prefers-reduced-motion` : pas d'animation de repli ni de fondu.
- [ ] Clair et sombre conformes aux maquettes.

---

## Mise en œuvre (3.2.0) — ce qui s'écarte de la note

Décisions prises à la livraison ; elles priment sur les sections ci-dessus.

- **Pas de Radix ni d'autre dépendance** : un seul menu pour la page (`components/topic/topic-menu.tsx`), en
  `popover="manual"` natif (couche supérieure, pas d'iframe ni de portail), avec le motif ARIA « menu » écrit à la
  main (flèches, `Home` / `End`, saisie d'une lettre, `Échap`, `Tab`, retour du focus). Positionnement près des bords
  par deux fonctions pures (`placeMenu`, `placeSubmenu`), testées.
- **Activation** : `desk:` = `(min-width: 48rem) and (pointer: fine)` (variante Tailwind dans `app/globals.css`). Le
  bouton ⋯ et sa colonne de 32 px n'existent que là ; les autres largeurs de colonnes restent celles de l'existant.
- **Maj + clic droit** : lu sur l'événement (`e.shiftKey`), sans suivre l'état de la touche.
- **Point de focus** : le lien du titre reste le seul arrêt de tabulation de la ligne (plus le ⋯) ; les raccourcis
  s'appliquent à la ligne qui contient le focus.
- **Raccourcis** : `Entrée` active l'item focalisé (le premier, « Ouvrir le topic », à l'ouverture). Les lettres du
  tableau sont prioritaires sur la saisie d'une lettre. Aucun conflit avec « u » et `Échap` (remonter d'un niveau) :
  le menu ouvert arrête la propagation de toutes les touches.
- **Largeur** : 284 px au minimum, jusqu'à 340 px pour ne pas tronquer « Ouvrir dans un nouvel onglet  Ctrl+Entrée ».
- **Lu / non lu, listes** : mises à jour optimistes côté client, sans `revalidatePath` ni `router.refresh`. Les
  compteurs « non lus » (en-tête, forum, accueil) ajoutent les changements enregistrés après leur rendu serveur
  (`components/topic/read-topics.tsx`). Le sous-menu utilise le même hook que la ★ de la page topic
  (`components/lists/use-saved-lists.ts`) ; « Nouvelle liste… » ouvre le même popover ★, champ focalisé.
