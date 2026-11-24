# Folders — note de handoff pour Claude Code

Stack : **Next.js 16 (App Router) + Tailwind CSS v4 (config CSS-first)**.
Maquettes de référence : canvas « Veille — maquettes » (9 planches : 7 écrans, tokens, composants).
Tokens : `veille-tokens.css` → à coller dans `app/globals.css`.

Principe : on reprend la structure d'un forum des années 2000 (tableaux, en-têtes de colonnes en capitales sur barre foncée, lignes alternées, pagination numérotée, dossiers) avec une finition actuelle. **Densité d'abord** : une ligne = un topic.

---

## 1. Mise en place

### Polices — `app/layout.tsx`

```tsx
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed, IBM_Plex_Mono } from "next/font/google";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const cond = IBM_Plex_Sans_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-plex-cond", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${cond.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- **Sans** : interface et lecture. **Cond** (`font-cond`) : logo, titres h1, en-têtes de colonnes et badges en capitales. **Mono** (`font-mono`) : compteurs, pagination, URLs, numéros de post.
- Chiffres tabulaires globaux (`tabular-nums` dans `body`).

### Thème sombre (v3)

Les tokens sont déjà prêts : il suffit d'ajouter `class="dark"` sur `<html>`. Le variant `dark:` est branché sur cette classe. **Aucune couleur en dur dans les composants** : uniquement les classes de tokens (`bg-surface`, `text-fg-muted`, `border-line`…), le sombre fonctionnera sans toucher aux composants.

### Correspondance tokens → classes

| Rôle | Classe |
|---|---|
| Fond de page | `bg-bg` |
| Panneau / ligne paire | `bg-surface` |
| Ligne impaire, bandeau de post | `bg-surface-alt` |
| Survol de ligne | `hover:bg-surface-hover` |
| Bordures | `border-line`, `border-line-strong` |
| Texte | `text-fg`, `text-fg-muted`, `text-fg-read` (titre lu) |
| Header de l'app | `bg-bar text-bar-fg` |
| En-tête de tableau / panneau | `bg-bar-2 text-bar-muted` |
| Accent (liens, primaire) | `text-accent`, `bg-accent text-accent-fg`, `bg-accent-soft` |
| Dossiers | `fill-folder`, `stroke-folder-read`, `fill-hot` |
| Statuts | `ok`, `warn`, `err`, `off` + `-soft` pour les fonds |

Rayons : `rounded-sm` (3 px) boutons/badges/champs, `rounded-md` (6 px) panneaux, `rounded-lg` (8 px) carte de connexion et dialogue, `rounded-full` pastilles.
Ombres : `shadow-sm` panneaux, `shadow-md` toasts, infobulles, dialogues.

L'échelle typo est **redéfinie** (base 14 px) : `text-2xs` 10, `text-xs` 12, `text-sm` 13, `text-base` 14, `text-md` 15, `text-lg` 19, `text-xl` 24, `text-2xl` 28. Les interlignes suivent automatiquement.

---

## 2. Arborescence proposée

```
app/
  layout.tsx                 polices, <html lang="fr">
  globals.css                ← veille-tokens.css
  login/page.tsx             LoginForm
  (app)/                     groupe protégé (vérif. de session dans le layout)
    layout.tsx               <AppHeader/> + <main className="mx-auto w-full max-w-[1200px] px-5 py-4">
    page.tsx                 accueil : ForumTable
    f/[slug]/page.tsx        TopicList + Pagination (?page=n)
    f/[slug]/loading.tsx     TopicListSkeleton
    t/[id]/page.tsx          TopicThread + AddNoteForm
    admin/page.tsx           ForumsPanel + SourcesPanel
