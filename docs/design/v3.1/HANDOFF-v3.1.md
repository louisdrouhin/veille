# Folders v3.1 — Barre d'actions de la page topic · passation pour Claude Code

Retouche ciblée de la page topic. Les trois boutons actuels (« ★ Enregistrer » seul sur sa ligne, puis « Résumer » et « Traduire en français » une ligne plus bas, tous au même poids) sont remplacés par **une seule barre d'actions** sous le titre.

Références : canvas « Veille — maquettes », page **v3.1 · Barre d'actions topic** :
- les 9 états, en clair et en sombre ;
- la page complète, interactive en mode Play ;
- le repli sur deux lignes ;
- le desktop.

Aucun nouveau token : tout utilise `veille-tokens.css` v3.

---

## 1. Structure

```
<h1>  titre
<p>   méta : « Proxmox Blog · il y a 2 h · 2 messages »   (text-sm text-fg-muted)
<div role="group" aria-label="Actions sur l'article">     ← TopicActionBar
  SaveButton                (gauche, inchangé depuis la v3)
  AiTools                   (droite, ml-auto) — absent si pas de clé IA
</div>
ListChips « Dans … »        (si enregistré, inchangé)
AiSummaryPanel              (si résumé en cours / affiché / en erreur)
<article> #1                (bandeau de traduction en tête si traduit)
```

L'encart du résumé s'affiche **sous la barre et sous les chips, au-dessus de l'article**. Il pousse l'article vers le bas ; il ne flotte pas par-dessus.

## 2. TopicActionBar

- `flex items-center justify-between gap-2 flex-nowrap`. Le SaveButton est en `shrink-0`.
- **Tout tient sur une ligne à 390 px**, dans tous les états. Les états actifs utilisent donc des libellés courts ; le libellé complet passe en `aria-label`.

| Bouton | Repos | Chargement | Actif |
|---|---|---|---|
| Résumer | icône étincelle + « Résumer » | spinner à la place de l'icône, même libellé, `aria-busy`, clics ignorés | « Masquer », `aria-pressed="true"`, `aria-label="Masquer le résumé"` |
| Traduire | icône A/文 + « Traduire » | spinner, même libellé | « Original », `aria-pressed="true"`, `aria-label="Voir l'original en anglais"` |

- Pendant le chargement, le libellé ne change pas, pour que la barre ne bouge pas. Le texte d'attente est affiché dans l'encart ou dans le bandeau.
- **Desktop (≥ md)** : place suffisante, donc libellés complets : « Résumer » / « Masquer le résumé », « Traduire en français » / « Voir l'original ».
- **Repli possible** (planche « Repli ») si les libellés complets sont préférés sur mobile : le SaveButton seul sur la première ligne, `AiTools` en `w-full` sur la seconde, deux moitiés égales (`flex-1`). La disposition reste stable quel que soit l'état. **La recommandation reste la version sur une ligne.**

## 3. AiTools (outils IA secondaires)

- Groupe « pilule » : `role="group" aria-label="Outils IA"`, `inline-flex items-center rounded-full border border-line bg-surface px-px`. Séparateur vertical de 1 × 22 px `bg-line` entre les deux boutons.
- Bouton : `h-11 px-2.5 rounded-full text-[13.5px] font-medium text-fg-muted gap-1.5 whitespace-nowrap`, icône de 16 px.
- Actif : `bg-accent-soft text-accent font-semibold`.
- Volontairement plus discret que le SaveButton (sans bordure propre, texte atténué, forme ronde contre rectangulaire), mais 44 px de haut pour le toucher.
- **Affichage conditionnel** :
  - pas de clé IA configurée → le groupe n'est **pas rendu** (pas désactivé, absent) ; la barre ne contient que ★ ;
  - article déjà en français (langue détectée `fr`) → Traduire **n'est pas rendu**, Résumer reste seul dans la pilule, sans séparateur.

## 4. AiSummaryPanel

