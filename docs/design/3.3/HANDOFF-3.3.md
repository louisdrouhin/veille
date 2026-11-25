# HANDOFF 3.3 — « Demande à ta veille »

Folders 3.3. Maquettes : page « 3.3 · Demande à ta veille » du canvas, en clair et en sombre, mobile (PWA iPhone) puis desktop.

Principe : chaque article est indexé par son sens (embeddings). Ça débloque quatre choses :
1. **À la une** : fusion des doublons, un seul topic par sujet.
2. **Recherche** : correspondances exactes + résultats proches par le sens.
3. **Questions à ta veille** : réponse rédigée à partir des articles de l'utilisateur uniquement, avec renvois `[n]`.
4. **Sujets proches** en bas de la page topic.

**Un seul ajout de tokens** (§ 8) : `--mark-bg` / `--mark-fg` pour le surlignage. Tout le reste réutilise les tokens 3.0 et les composants existants :
- encart « Généré par IA » de la 2.11 ;
- étiquettes `.ctx` ;
- en-têtes de section `bar-2` ;
- `fchip` pour les filtres ;
- toasts et menu contextuel desktop (3.1/3.2).

Rappel : le mode lecture est abandonné. Rien dans ce lot n'y fait référence.

---

## 0. Ce qui ne change pas (prod)

- **En-tête sticky opaque.** Il garde le raccourci bouclier Ma stack sur toutes les nouvelles pages (résultats, réponse). Sur mobile, la loupe s'ajoute **à gauche** du bouclier : loupe · bouclier · menu, 3 × 44 px.
- **Tirer pour rafraîchir** : actif sur l'accueil, le topic et les résultats. Inactif sur l'écran de saisie et pendant la rédaction d'une réponse.
- **Bouton « remonter en haut » et toasts en bas à droite.**
  - Aucune nouvelle UI n'est collée en bas d'écran.
  - La feuille Filtres rend le bouton remonter `inert` et masqué, comme la feuille ★.
  - L'écran de saisie mobile (clavier ouvert) masque aussi ce bouton.
- **Barre d'actions du topic** (★ Enregistrer, Résumer, Traduire) : inchangée. Sur un topic fusionné, Résumer porte sur **toutes les sources**. Le libellé desktop devient « Résumer les 5 sources ». Sur mobile, il reste « Résumer » faute de place, et l'encart indique « Résumé de 5 sources ».
- **Menu contextuel desktop** : il s'applique aussi aux lignes de résultats de recherche et de « Sujets proches ». Mêmes composants de ligne.

## 1. Indexation

À trancher côté implémentation. Ce sont des propositions : je ne connais pas ta base actuelle.

- **Table `article_embeddings`** : `article_id`, `model`, `dim`, `vector`, `indexed_at`.
  - Texte indexé : titre + chapô / premiers ~512 tokens de l'article récupéré.
  - Si Postgres : `pgvector` + index HNSW.
- **Modèle** : il doit être multilingue, car le corpus mêle français et anglais, et une question en français doit retrouver un article en anglais. Il peut tourner en local (par exemple via Ollama) pour rester self-hosted. Garder `model` dans la table pour pouvoir réindexer.
- **Recherche exacte** : plein texte avec `unaccent`, configurations FR et EN. Elle couvre aussi le texte des notes personnelles.
- **Rattrapage de l'existant** : job de fond avec progression exposée (`indexed / total`). Pendant qu'il tourne :
  - recherche exacte complète ;
  - résultats sémantiques partiels ;
  - bandeau « Indexation en cours : 62 % » (planche « Recherche : chargement, indexation, vide, erreur »).
- **Nouveaux articles** : indexés à la récupération, avant le calcul de fusion (§ 2).

## 2. À la une et fusion des doublons