components/
  layout/
    AppHeader.tsx            logo, nav (Forums, Admin), bouton Déconnexion ; menu burger < md
    Breadcrumb.tsx
  forum/
    ForumTable.tsx           TableHead + ForumRow[]
    ForumRow.tsx
    ForumIcon.tsx            icônes SVG par forum (sec, ops, lab, news, web)
  topic/
    TopicList.tsx            TableHead (md+) + <ul> de TopicRow
    TopicRow.tsx             état : unread | read | hot | hot-read
    TopicRowSkeleton.tsx
    FolderIcon.tsx           variant : unread | read | hot | hot-read
    TopicListActions.tsx     « Tout marquer comme lu » + Pagination (haut et bas)
  thread/
    Post.tsx                 type : topic | note | source | comment
    PostAuthor.tsx           favicon/initiale, nom, rôle, badge plateforme
    AddNoteForm.tsx
  admin/
    ForumsPanel.tsx          liste ordonnable + création
    SourcesPanel.tsx         tableau + SourceForm
    SourceStatusBadge.tsx    status : ok | error | paused | disabled
    SourceForm.tsx
  ui/
    Button.tsx               variant : primary | secondary | danger | ghost-icon ; size : sm | md
    Badge.tsx                hot | post-type | platform | count
    TableHead.tsx            barre bg-bar-2, libellés en capitales
    Pagination.tsx
    Toast.tsx / Toaster.tsx
    EmptyState.tsx
    ConfirmDialog.tsx        <dialog> natif
    Tooltip.tsx
lib/
  format-date.ts             dates relatives (voir § 5)
```

---

## 3. Composants : classes clés

### AppHeader

```
<header class="bg-bar text-bar-fg border-b border-black/30">
  <div class="mx-auto flex min-h-13 max-w-[1200px] items-center gap-7 px-5">
    logo : SVG 26 px + « Folders » en font-cond font-bold text-[21px] leading-none
    nav (md+) : <a> text-sm font-medium px-3 py-[7px] rounded-sm text-bar-muted hover:bg-white/8
       actif : aria-current="page" text-bar-fg font-semibold bg-white/12 shadow-[inset_0_-2px_0_var(--bar-accent)]
    Déconnexion : h-8 px-3 rounded-sm border border-white/28 text-sm font-medium
```
< md : logo + bouton burger 44×44 (`aria-label="Ouvrir le menu"`, `aria-expanded`), nav et Déconnexion dans un panneau déroulant.

### TableHead (en-têtes de colonnes, partagé)

`grid h-8 items-center gap-x-3 px-4 bg-bar-2 text-bar-muted font-cond text-xs font-semibold uppercase tracking-caps` — masqué < md (`hidden md:grid`), `aria-hidden` (les libellés visuels ne sont pas nécessaires à la lecture d'une liste).

### TopicList / TopicRow — écran principal

Conteneur : `rounded-md border border-line bg-surface shadow-sm overflow-hidden`.
Liste : `<ul>` ; chaque ligne est un `<li>`. **Le même markup sert desktop et mobile** grâce à la grille.

Colonnes desktop (md+) : `grid-cols-[28px_minmax(0,1fr)_190px_56px_124px]` → icône | sujet | auteur (source) | Nb | dernier msg.

```
<li class="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-2.5 px-3.5 py-2.5
           md:grid-cols-[28px_minmax(0,1fr)_190px_56px_124px] md:gap-x-3 md:px-4 md:py-0 md:min-h-[38px] md:items-center
           border-t border-line odd:bg-surface even:bg-surface-alt hover:bg-surface-hover
           has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus">
  <FolderIcon/>                                       (pt-px sur mobile)
  <div class="flex min-w-0 flex-col gap-1 md:flex-row md:items-center md:gap-2">
    <a href="/t/{id}" class="text-md md:text-base line-clamp-2 md:line-clamp-none md:truncate
                              after:absolute after:inset-0  {état}">titre</a>
    <Badge hot/> (si chaud)
    <p class="md:hidden text-[12.5px] leading-4 text-fg-muted flex flex-wrap gap-x-1.5">source · 3 réponses · il y a 8 min</p>
  </div>
  <span class="hidden md:flex items-center gap-1.75 text-sm text-fg-muted truncate">favicon 16 px + source</span>
  <span class="hidden md:block text-right font-mono text-sm font-medium">3</span>
  <time class="hidden md:block text-right text-sm text-fg-muted whitespace-nowrap" dateTime=… title="19/11/2026 à 09:35">il y a 8 min</time>