- Cadre `rounded-md border border-line-strong bg-surface overflow-hidden`.
- En-tête `min-h-10 bg-surface-alt border-b border-line` contenant :
  - titre « RÉSUMÉ » (`font-cond text-[12.5px] font-bold uppercase tracking-caps`) ;
  - pastille **« Généré par IA »** (`rounded-full border border-line-strong h-5 px-[7px] text-[11.5px] font-semibold text-fg-muted`, petite étincelle pleine de 11 px) ;
  - bouton ✕ de 44 px à droite (`aria-label="Masquer le résumé"`), qui fait la même chose que « Masquer » dans la barre.
- Corps : liste à puces `text-[15px] leading-[22px]` (3 à 5 points), puis la mention `text-[12.5px] text-fg-muted` « Résumé automatique de l'article ci-dessous, peut contenir des erreurs. »
- **Chargement** : même cadre, en-tête « RÉSUMÉ · Génération… », 3 lignes de squelette (`animate-pulse-soft`, `motion-reduce:animate-none`), `aria-busy="true"`.
- **Erreur** : pas de cadre de résumé. Alerte `role="alert" rounded-md border border-err bg-err-soft text-err` : « **Résumé indisponible.** Le service n'a pas répondu. » avec un bouton « Réessayer » (44 px, `border-err text-err bg-surface`). Le bouton de la barre revient à « Résumer ».
- Mise en cache : un résumé déjà généré se réaffiche instantanément (Masquer / Résumer ne relance pas l'appel).

## 5. Traduction

- Le corps de l'article est **remplacé** par la traduction ; titre et méta ne bougent pas.
- **Chargement** : bandeau en tête de l'article `role="status"` « Traduction en français… » (spinner 13 px, `bg-surface-alt`), corps en squelette (4 lignes).
- **Traduit** : bandeau `bg-accent-soft border-b border-line text-[13px]` « Traduit de l'anglais · **Généré par IA** » avec l'étincelle `fill-accent`. Le corps passe en `lang="fr"`.
- « Original » rétablit le texte d'origine (`lang` d'origine), sans nouvel appel.
- **Erreur de traduction** : même alerte que le résumé (« **Traduction indisponible.** … » + Réessayer), placée sous la barre ; le corps d'origine reste affiché.

## 6. Bandeau de l'article

Le libellé « Mode lecture · extrait de la page d'origine » est **retiré** (le mode lecture est abandonné). Le bandeau du post #1 devient :

`#1` · badge « ARTICLE » · à droite « récupéré le 25 nov. à 09:20 » (`<time dateTime>`, même format que le reste de l'app).

Le lien vers la source reste en fin d'article : domaine en mono, « proxmox.com ↗ », zone cliquable de 44 px.

## 7. Accessibilité

- Contrastes : `text-fg-muted` sur `bg` ≥ 6:1 et `text-accent` sur `accent-soft` ≥ 5,6:1, en clair comme en sombre.
- Boutons à bascule : `aria-pressed` ; chargement : `aria-busy` + texte d'état dans l'encart ou le bandeau.
- Les contenus générés sont toujours étiquetés « Généré par IA », dans l'encart comme dans le bandeau de traduction.
- Focus : après « Résumer », le focus reste sur le bouton ; l'encart est annoncé via son titre (`aria-labelledby`). Après ✕ dans l'encart, le focus revient au bouton Résumer.
- Cibles de 44 px partout ; « Remonter en haut » et les toasts ne sont pas concernés par cette retouche.

## 8. Recette
- [ ] 390 px, EN, enregistré : ★ + Résumer + Traduire sur une seule ligne, sans débordement, en clair et en sombre.
- [ ] Résumer → squelette → encart sous la barre ; « Masquer » ou ✕ referme ; Résumer réaffiche sans nouvel appel.
- [ ] Traduire → bandeau + squelette → texte FR + bandeau « Traduit de l'anglais · Généré par IA » ; « Original » rétablit.
- [ ] Erreur simulée (timeout) : alerte + Réessayer, bouton revenu au repos.
- [ ] Article en français : pas de Traduire. Pas de clé : ★ seul.
- [ ] Plus aucune trace de « Mode lecture » dans la page.