**Fusion** (planche « Topic fusionné »)
- À l'arrivée d'un article, on cherche le topic le plus proche **parmi ceux des 72 dernières heures**.
- Si la similarité dépasse un seuil (à calibrer, **réglable dans Admin**), l'article devient une **réponse** du topic au lieu d'un nouveau topic.
- Le topic garde le **titre et l'article #1 de la première source arrivée**. Pas de réordonnancement : stable, prévisible, fidèle à la métaphore forum.
- Chaque reprise s'affiche comme un message `#n` :
  - en-tête « Repris par **Le Monde Informatique ↗** » avec la pile, l'heure et le bouton ⋯ ;
  - dans le corps, le titre d'origine de cette source, un extrait de 2 à 3 lignes et une étiquette `EN` si la langue n'est pas le français.
- Comme sur un forum, une nouvelle reprise incrémente « Nb », remonte le topic et le repasse **non lu**.
- **Bloc « Sources · N »** sous la barre d'actions sur mobile, colonne droite sticky (300 px) sur desktop. Une ligne par source :
  - initiales ou favicon, nom, `#n`, date ;
  - lien d'ancre vers le message ;
  - bouton ↗ vers l'article d'origine (nouvel onglet, `noopener noreferrer`).
  - Note en pied : « Regroupés automatiquement… Pas le même sujet ? « Séparer » dans le menu ⋯ du message. »