</li>
```

- **Lien étiré** (`after:absolute after:inset-0`) : toute la ligne est cliquable, mais un seul arrêt de tabulation (le titre). Focus visible = contour sur la ligne via `has-[a:focus-visible]`.
- Ordre des lignes alternées : `odd:`/`even:` sur les `<li>`.

États (jamais la couleur seule) :

| État | Titre | Icône | Badge |
|---|---|---|---|
| `unread` | `font-bold text-fg` | dossier plein `fill-folder` | — |
| `read` | `font-normal text-fg-read` | dossier contour `stroke-folder-read` | — |
| `hot` (v2) | `font-bold text-fg` | dossier plein `fill-hot` + flamme `fill-hot-flame` | « Chaud » |
| `hot-read` (v2) | `font-normal text-fg-read` | dossier contour `stroke-hot` + flamme | « Chaud » |

Chaque `FolderIcon` a `role="img"` et un `aria-label` (« Non lu », « Lu », « Chaud, non lu », « Chaud, lu »).

Badge « Chaud » : `shrink-0 rounded-sm border border-hot bg-hot-soft px-1.25 font-cond text-2xs font-bold uppercase tracking-caps text-hot`.

Au-dessus de la liste :
- Breadcrumb, puis titre du forum (`font-cond text-xl font-bold`) avec description `text-sm text-fg-muted` et compteurs « 87 topics · **5 non lus** » (`text-accent font-bold`).
- `TopicListActions` en haut **et** en bas : bouton secondaire « Tout marquer comme lu » + « Page 1 sur 4 » + Pagination. Wrapper `flex flex-wrap items-center justify-between gap-2.5`.
- Sous la liste : légende des icônes (`border-t border-dashed border-line pt-1.5 text-xs`), clin d'œil aux vieux forums et aide à la lecture.

### FolderIcon — SVG (viewBox 0 0 20 20)

```
plein   : <path d="M2.5 5.25c0-.69.56-1.25 1.25-1.25h3.6c.33 0 .65.13.88.37L9.6 5.75h6.65c.69 0 1.25.56 1.25 1.25v8.25c0 .69-.56 1.25-1.25 1.25H3.75c-.69 0-1.25-.56-1.25-1.25z"/>
          + ligne de rabat <path d="M2.5 8.5h15" stroke="var(--surface)" stroke-opacity=".45"/>
contour : <path d="M3.25 5.25c0-.28.22-.5.5-.5h3.6c.13 0 .26.05.35.15l1.9 1.6h6.65c.28 0 .5.22.5.5v8.25c0 .28-.22.5-.5.5H3.75a.5.5 0 0 1-.5-.5z" fill="none" stroke-width="1.5"/>
flamme  : <path d="M10 7.6c.2 1 .9 1.6 1.6 2.3.6.6 1 1.3 1 2.2a2.6 2.6 0 0 1-5.2 0c0-.8.3-1.4.8-1.9.1.6.4 1 .9 1.2-.2-1.4.2-2.7.9-3.8z"/>
```
(Le SVG exact de chaque variante est dans la planche Composants.)

### ForumTable / ForumRow — accueil

Colonnes md+ : `grid-cols-[40px_minmax(0,1fr)_80px_88px_280px]` → icône | forum (nom + description) | topics | non lus | dernier topic. `py-3`.
- Tuile icône 36 px `rounded-md` : `bg-accent-soft text-accent` s'il y a des non-lus, sinon `bg-off-soft text-fg-muted`.
- Nom : `text-[15px]`, `font-bold` si non-lus, sinon `font-medium`.
- Non lus : pastille `min-w-7 rounded-full bg-accent px-2 font-mono text-sm font-semibold leading-[22px] text-accent-fg` + texte masqué « non lus » (`sr-only`). Zéro : `font-mono text-fg-read`.
- Dernier topic : titre tronqué `text-sm` + « source · date » `text-xs text-fg-muted`.
- < md : colonnes Topics et Dernier topic masquées ; la pastille passe à droite du nom.

### Post — page topic

```
<article id="p{n}" class="rounded-md border bg-surface shadow-sm overflow-hidden">
  bandeau : flex min-h-7.5 items-center justify-between px-3.5 border-b bg-surface-alt text-xs text-fg-muted
            gauche : <a href="#p{n}" class="font-mono">#n</a> + Badge type ; droite : <time>19 nov. 2026 à 09:35</time>
  corps   : flex flex-wrap
            PostAuthor : basis-[168px] shrink-0 border-r border-line p-4 flex flex-col items-center gap-2 text-center
            contenu    : flex-[999_1_420px] min-w-0 px-5.5 py-4 flex flex-col gap-3
