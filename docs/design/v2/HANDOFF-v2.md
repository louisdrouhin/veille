# Folders v2 — note de passation pour Claude Code

Deux évolutions sur la base existante (Next.js 16 App Router + Tailwind v4, même DA « forum rétro modernisé ») :

1. **Nouvelle page d'accueil** (À la une, résumé chiffré, derniers non lus, forums).
2. **Mode sombre de toute l'app**, qui suit le système, avec un choix Clair / Sombre / Système dans **Mon compte**. Ajout d'un **mode lecture** sur la page topic.

Plus le renommage **Veille → Folders**.

Références : canvas « Veille — maquettes », page **v2 · Folders — clair + sombre** (chaque maquette mobile montre clair et sombre côte à côte). Tokens : `veille-tokens.css` v2, qui remplace la v1 dans `app/globals.css`.

Priorité : **mobile**, usage principal en app installée sur iPhone (PWA en mode standalone).

---

## 0. Renommage

- Chaînes visibles : header (logo + « Folders »), écran de connexion, `<title>` (`%s · Folders`), `metadata.applicationName`, `appleWebApp.title`.
- `app/manifest.ts` : `name: "Folders"`, `short_name: "Folders"`.
- Ne pas renommer le repo, les routes ni les tables dans ce lot.

---

## 1. Tokens et thème

### 1.1 Ce qui change dans `veille-tokens.css`

- Les **noms de variables sont identiques** en clair et en sombre. Aucune classe de composant ne change : `bg-surface`, `text-fg-read`, etc.
- Clair, deux corrections AA : `--border-strong` #C4C0B6 → **#8C887F** (bord des champs à 3:1) et `--text-read` #6B6862 → **#66635D** (4,5:1 sur une ligne survolée).
- Sombre entièrement revu. Le tableau complet et les 17 paires de contraste vérifiées sont sur la planche « Tokens sombres + contrastes ». Points clés :
  - `--bar` #1C3039 / `--bar-2` #24404B : le même bleu-gris que le clair, un peu plus profond.
  - `--folder` #4F97B8 (non lu) et `--hot` #FF8F70 (chaud) ont des **luminances différentes** (0,27 contre 0,42) en plus de la forme de l'icône. Non lu et chaud restent distincts même pour un daltonien.
  - `--text-read` #999790 sur toutes les surfaces ≥ 4,9:1. Lu / non lu se distinguent par la graisse (400 / 700) et l'icône pleine ou en contour, pas par une couleur illisible.
- `.dark` (v1) est **remplacé** par l'attribut `data-theme` sur `<html>`.

### 1.2 Résolution

| `data-theme` | Rendu |
|---|---|
| `system` (défaut) | `@media (prefers-color-scheme: dark)` applique les valeurs sombres |
| `light` | valeurs de `:root`, la media query est ignorée |
| `dark` | valeurs sombres forcées |

Le variant Tailwind `dark:` est redéfini pour couvrir « forcé sombre » et « système en sombre ». Il est rarement nécessaire, les variables suffisent.

### 1.3 Stockage et rendu sans flash

- Colonne `theme` sur l'utilisateur : `'system' | 'light' | 'dark'`, défaut `'system'`. Le réglage est **sur le compte**, donc identique sur tous les appareils (« Système » suit chacun des appareils).
- Un cookie miroir `folders-theme` (httpOnly: false, 1 an, `sameSite: lax`) est posé à la connexion et à chaque changement.
- `app/layout.tsx` (Server Component) lit le cookie et rend `<html lang="fr" data-theme={theme}>`. **Pas de script anti-flash** : « système » est résolu en CSS pur, « clair » et « sombre » sont connus côté serveur.
- Server Action `setTheme(value)` : valide la valeur, met à jour la DB et le cookie, puis `revalidatePath("/", "layout")`. Le client applique tout de suite `document.documentElement.dataset.theme = value` (retour instantané, sans attendre le serveur).

### 1.4 Barre d'état iPhone et header continu