- **Séparer** (menu ⋯ d'une reprise) :
  - crée un topic autonome avec cet article ;
  - mémorise la paire « ne pas refusionner » ;
  - affiche le toast « Séparé du topic · Annuler ».
  - Mêmes actions dans ce menu : Séparer de ce topic, Ouvrir l'article d'origine, Copier le lien.

**À la une** (planches « À la une sur l'accueil » et « Desktop — accueil »)
- **Contenu** : topics avec **2 sources ou plus** et une activité dans les **48 dernières heures**. Tri : nombre de sources, puis activité la plus récente.
- **Nombre affiché** : mobile 3 lignes + « + N autres sujets à la une » ; desktop 4 cartes.
- **Bloc vide** : pas d'état vide visible, le bloc est **masqué** (comme prévu en 2.5).
- **Pas de doublon** : un topic à la une est exclu de « Derniers non lus ».
- **Carte desktop** : forum + heure, titre sur 3 lignes max (gras si non lu), pile de sources + « 5 sources ». Bordure haute 3 px `--hot` à partir de 5 sources, `--accent` en dessous.
- **Ligne mobile** : titre, pile, « N sources », forum, heure. Cible ≥ 44 px.
- **aria-label** des cartes et lignes : « {titre}, repris par N sources : {noms} ».

## 3. Recherche

**Un seul champ pour rechercher et demander.** La règle est au § 5, la planche « Tokens, composants » la résume.

**Entrées**
- **Mobile** : loupe dans l'en-tête. Elle ouvre un écran de saisie plein écran :
  - champ dans la barre, focus et clavier ouverts, bouton « Annuler » ;
  - l'en-tête normal revient sur la page de résultats.
- **Desktop** : champ de 300 px dans l'en-tête, entre la navigation et « Mon compte ».
  - Raccourci `/`, ou `Ctrl+K` / `⌘K`.
  - Au focus, il s'élargit à 420 px et ouvre une liste déroulante de 560 px.
- **Champ vide** :
  - Suggestions : 3 questions générées à partir des forums suivis et de Ma stack ;
  - Recherches récentes (puces) ;
  - Tes dernières questions (horloge + date, « Effacer »).
- **Pendant la saisie** :
  - 1ʳᵉ ligne = action d'Entrée (fond `--accent-soft` sur mobile, `--surface-hover` + liseré accent sur desktop) ;
  - 2ᵉ ligne = l'autre action ;
  - puis Topics (3 titres surlignés) et Forums.
  - Debounce 150 ms. Les suggestions de titres ne viennent que de la recherche exacte, pour la rapidité.

**Page de résultats** (`/recherche?q=…&forum=…&periode=…&source=…&liste=…&notes=1`)
- **Ordre des blocs** :
  1. champ prérempli ;
  2. filtres ;
  3. carte « Demander à ta veille » (bordure accent, `Ctrl ↵` sur desktop) ;
  4. **Correspondances exactes · N** ;
  5. **Proches par le sens · N** (« même sujet, autres mots »).
- Un résultat n'apparaît que dans une section : l'exact l'emporte.
- **Ligne** :
  - titre (gras si non lu, ★ si enregistré) ;
  - extrait de 2 lignes ;
  - forum `.ctx`, source, date.
  - Les termes sont surlignés avec `<mark class="mk">` dans le titre et l'extrait, à partir d'offsets ou de `ts_headline` fournis par le serveur.
  - **Pas de surlignage** dans les résultats sémantiques : il n'y a rien à surligner, le titre est en 600 pour qu'ils ne paraissent pas « lus ».
- **Résultat issu d'une note** : icône note, méta « Ta note · date », extrait de la note entre guillemets.
- **Pagination** : 5 par section, puis « Voir N autres résultats… ».
- **Filtres** (combinables, reflétés dans l'URL) :

| Filtre | Mobile (puces + feuille) | Desktop (colonne gauche 230 px) |
|---|---|---|
| Forum | puces multi-sélection | cases + compteurs |
| Période | segmenté 24 h · 7 j · 30 j · 1 an · Tout | radios |
| Source | ligne → sélecteur avec recherche | liste déroulante |
| Mes listes | puces avec pastille de couleur | cases avec pastille |
| Mes notes | interrupteur « Inclure mes notes » (activé par défaut) | interrupteur |

- La puce « Filtres » affiche le nombre de filtres actifs. Une puce active montre sa valeur (« Période : 30 jours »).
- Feuille mobile : « Réinitialiser » + bouton « Afficher N résultats » (compteur mis à jour en direct).

**États**
- **Chargement** : skeletons après 150 ms + « Recherche dans 3 112 articles… ».
- **Indexation en cours** : bandeau `--warn-soft`. Les résultats exacts s'affichent quand même.
- **Aucun résultat** : rappel de la requête et du filtre actif, puis « Chercher sur toute la période » et « ✦ Demander à ta veille ».
- **Erreur** : encart `--err-soft` + « Réessayer ».

## 4. Questions à ta veille

Route : `/demander?q=…&periode=…&forum=…`, ou `/recherche?mode=ask`. Au choix, mais l'URL doit être partageable.

**Pipeline**
1. **Interprétation de la portée** : une période explicite dans la question (« ce mois-ci », « cette semaine », « depuis lundi ») devient un filtre. Il est **affiché** sous la question en puces modifiables : « Dans [Novembre 2026 ▾] [Tous les forums ▾] ». Modifier une puce relance la question.
2. **Récupération hybride** (exact + sens) dans la portée, top ~12 extraits.
3. **Rédaction par le modèle**, avec des consignes strictes :
   - en français ;
   - **uniquement** à partir des extraits fournis ;
   - un renvoi `[n]` après chaque affirmation ;
   - si les extraits ne suffisent pas, le dire.
4. **Contrôle côté serveur** :
   - supprimer les renvois qui ne correspondent à aucun extrait ;
   - si la réponse n'a plus aucun renvoi valide, afficher l'état **« Rien trouvé dans ta veille »** au lieu du texte.
5. **Streaming** : les **sources s'affichent d'abord** (« 7 articles trouvés dans ta veille ✓ »), puis le texte arrive avec un curseur. Bouton « Arrêter » via `AbortController`.

**Affichage** (planches « Réponse de ta veille »)
- **Carte « Réponse de ta veille »** :
  - en-tête `surface-alt` + puce **« Généré par IA »** ;
  - texte 15/23 px mobile, 15,5/25 px desktop (72ch max) ;
  - pied : « Rédigé uniquement à partir de N articles de ta veille. Vérifie l'essentiel dans les sources. » ;
  - boutons Copier (avec les sources en notes de bas de page), Utile, Pas utile (44 px mobile, 36 px desktop).
- **Renvois `[n]`** :
  - bouton `.cite` de 20 px de haut, zone de clic étendue à 44 px par un pseudo-élément, sans décaler l'interlignage ;
  - au clic : défilement jusqu'à la source n°n, qui se surligne en `--accent-soft`, et le renvoi passe en état actif (`.cite.on`). Démo en Play sur les deux planches.
- **Liste « Sources · N »** : pastille numérotée, titre du topic, forum, source(s), date. Elle mène au topic Folders, pas à l'article externe.
- **« Aussi dans ta veille · N »** : 2 ou 3 résultats de recherche (surlignage des seuls mots-clés de la question) + « Voir les N résultats de recherche ».
- **Desktop** : colonne droite avec « Tes dernières questions » et « Suggestions ». Bouton « Redemander » dans le champ.
- **Une question = une réponse.** Pas de fil de discussion en 3.3. On repose une question depuis le champ.

**États**
- **Rédaction en cours** : étapes, texte partiel, sources déjà listées, « Arrêter ».
- **Rien trouvé** :
  - message explicite (« Aucun article de tes 42 sources ne parle de … depuis le … ») ;
  - rappel : « sans source, pas de réponse » ;
  - actions : Chercher sur toute la période · Rechercher « mot-clé » · Ajouter une source (lien Admin).
  - **Jamais** de réponse issue des connaissances générales du modèle.
- **Erreur IA** : encart erreur + « Réessayer ». **Les articles trouvés restent affichés** dessous : la recherche fonctionne même si le modèle est indisponible.

**Historique et cache**
- Les 20 dernières questions par utilisateur, effaçables (« Effacer », ou suppression d'une seule question).
- Réponses mises en cache par (question normalisée, portée, version de l'index), quelques heures. Une nouvelle reprise d'article dans la portée invalide le cache.

## 5. Règle du champ unique

Planche « Tokens, composants, règle du champ unique ».

| Saisie | Entrée | Autre action (2ᵉ ligne, `Ctrl+Entrée`) |
|---|---|---|
| mots-clés (`proxmox backup`) | Rechercher | Demander |
| se termine par `?` | **Demander** | Rechercher ces mots |
| commence par un interrogatif (qu'est-ce, quel·le·s, comment, pourquoi, quand, combien, est-ce, résume, quoi de neuf…) | **Demander** | Rechercher |
| entre guillemets | Rechercher (exact) | Demander |

- **Rien n'est envoyé au modèle sans geste explicite** : Entrée sur « Demander », clic sur la ligne ou sur la carte « Demander à ta veille ». Pas de génération automatique sur la page de résultats.
- Mobile : la touche Entrée du clavier affiche le libellé de l'action (`enterkeyhint="search"` ou `"send"`, libellés « Rechercher » / « Demander »).
- Icône du champ : loupe en mode recherche, ✦ en mode question.

## 6. Sujets proches (page topic)

- En bas de la page, après le dernier message, avant le pied. Mobile : 3 lignes, comme « Derniers non lus ». Desktop : tableau dans la colonne principale.
- **Sélection** :
  - topics les plus proches du topic courant, avec le vecteur moyen des sources pour un topic fusionné ;
  - sur **toute la veille**, toutes dates ;
  - exclut le topic courant et ses reprises ;
  - au-dessus d'un seuil de similarité.
  - Si aucun ne passe le seuil, **le bloc est masqué**.
- État lu / non lu respecté. Menu contextuel desktop actif.

## 7. Accessibilité

- **Champ** : `role="search"` sur le conteneur, pattern **combobox** (`aria-expanded`, `aria-controls`, `aria-activedescendant`), liste `role="listbox"` et options `role="option"`. Les en-têtes de groupe (« Topics », « Forums ») sont en `role="presentation"`.
- **Clavier desktop** :
  - `/` ou `Ctrl+K` : focus ;
  - `↑` / `↓` : parcourir ;
  - `Entrée` : action par défaut ;
  - `Ctrl+Entrée` : l'autre action ;
  - `Échap` : fermer la liste, puis vider le champ.
- **Annonces** (`aria-live="polite"`) : nombre de résultats (« 13 résultats »). Pendant la rédaction, seulement « Réponse prête » ou « Réponse interrompue », pas le texte au fil de l'eau. La carte réponse a `aria-busy="true"` pendant le streaming.
- **Renvois** : `aria-label="Source 2 : {titre}"`, et `aria-describedby` vers la ligne source.
- **Surlignage** : `<mark>` natif, pas d'annonce supplémentaire.
- **Contrastes** vérifiés AA :
  - `--mark-fg` sur `--mark-bg` : 14,2:1 en clair, 8,3:1 en sombre ;
  - `--text-muted` sur `--mark-bg` (clair) : 5,7:1 ;
  - `--accent` sur `--accent-soft` (renvois) : 6,3:1 et 5,6:1 ;
  - `--bar-muted` sur `--bar-2` (champ desktop au repos) : 5,6:1 et 5,7:1.
- **Mobile** : toutes les cibles ≥ 44 px. Les puces de 36 px ont une zone de clic étendue verticalement ; les renvois sont aussi accessibles par la liste des sources (lignes ≥ 48 px).
- `prefers-reduced-motion` : pas de curseur clignotant ni de défilement animé vers les sources.

## 8. Tokens

```css
.v-light, [data-theme="light"] { --mark-bg: #FCE7A2; --mark-fg: #1B1A17; }
.v-dark,  [data-theme="dark"]  { --mark-bg: #5A4710; --mark-fg: #FFF6DE; }
mark.mk { background: var(--mark-bg); color: var(--mark-fg); border-radius: 2px; padding: 0 1px; }
```

Avec Tailwind v4 `@theme inline` : `--color-mark: var(--mark-bg); --color-mark-fg: var(--mark-fg);`.

Le surlignage est un aplat jaune pâle dans le texte, distinct de l'étoile `--saved`, qui est une icône.

## 9. Checklist de recette

- [ ] Article reçu sur un sujet déjà présent depuis moins de 72 h : il devient « Repris par … » dans le topic existant, qui remonte et repasse non lu.
- [ ] « Séparer » une reprise : nouveau topic, pas de refusion ensuite, Annuler fonctionne.
- [ ] À la une : masqué à 0 ; 3 lignes + « +N » sur mobile ; 4 cartes sur desktop ; pas de doublon avec « Derniers non lus ».
- [ ] Loupe mobile : écran de saisie, clavier ouvert, bouton remonter masqué ; « Annuler » revient à la page d'avant.
- [ ] `/` et `Ctrl+K` sur desktop ; navigation aux flèches ; `Entrée` et `Ctrl+Entrée` selon la règle du § 5.
- [ ] Résultats : exact et sens séparés sans doublon ; surlignage seulement sur l'exact ; notes incluses quand l'interrupteur est activé.
- [ ] Filtres dans l'URL ; feuille mobile avec compteur en direct ; « Réinitialiser ».
- [ ] Indexation partielle : bandeau visible, résultats exacts complets.
- [ ] Question : portée affichée et modifiable ; sources avant le texte ; « Arrêter » ; chaque affirmation a un renvoi valide.
- [ ] Question hors veille : « Rien trouvé », aucune réponse inventée.
- [ ] Modèle coupé : erreur + articles trouvés toujours listés.
- [ ] Historique : la question apparaît, « Effacer » vide la liste.
- [ ] Sujets proches : masqué sous le seuil ; lu / non lu respecté.
- [ ] Rien ne recouvre le bouton remonter ni les toasts ; le bouclier Ma stack reste dans l'en-tête partout.
- [ ] Clair, sombre et système conformes aux maquettes.