```
< md : `PostAuthor` devient une ligne horizontale en haut du contenu (avatar 32 px + nom + rôle), plus de colonne.

| type | Badge du bandeau | Avatar | Contenu | Particularité |
|---|---|---|---|---|
| `topic` | « Article » `bg-accent-soft text-accent` | carré 52 px, initiale/favicon | h2 `text-lg font-semibold`, extrait `text-md max-w-[72ch]` (~500 car.), bouton primaire « Lire l'article ↗ » + domaine en mono | toujours #1 |
| `source` (v2) | « Reprise » `bg-off-soft text-fg-muted` + icône | carré 40 px | « Repris par **Nom** », titre de leur article, lien « Voir l'article ↗ » | |
| `comment` (v2) | « Commentaire » + icône bulle | **rond** 40 px | texte (`lang="en"` si besoin), lien vers le fil | badge plateforme sous le pseudo : `rounded-full border border-line-strong px-2 font-mono text-[11px] font-semibold` (« Hacker News », « Reddit ») |
| `note` | « Note perso » `bg-accent text-accent-fg` | rond 40 px `bg-accent` | texte `whitespace-pre-line` | **bordure et bandeau accent** (`border-accent`, bandeau `bg-accent-soft`) |

Lien sortant : `target="_blank" rel="noopener noreferrer"`, la flèche ↗ en `aria-hidden`.

AddNoteForm : même gabarit qu'un post, en-tête `bg-bar-2` « Ajouter une note », `<label>` « Ta note », `<textarea>` 5 lignes `min-h-30 rounded-sm border-line-strong`, bouton primaire « Poster » aligné à droite (pleine largeur < md). Sur mobile, `text-[16px]` dans le textarea pour éviter le zoom iOS.

### Pagination

- Desktop : `‹ 1 2 3 4 ›`, boutons `min-w-8 h-8 rounded-sm border border-line bg-surface font-mono text-sm`. Page courante : `aria-current="page" bg-accent text-accent-fg font-semibold border-transparent`. Précédent désactivé : `<span aria-disabled="true">` `text-line-strong`.
- Plus de 7 pages : `1 … 5 [6] 7 … 12` (première, dernière, courante ± 1).
- < md : « ‹ Préc. » · « 1 / 4 » · « Suiv. › », boutons `h-11`.
- Le numéro de page est dans l'URL (`?page=2`) → liens `<Link>`, pas de state client.
- `<nav aria-label="Pagination">` ; deux instances par page (haut, bas) avec des libellés distincts.

### Breadcrumb

`<nav aria-label="Fil d'Ariane"><ol class="flex flex-wrap items-center gap-1.5 text-sm text-fg-muted">`, séparateur `›` en `aria-hidden text-line-strong`, dernier élément `aria-current="page" text-fg font-medium truncate max-w-[520px]`.

### Button

Base : `inline-flex items-center gap-1.5 rounded-sm border font-semibold text-sm h-8 px-3 cursor-pointer disabled:cursor-not-allowed`. Taille `md` : `h-9 px-3.5 text-base`. Mobile : `h-11`.

| variant | défaut | survol | désactivé |
|---|---|---|---|
| primary | `bg-accent border-accent text-accent-fg` | `bg-accent-hover` | `bg-off-soft border-line text-fg-read` |
| secondary | `bg-surface border-line-strong text-fg shadow-sm` | `bg-surface-hover` | `text-fg-read border-line` |
| danger | `bg-surface border-err text-err` | `bg-err text-err-fg` | `text-fg-read border-line` |
| ghost-icon | `size-8 justify-center border-transparent bg-transparent` | `bg-surface-hover` | `text-line-strong` |

Bouton icône : `aria-label` obligatoire + `title` pour l'infobulle native.

### SourceStatusBadge

Pastille `inline-flex h-5.5 items-center gap-1.25 rounded-full px-2 text-xs font-semibold` + icône 12 px :

| status | Classes | Icône | Libellé | Ligne sous la pastille |
|---|---|---|---|---|
| `ok` | `bg-ok-soft text-ok` | coche | OK | — |
| `error` | `bg-err-soft text-err` | ! | En erreur | message en `font-mono text-[11.5px] text-err` (ex. « HTTP 503 · 3 échecs ») |
| `paused` | `bg-warn-soft text-warn` | pause | En pause jusqu'à HH:MM | raison `text-fg-muted` |
| `disabled` | `bg-off-soft text-off border border-dashed border-line-strong` | cercle barré | Désactivée | — (nom de la source en `text-fg-read`) |

### Admin

Mise en page : `flex flex-wrap items-start gap-5`. ForumsPanel `flex-[1_1_320px] max-w-[360px]`, SourcesPanel `flex-[999_1_640px] min-w-0`. Les deux s'empilent < 1000 px environ.

**ForumsPanel** : `<ol>` ; ligne = poignée (6 points, `cursor-grab`) + nom + « n sources · n topics » + boutons icône Monter / Descendre / Renommer / Supprimer (30 px).
- Monter désactivé sur le premier, Descendre sur le dernier.
- Glisser-déposer : `@dnd-kit/sortable` (clavier inclus) ; les flèches restent l'alternative accessible.
- Supprimer : `aria-disabled="true"` (pas `disabled`, pour garder le focus et l'infobulle) si le forum a des sources, infobulle `role="tooltip"` reliée par `aria-describedby` : « Impossible : ce forum contient N sources. Déplace-les ou supprime-les d'abord. »
- Formulaire « Nouveau forum » en pied de panneau.

**SourcesPanel** : en-tête `bg-bar-2` avec le bouton « Ajouter une source » (clair sur barre foncée). Colonnes : `grid-cols-[minmax(0,1fr)_128px_168px_104px_136px]` → Nom + URL (2 lignes, URL en mono tronquée) | Forum | Statut | Dernière récup. | Actions. Tableau dans un `overflow-x-auto` avec `min-w-[720px]`.
Actions (boutons icône 32 px) : Récupérer maintenant (`text-accent`), Désactiver / Activer, Modifier, Supprimer (`text-err`, ouvre `ConfirmDialog`).
`SourceForm` sous le tableau (`bg-surface-alt`) : Nom, URL du flux (`type="url"`, police mono), Forum (`<select>`), boutons Annuler / Enregistrer. Grille `grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))]`, l'URL prend 2 colonnes.

**ConfirmDialog** : `<dialog>` natif, `rounded-lg shadow-md p-4.5`, titre « Supprimer « Nom » ? », texte « La source ne sera plus récupérée. Cette action est définitive. », boutons secondaire « Annuler » (focus par défaut) + danger plein « Supprimer ».

### Toast

Bas droite, `fixed bottom-6 right-6 w-[340px]`, empilés `gap-2` ; < md : `inset-x-3 bottom-3 w-auto`.
`flex items-start gap-2.5 rounded-md border border-line bg-surface p-3 shadow-md`, pastille d'icône 22 px (`bg-ok-soft text-ok` ou `bg-err-soft text-err`), texte `text-base`, bouton fermer 24 px.
- Succès : `role="status"`, disparaît après 5 s. Ex. « **Source récupérée :** 4 nouveaux topics ».
- Erreur : `role="alert"`, bordure `border-err`, reste jusqu'à fermeture. Ex. « **Échec :** timeout » + nom de la source en `text-fg-muted`.

### EmptyState

`flex flex-col items-center gap-2.5 rounded-md border border-dashed border-line-strong bg-surface px-5 py-8 text-center` ; icône 40 px, titre `text-[15px] font-semibold`, texte `text-sm text-fg-muted max-w-[260px]`.
- Forum sans topic : dossier contour, « Aucun topic dans ce forum », pas d'action.
- Aucune source : icône flux, « Aucune source configurée », bouton primaire « Ajouter une source » → `/admin`. S'affiche aussi sur l'accueil s'il n'y a aucune source.

### TopicListSkeleton (`loading.tsx`)

Même grille que TopicRow, 8 à 10 lignes de 38 px ; blocs `bg-off-soft rounded-sm animate-pulse-soft` (largeur du titre variable 45–80 %). Conteneur `aria-busy="true" aria-label="Chargement des topics"`. Respecter `motion-reduce:animate-none`.

### LoginForm

Fond `bg-bg` avec trame de points (`bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[18px_18px]`), colonne centrée `max-w-[380px]`.
Logo 44 px (`bg-bar rounded-lg`) + « Folders » en `font-cond text-[32px] font-bold`.
Carte `rounded-lg border bg-surface shadow-md`, en-tête `bg-bar-2` « Connexion » (h1 en capitales `font-cond`).
Champs `h-10 rounded-sm border-line-strong px-3 text-[15px]`, `autocomplete="username"` / `"current-password"`.
Erreur : bloc `role="alert"` `rounded border border-err bg-err-soft text-err p-2.5 text-base` avec icône : « **Connexion impossible.** Email ou mot de passe incorrect. » + `aria-invalid="true"` et `border-err` sur le champ mot de passe. Bouton primaire pleine largeur `h-10.5` « Se connecter ».

---

## 4. Règles responsive

Un seul point de bascule principal : **`md` (768 px)**.

| Élément | < md | ≥ md |
|---|---|---|
| AppHeader | logo + burger 44 px | logo + nav + Déconnexion |
| TopicRow | 2 lignes : titre (`line-clamp-2`, `text-md`), puis « source · N réponses · date » | 1 ligne, 5 colonnes, titre tronqué |
| En-têtes de colonnes | masqués | visibles |
| ForumRow | icône + nom/desc + pastille | 5 colonnes |
| Post | auteur en ligne au-dessus du contenu | colonne auteur 168 px à gauche |
| Pagination | Préc. / « 1 / 4 » / Suiv. (44 px) | numéros |
| Actions « Tout marquer comme lu » | `h-11`, libellé court « Tout marquer lu » | `h-8` |
| Admin | panneaux empilés, tableau Sources en scroll horizontal | côte à côte |
| Toast | pleine largeur en bas | bas droite, 340 px |

- Cibles tactiles ≥ 44 px partout < md.
- Conteneur : `mx-auto max-w-[1200px] px-5` (desktop), `px-2.5`–`px-3.5` (mobile).
- Pas de `100vh` ; le header n'est pas sticky (lecture longue sur téléphone).

---

## 5. Dates

`lib/format-date.ts`, fuseau Europe/Paris, toujours dans un `<time dateTime={iso} title="19/11/2026 à 09:35">` :

| Écart | Affichage |
|---|---|
| < 1 min | à l'instant |
| < 60 min | il y a 12 min |
| même jour | il y a 3 h |
| la veille | hier 18:42 |
| même année | 17 nov. |
| sinon | 17 nov. 2025 |

Page topic : date complète « 19 nov. 2026 à 09:35 » (mobile : « 19 nov. · 09:35 »).
Rendu serveur puis rafraîchissement côté client toutes les 60 s (petit composant client `RelativeTime`) pour éviter les écarts d'hydratation : `suppressHydrationWarning` sur le `<time>`.

---

## 6. Accessibilité (AA)

- Contrastes vérifiés : toutes les paires texte/fond ≥ 4,5:1 dans les deux thèmes, y compris `text-fg-read` sur `surface-alt` ; icônes ≥ 3:1.
- Lu / non lu / chaud : **graisse + forme d'icône + libellé** (`aria-label` sur l'icône, badge « Chaud » texte). Jamais la couleur seule.
- Focus clavier : contour 2 px `outline-focus` sur tous les éléments interactifs ; sur les lignes de topic, contour sur la ligne entière.
- Un seul arrêt de tabulation par ligne de topic (lien étiré).
- `<html lang="fr">` ; `lang="en"` sur les commentaires importés en anglais.
- Pastilles de comptage avec texte `sr-only` (« 5 non lus »).
- Statuts de source : icône + libellé texte, message d'erreur visible (pas seulement au survol).
- Toasts : `role="status"` (succès) / `role="alert"` (erreur).
- Pas d'images : icônes SVG inline, favicons des sources en `<img>` 16 px avec repli sur l'initiale.

---

## 7. Hors périmètre v1 (déjà dessiné)

- État « chaud » (v2) : seuil à définir (proposition : au moins 2 sources distinctes sur le même sujet). Le badge de la page topic affiche « Chaud · N sources ».
- Posts `source` et `comment` (v2).
- Thème sombre (v3) : tokens prêts, il manque seulement le bouton de bascule et la persistance (cookie lu côté serveur pour éviter le flash).
