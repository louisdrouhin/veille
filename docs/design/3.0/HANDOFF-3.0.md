# Folders 3.0.0 — Ma stack + notifications · passation pour Claude Code

**Ma stack** est un radar de vulnérabilités personnel : je déclare les logiciels que j'utilise (Homelab / Travail) avec leur version, Folders croise ces versions avec les CVE (CERT-FR, NVD, GitHub) et m'alerte quand une faille touche **ma** version. S'y ajoutent les **notifications push**.

Références : canvas « Veille — maquettes », page **3.0 · Ma stack + notifications** (13 planches, mobile d'abord, clair | sombre). Les pages précédentes portent désormais les numéros de version de l'app : 2.5 (sombre + accueil), 2.8 (listes de favoris), 2.11 (barre d'actions).

Contraintes de prod à respecter : en-tête sticky opaque, tirer pour rafraîchir, bouton « Remonter en haut » et toasts en bas à droite. **Rien ne doit les chevaucher** : les actions d'une alerte sont dans le flux de la page, pas dans une barre collée en bas.

---

## 1. Tokens ajoutés (`veille-tokens.css` → 3.0)

À ajouter dans les **trois** blocs (clair, sombre forcé, système en sombre), puis à exposer dans `@theme inline` (`--color-sev-critical`, etc.).

| variable | clair | sombre | usage |
|---|---|---|---|
| `--sev-critical` | #B42318 | #F2877B | fond plein du badge Critique, texte « vulnérable » |
| `--sev-critical-soft` | #FCE8E6 | #351816 | fond du panneau « Ton logiciel », bloc d'accueil |
| `--sev-critical-fg` | #FFFFFF | #1A0B09 | texte sur badge Critique plein |
| `--sev-high` / `-soft` | #A54A0A / #FBEBDD | #F2A465 / #33200F | Haute |
| `--sev-medium` / `-soft` | #7A5F00 / #FAF2D3 | #D8B84C / #2C2510 | Moyenne |
| `--sev-low` / `-soft` | #4F5C68 / #EBEEF1 | #A9B4BE / #22272B | Basse |

- Contrastes vérifiés : chaque couleur ≥ 5:1 sur son `-soft` et sur toutes les surfaces, dans les deux thèmes (détail sur la planche « Gravités, statuts et badges »).
- **Rouge = critique ou erreur, rien d'autre.** `--sev-critical` reprend volontairement les valeurs de `--err`.
- « Exploitée » est une pastille **inversée et neutre** (`bg-fg text-bg`), jamais rouge.

### Composants visuels
- `SeverityBadge` : `inline-flex h-[22px] px-[7px] rounded-sm font-cond text-[11px] font-bold uppercase tracking-[.06em]` + score CVSS en `font-mono`. Critique : `bg-sev-critical text-sev-critical-fg`. Autres : `bg-sev-*-soft text-sev-* border border-sev-*`. **Toujours le mot** (Critique / Haute / Moyenne / Basse) **et le score.**
- `ExploitedBadge` : mêmes dimensions, `bg-fg text-bg`, icône triangle, « Exploitée » (« Exploitée activement » dans le détail).
- `ContextTag` (Homelab / Travail) : `h-[18px] px-[5px] border border-line-strong rounded-sm font-cond text-[10px] font-bold uppercase text-fg-muted`.

---

## 2. Données

```sql
products (
  id, name, vendor,
  cpe_prefix text,          -- ex. cpe:2.3:o:fortinet:fortios
  github_repo text,         -- ex. dani-garcia/vaultwarden (releases + advisories)
  version_scheme text       -- 'semver' | 'debian' | 'vendor' (cf. § 2.2)
)
stack_items (
  id, product_id null,      -- null = ajout « suivi par nom » (sans correspondance automatique)
  custom_name text null,
  version text not null,
  context text check (context in ('homelab','work')),
  created_at, updated_at
)
vulnerabilities (
  id, cve_id, title_fr, summary_fr, cvss numeric, severity, exploited bool,
  published_at, updated_at, fixed_versions text[], affected_ranges jsonb,
  sources jsonb,            -- [{kind:'certfr'|'nvd'|'github'|'vendor', ref, url}]
  topic_id null             -- topic Folders correspondant (même CVE dans le titre ou le corps)
)
alerts (
  id, stack_item_id, vulnerability_id,
  state text check (state in ('new','seen','done','ignored')),
  ignored_reason text null, done_at, created_at,
  unique (stack_item_id, vulnerability_id)
)
push_subscriptions (id, endpoint unique, keys jsonb, user_agent, created_at, last_ok_at)
notification_settings (threshold text default 'high', exploited_always bool default true,
                       quiet_enabled bool default true, quiet_from time default '22:00', quiet_to time default '07:30')
```

### 2.1 Synchronisation (job planifié, toutes les 30 min, plus « tirer pour rafraîchir »)
1. Sources :
   - **CERT-FR** : flux des avis et alertes ;
   - **NVD** : API CVE 2.0, filtrée par CPE de la stack, avec une clé d'API pour le quota ;
   - **GitHub** : Security Advisories et releases (pour « mise à jour dispo »).
   - « Exploitée » : drapeau du catalogue CISA KEV, ou mention d'exploitation dans l'avis CERT-FR.
2. Pour chaque `stack_item`, comparer `version` aux plages affectées : créer l'`alert` (`new`) si la version est touchée ; la passer en `done` (raison « version mise à jour ») si la nouvelle version est hors plage.
3. Résumé et action en français : reprendre l'avis CERT-FR s'il existe, sinon générer le résumé (étiqueté **« Généré par IA »**, comme les résumés de topics).
4. Lier `topic_id` quand un topic Folders contient le même CVE.
5. Échec d'une source : garder les derniers statuts, enregistrer `last_full_check_at`, afficher la bannière d'erreur (§ 6).

### 2.2 Versions
Comparer avec un comparateur **par schéma**, pas une simple comparaison de texte :
- semver (`1.32.0`) ;
- style Debian / OpenSSH (`9.8p1`) ;
- schémas propres à l'éditeur (`8.0 U2`, `2022`).

Une version que le comparateur ne sait pas interpréter n'est jamais déclarée « à jour » en silence : statut « Version non reconnue », à corriger dans l'édition.

---

## 3. Navigation et routes

- **Une seule entrée « Ma stack »**, avec deux onglets : **Alertes** et **Logiciels**.
  - `/stack` redirige vers `/stack/alertes` s'il y a des alertes à traiter, sinon vers `/stack/logiciels`.
  - Détail : `/stack/alertes/[id]`. Filtres d'état : `?etat=a-traiter|traitees|ignorees`.
- **Desktop** : en-tête `Forums · Listes · Ma stack [5] · Admin` + « Mon compte ». Ma stack a une icône bouclier de 15 px.
- **Mobile** :
  - entrée « Ma stack » dans le menu burger (badge « 5 à traiter ») ;
  - **raccourci bouclier dans l'en-tête**, entre le logo et le burger : 44 px, badge en haut à droite, lien vers les alertes.
- **Badge** :
  - compte les alertes `new` + `seen` (non traitées, non ignorées) ;
  - rouge (`sev-critical`) s'il y a au moins une critique, sinon `bar-accent` ;
  - absent à 0 ;
  - `aria-label` du type « Ma stack, 5 alertes à traiter dont 2 critiques ».
- Ouvrir une alerte la passe de `new` à `seen`.

---

## 4. Écrans

### 4.1 Logiciels (`/stack/logiciels`)
- Contrôle segmenté Alertes / Logiciels ; ligne « Vérifié il y a 12 min · CERT-FR, NVD, GitHub » (coche `text-ok`).
- Bouton primaire pleine largeur « Ajouter un logiciel » (mobile, 44 px) ; filtres en pastilles radio Tous / Homelab / Travail, avec compteurs.
- Ligne de 60 px :
  - tuile initiale 34 px ;
  - nom en gras + version en mono ;
  - 2ᵉ ligne : ContextTag + détail (« 1 alerte critique · exploitée », « Mise à jour disponible », « Aucune faille connue ») ;
  - statut à droite :
    - vulnérable : `SeverityBadge` « Vulnérable » de la pire gravité ;
    - mise à jour disponible : chip accent « ↑ 9.2 » ;
    - à jour : chip `ok-soft` « ✓ À jour ».
- Tri : vulnérables (par gravité), puis mises à jour disponibles, puis à jour (alphabétique).
- Desktop : tableau `grid-cols-[34px_minmax(0,1fr)_110px_100px_190px_150px_76px]` avec Modifier / Retirer en boutons icône.

### 4.2 Ajout rapide (feuille mobile ; dialogue desktop)
- **Étape 1** :
  - recherche sur le catalogue `products` (nom, éditeur), surlignage de la correspondance avec `<mark>` (`bg-saved-soft`) ;
  - chaque résultat indique les sources suivies ;
  - un produit déjà dans la stack est grisé, « Déjà dans ta stack · 4.0 ».
  - Lien « Introuvable ? L'ajouter quand même (suivi par nom) ».
- **Étape 2** :
  - champ version en mono 18 px (`inputmode="decimal"`), aide « Dernière version publiée : 9.2 » et chips des versions récentes ;
  - contexte Homelab / Travail ;
  - **contrôle immédiat** (`role="status"`) : « Aucune faille connue pour la 9.1. Mise à jour 9.2 disponible. » ou, à l'inverse, la gravité trouvée ;
  - bouton « Ajouter à ma stack » (48 px).

### 4.3 Édition et retrait
- Feuille : lien vers l'alerte en cours (bandeau `sev-*-soft` + badge) ; version ; contexte ; « Enregistrer » ; « Retirer de ma stack » (texte `text-err`).
- Changer la version recalcule tout de suite : « La 7.4.5 corrige CVE-… : l'alerte passera en traitée à l'enregistrement. »
- Retrait : confirmation « Retirer Nextcloud 30.0.1 de ta stack ? ». Les alertes ouvertes sont archivées ; l'historique reste dans « Traitées ».

### 4.4 Alertes (`/stack/alertes`)
- Filtres : À traiter (défaut) · Traitées · Ignorées.
- Tri « À traiter » : **gravité décroissante, puis date**. Les autres filtres : les plus récentes d'abord.
- Carte d'alerte (toute la carte est un lien) :
  - ligne 1 : SeverityBadge + ExploitedBadge, état à droite (point accent + « Nouvelle » en gras, ou « Vue ») ;
  - ligne 2 : titre (gras si nouvelle) ;
  - ligne 3 : **produit + TA version en mono + ContextTag + « corrigé en X » + date**.
- Traitées et ignorées : titre en `text-fg-read`, coche `ok` pour les traitées, raison pour les ignorées (« ignorée : non exposé »).
- Desktop : liste de 440 px à gauche + détail à droite ; l'élément actif a un fond `accent-soft` et un contour de 2 px accent.

### 4.5 Détail d'une alerte
De haut en bas :
1. « ‹ Alertes ».
2. Badges : gravité + CVSS, exploitée, état.
3. Titre en français (`font-cond`).
4. Ligne CVE (mono) · dates.
5. **Ton logiciel** (cadre `border-sev-*`, en-tête `bg-sev-*-soft`) : produit, contexte, **ta version + « vulnérable »**, chips des versions corrigées (la plus proche de ta branche en `ok-soft`), lien « J'ai mis à jour : changer ma version ».
6. **Résumé** (pastille « Généré par IA » si généré).
7. **Action recommandée** : liste numérotée, source indiquée (« d'après l'avis CERT-FR »).
8. Actions **dans le flux** : primaire « Marquer comme traitée » (48 px), secondaire « Ignorer… » (feuille de raisons : non exposé, pas concerné, autre + champ).
9. **Sources** : le topic Folders correspondant (s'il existe) en premier, avec son icône de dossier, puis CERT-FR, NVD, avis de l'éditeur (↗, nouvel onglet).

Après « Marquer comme traitée » : l'état devient « Traitée aujourd'hui à 11:42 · Rouvrir », toast « Alerte traitée · Annuler » au-dessus du bouton « Remonter en haut » ; le badge de navigation se met à jour.

### 4.6 Accueil
- Bloc **« Ma stack »** **au-dessus des stats** (sous « À la une » si celle-ci est un jour activée).
- Lien de 56 px minimum :
  - tuile bouclier ;
  - surtitre « MA STACK » + SeverityBadge de la pire gravité ;
  - titre « 2 failles critiques à traiter » (ou « 1 faille haute à traiter ») ;
  - sous-ligne produits + versions ;
  - chevron.
- Couleurs : `border-sev-*` + `bg-sev-*-soft` de la pire gravité.
- **Absent** s'il n'y a aucune alerte à traiter, ou si la stack est vide.
- Le reste de l'accueil ne change pas (3 derniers non lus + « + N autres » sur mobile, 8 sur desktop).

---

## 5. Notifications (`/compte/notifications`)

### Réglages
- **Sur cet appareil** :
  - interrupteur « Alertes Ma stack » : `role="switch"`, piste de 51 × 31 dans une cible de 44 px, `aria-labelledby` sur le libellé ;
  - état « Activées sur cet appareil » ;
  - bouton « Envoyer une notification de test ».
- **Ce qui déclenche une notification** :
  - gravité minimale en radios (Critique seulement / **Haute et plus** par défaut / Moyenne et plus / Toutes), chacune avec son badge ;
  - interrupteur « Toujours si la faille est exploitée » (même sous le seuil).
- **Heures calmes** : interrupteur + De / À (`type="time"`, mono). Pendant la plage, les envois sont mis en file et partent **groupés à la fin**. Le badge et la liste restent à jour.

### iOS
- Web Push ne fonctionne que dans l'**app installée** sur l'écran d'accueil (iOS 16.4 ou plus). Détection : `window.matchMedia('(display-mode: standalone)').matches || navigator.standalone`.
- **Dans Safari (non installée)** : encadré `accent-soft` (pas d'erreur rouge) « Installe d'abord Folders sur ton écran d'accueil » avec les 3 étapes (Partager › Sur l'écran d'accueil › rouvrir depuis l'icône) ; interrupteur désactivé, « Indisponible dans Safari ».
- **Refusées dans iOS** (`Notification.permission === 'denied'`) : encadré neutre « Notifications refusées sur cet iPhone » + chemin Réglages iOS › Notifications › Folders.
- La demande de permission se fait **uniquement au clic** sur l'interrupteur (exigence iOS), jamais au chargement.
- **Échec d'abonnement** côté serveur : alerte `err` « Activation impossible… » + Réessayer.

### Envoi
- Web Push standard : clés VAPID, `service worker` → `self.registration.showNotification`.
- Un abonnement par appareil ; nettoyer ceux qui renvoient 404 / 410.
- Contenu :
  - titre : « Critique · FortiOS 7.4.3 » (gravité en **mots**, produit + **ta** version ; pas d'emoji ni de couleur, iOS ne les affiche pas de façon fiable) ;
  - corps : « CVE-2026-XXXX, exploitée. Corrigé en 7.4.5. Touche pour voir l'alerte. » (2 lignes max).
- `tag` = id de l'alerte (une mise à jour remplace la notification au lieu d'en empiler). `data.url` = `/stack/alertes/[id]`.
- Groupé, après les heures calmes : « Ma stack : 3 nouvelles alertes » / « 1 haute, 2 moyennes · OpenSSH 9.8p1, Nextcloud 30.0.1… » → `/stack/alertes`.
- Déclencheur : création d'une alerte (`new`) dont gravité ≥ seuil, **ou** exploitée si l'option est active. Passage en « exploitée » d'une alerte existante = nouvelle notification.

---

## 6. États

| Écran | Vide | Chargement | Erreur |
|---|---|---|---|
| Logiciels | « Ta stack est vide » + bouton « Ajouter un logiciel » (cadre en pointillés) | ligne « Vérification de ta stack… » (spinner) + 4 lignes squelette | bannière `err` « Vérification incomplète. NVD n'a pas répondu. » + « Les statuts datent de la dernière vérification complète, il y a 3 h » + Réessayer ; la liste reste affichée |
| Alertes | « Rien à traiter » (bouclier `ok`) + « Aucune faille connue ne touche tes 14 logiciels. Vérifié il y a 12 min » + lien vers les traitées | squelette de cartes | même bannière |
| Notifications | — | interrupteur `aria-busy` pendant l'abonnement | voir § 5 |

Squelettes : `animate-pulse-soft`, `motion-reduce:animate-none`.

---

## 7. Bas d'écran et accessibilité
- « Remonter en haut » : 48 px en bas à droite (prod). Toasts **au-dessus** (`bottom: safe-area + 76px`). Feuilles ouvertes : bouton et toasts masqués (`inert`), retour dans la feuille.
- `<main>` : `pb-[calc(env(safe-area-inset-bottom)+96px)]`.
- Cibles ≥ 44 px partout ; filtres en `role="radiogroup"` ; interrupteurs `role="switch"` ; alertes de liste avec un `aria-label` complet (« Critique 9.8, exploitée, Nouvelle : FortiOS… »).
- Gravité jamais portée par la couleur seule (mot + score) ; nouvelle = point **et** titre gras **et** libellé.

---

## 8. Recette
- [ ] Ajouter un produit trouvé, puis un produit « suivi par nom » ; versions semver, `9.8p1`, `8.0 U2`.
- [ ] Changer la version d'un logiciel vulnérable vers une version corrigée : alerte passée en traitée, badge mis à jour.
- [ ] Tri des alertes par gravité ; nouvelle → vue à l'ouverture ; traiter → toast + Annuler ; ignorer avec raison.
- [ ] Bloc d'accueil : critique (rouge), haute (orange), absent à 0.
- [ ] Badge : rouge avec une critique, bleu sans, absent à 0 ; desktop et mobile (raccourci bouclier + menu).
- [ ] iPhone installée : permission au clic, notification de test, tap → bon détail ; heures calmes → envoi groupé à la fin ; Safari non installée → explication ; permission refusée → message.
- [ ] Source NVD coupée : bannière d'erreur, anciens statuts conservés.
- [ ] Aucun chevauchement avec « Remonter en haut » ni les toasts ; tirer pour rafraîchir relance la vérification.
- [ ] Clair / sombre : contrastes avec axe.