```ts
// app/layout.tsx
export const metadata: Metadata = {
  applicationName: "Folders",
  appleWebApp: { capable: true, title: "Folders", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1E3640" },
    { media: "(prefers-color-scheme: dark)",  color: "#1C3039" },
  ],
};
```

- `black-translucent` : la page passe **sous** la barre d'état, et l'heure et la batterie s'affichent en blanc. C'est pourquoi `--bar` est foncé dans les deux thèmes (texte blanc : 12:1 en clair comme en sombre).
- Header : `bg-bar pt-[env(safe-area-inset-top)]`. La safe-area prend donc la couleur du header, sans aucune fausse barre d'état dessinée.
- Le header n'est pas sticky. Pour que le contenu ne défile pas sous l'heure, ajouter une bande fixe :
  `<div aria-hidden className="fixed inset-x-0 top-0 z-50 h-[env(safe-area-inset-top)] bg-bar" />`
- Rebond (overscroll) en haut : `html { background: var(--bar) }` et `body { background: var(--bg); min-height: 100dvh }`, pour éviter un éclair de fond clair au-dessus du header.
- Bas d'écran : `pb-[calc(env(safe-area-inset-bottom)+12px)]` sur `<main>`, et toasts au-dessus de l'indicateur d'accueil (`bottom-[calc(env(safe-area-inset-bottom)+8px)]`).
- `manifest.ts` : `display: "standalone"`, `background_color: "#1E3640"` (écran de lancement bleu-gris, neutre dans les deux thèmes), `theme_color: "#1E3640"`.
- Si le thème est forcé (`light` ou `dark`), rendre un seul `<meta name="theme-color">` correspondant (via `generateViewport` qui lit le cookie).

---

## 2. Nouvelle page d'accueil `/`

Ordre de haut en bas, identique en mobile et desktop :

```
FeaturedSection   « À la une »         ← v2 future, emplacement prévu dès maintenant
HomeStats         résumé chiffré + ErrorAlert (si erreurs)
LatestUnread      « Derniers non lus »  (8 topics, tous forums)
ForumTable        liste des forums (inchangée)
```

### 2.1 Composants

```
components/home/
  FeaturedSection.tsx   rendu seulement si FEATURED_ENABLED && items.length > 0
  FeaturedCard.tsx      dossier chaud 20 px, titre text-base/md bold, « Repris par N sources » (text-hot, bold), favicons empilés (-ml-1.5, bordure surface)
  HomeStats.tsx         <dl> en 3 colonnes : non lus · reçus aujourd'hui · dernière récup.
  ErrorAlert.tsx        lien vers /admin#sources ; null si errorCount === 0
  LatestUnread.tsx      panneau (en-tête bg-bar-2) + <ul> de TopicRow showForum
```

**FeaturedSection** : conteneur `rounded-lg border-[1.5px] border-dashed border-line-strong p-2` pendant le développement (repère d'emplacement) ; à l'activation, la bordure en pointillés disparaît et le titre « À la une » reste en `font-cond uppercase text-hot`. Carte : `rounded-md border border-hot bg-surface`.

**HomeStats** :
- Mobile : `grid grid-cols-3` dans un panneau, chiffres `font-mono text-xl font-semibold`, libellés `text-[11.5px] text-fg-muted`, séparateurs `border-l border-line`.
- Desktop : une ligne `flex`, chiffre et libellé côte à côte (`items-baseline gap-2`), `ErrorAlert` à droite dans la même rangée.
- « non lus » en `text-accent` s'il y en a, en `text-fg-read` à 0.
- Dernière récupération en heure locale `HH:MM` (Europe/Paris), avec un `<time dateTime title="dernière récupération : 24/11/2026 09:41">`.

**ErrorAlert** : `flex min-h-11 items-center gap-2 rounded-md border border-err bg-err-soft px-3 text-err`, icône !, texte « **1 source en erreur** » / « **N sources en erreur** », suivi de « Voir l'admin › ».

**TopicRow `showForum`** (nouvelle prop) :
- Mobile : badge de forum en tête de la ligne de métadonnées, `rounded-sm border border-line-strong px-1 font-cond text-2xs font-bold uppercase tracking-[.06em] text-fg-muted`, puis Chaud, source, réponses, date.
- Desktop : colonne supplémentaire, `grid-cols-[28px_minmax(0,1fr)_150px_170px_48px_112px]` (icône | sujet | forum | auteur | Nb | date). Le badge de forum est un lien vers `/f/[slug]`.

### 2.2 Données (une seule requête serveur par bloc, en parallèle)

```ts
const [stats, latest, forums, featured] = await Promise.all([
  getHomeStats(),            // { unreadTotal, receivedToday, lastFetchAt, errorCount, sourceCount }
  getLatestUnread({ limit: 8 }),  // topics non lus, tous forums, ORDER BY publishedAt DESC
  getForumsWithCounts(),     // existant
  FEATURED_ENABLED ? getFeatured({ limit: 3 }) : [],
]);
```
- `receivedToday` : topics créés depuis minuit Europe/Paris (créés en base, pas date de publication).
- `errorCount` : sources au statut `error` (pas `paused` ni `disabled`).
- `FEATURED_ENABLED` : constante dans `lib/flags.ts`, `false` tant que la détection des sujets « chauds » n'existe pas.

### 2.3 États vides

| Cas | Rendu |
|---|---|
| `sourceCount === 0` | toute la page = `EmptyState` « Aucune source configurée » + bouton primaire « Ajouter une source » → `/admin#sources` (h-11 sur mobile). Pas de résumé, pas d'À la une, pas de forums. |
| `unreadTotal === 0` | résumé avec « 0 non lu » en `text-fg-read`, pas d'ErrorAlert s'il n'y a pas d'erreur ; `LatestUnread` affiche dans son panneau : pastille `bg-ok-soft text-ok` avec double coche, « **Tout est lu** », « Les nouveaux articles apparaîtront ici à la prochaine récupération. » ; forums affichés normalement. |

---

## 3. Mode lecture

> **Abandonné (24/11/2026).** Pas de route `/t/[id]/lire`, pas de bouton « Mode lecture » : l'article complet
> (contenu du flux ou extrait avec Readability, HTML assaini, images via le proxy) reste affiché dans la page
> topic, comme avant la v2. La suite de cette section est gardée pour mémoire.

- Route : `/t/[id]/lire` (partageable, et le bouton Retour natif fonctionne). Entrée : bouton secondaire « Mode lecture » (icône livre) à côté du compteur de messages, `h-11` mobile / `h-[34px]` desktop.
- Pas de header standard : barre fine `bg-bar` (avec la safe-area) contenant « ‹ Quitter la lecture » (lien vers `/t/[id]`) et le groupe `role="group" aria-label="Taille du texte"` avec A− / A+ (44 × 44 mobile).
- Desktop : touche **Échap** pour quitter (écouteur sur la page de lecture uniquement), indice `<kbd>`.
- Fond `bg-surface`, colonne `mx-auto max-w-[680px] px-5.5` (mobile) / `px-6 py-12` (desktop).
- Contenu : forum en capitales + badge Chaud ; h1 `text-[26px]/[33px]` mobile, `text-[34px]/[42px]` desktop, `font-semibold text-balance` ; ligne source · date ; extrait en 2 paragraphes ; bouton primaire « Lire l'article complet ↗ » (`h-12` pleine largeur sur mobile).
- « Dans le fil · N » : réponses **aplaties** (pas de colonne auteur) : badge de type + auteur + heure, puis texte `text-base/[25px]`. Lien « Ajouter une note » en bas (renvoie à `/t/[id]#note`).
- Taille du texte : 4 crans (16/26, 18/30, 20/33, 22/36 px en mobile ; +1 px en desktop), cran 2 par défaut, gardé dans `localStorage("folders-reading-size")`. Appliqué via une variable CSS sur `<article>`, pas de re-render serveur.
- Fonctionne dans les deux thèmes sans token supplémentaire.

---

## 4. Mon compte `/compte`

- Accès : desktop, lien « Mon compte » avec avatar à droite du header (remplace le bouton Déconnexion) ; mobile, entrée du menu burger (Forums, Admin, Mon compte, Se déconnecter).
- Sections : Profil (avatar, pseudo, email), **Apparence**, déconnexion (bouton danger secondaire).
- **ThemePicker** :

```tsx
<fieldset>
  <legend className="text-[15px] font-semibold">Thème</legend>
  <div className="grid grid-cols-3 gap-2 md:gap-3">
    {/* une <label> par option, input radio visuellement masqué (sr-only), name="theme" */}
  </div>
  <p className="text-sm text-fg-muted">{hint}</p>
</fieldset>
```
- Carte d'option : `rounded-md border border-line-strong bg-surface p-2` ; cochée : `border-2 border-accent bg-accent-soft` + pastille coche `bg-accent text-accent-fg` + libellé `font-bold`. Focus clavier : `has-[input:focus-visible]:outline-2 outline-focus`.
- Aperçu dans chaque carte (58 px mobile, 92 px desktop) : mini écran dessiné avec les **valeurs en dur** des deux thèmes (pas les variables, sinon l'aperçu « Clair » deviendrait sombre). Système = moitié clair, moitié sombre.
- Texte d'aide dynamique : Système → « Suit le réglage de l'iPhone : sombre en ce moment. Change tout seul quand l'appareil bascule. » (le « en ce moment » vient de `matchMedia("(prefers-color-scheme: dark)")`, avec un écouteur `change`) ; Clair / Sombre → « Toujours clair / sombre, quel que soit le réglage de l'appareil. »
- Changer d'option = `setTheme()` immédiat (pas de bouton Enregistrer).

---

## 5. Autres écrans en sombre

Liste de topics, page topic, admin et connexion : **aucun changement de structure**, uniquement les tokens. Ajustements :
- Admin mobile : sources en **cartes** (nom + URL mono, badge forum, statut + dernière récup., message d'erreur en `font-mono text-err`, rangée d'actions « Récupérer » (bouton plein largeur) + 3 boutons icône 44 px). Carte en erreur : `border-err`. Onglets d'ancre « Forums · 5 / Sources · 8 » en contrôle segmenté (`bg-off-soft p-[3px]`, actif `bg-surface shadow-sm`). Forums : flèches 44 px + menu « … » (Renommer, Supprimer).
- Connexion mobile : le bloc logo est dans le header `bg-bar` (avec la safe-area), champs `h-12 text-base` (16 px, pas de zoom iOS).
- Toasts mobiles : pleine largeur moins 10 px, au-dessus de l'indicateur d'accueil, bouton fermer 44 px.

---

## 6. Accessibilité (rappel v2)

- Contraste AA vérifié dans les deux thèmes (voir la planche) : texte ≥ 4,5:1, icônes et bords de champs ≥ 3:1.
- Les états lu / non lu / chaud reposent sur la graisse, la forme de l'icône (pleine / contour / flamme) et le libellé (`aria-label`, badge « Chaud »), jamais la couleur seule.
- Cibles ≥ 44 px partout sur mobile.
- `color-scheme` défini par thème : barres de défilement, champs natifs et `<select>` suivent le thème.
- Respecter `prefers-reduced-motion` pour le squelette et les toasts.

---

## 7. Recette

- [ ] Safari iOS, app installée : header bleu-gris continu sous l'heure, en clair et en sombre ; le contenu ne passe jamais sous l'heure en défilant.
- [ ] Réglage iOS clair ↔ sombre avec « Système » : bascule sans recharger.
- [ ] Clair ou Sombre forcé : survit au rechargement, pas de flash au démarrage à froid de la PWA.
- [ ] DevTools > Rendering > prefers-color-scheme : les deux valeurs, sur chaque écran.
- [ ] Accueil : 0 source, tout lu, avec erreurs, sans erreur.
- [ ] ~~Mode lecture : A− / A+ mémorisé, Échap (desktop), Retour natif.~~ (§3 abandonnée)
- [ ] Lighthouse / axe : 0 erreur de contraste dans les deux thèmes.
