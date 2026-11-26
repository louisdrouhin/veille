# Changelog

Une version par PR livrée : **mineure** pour une fonctionnalité, **patch** pour un correctif (règle dans
`CLAUDE.md`). Les versions 2.1.0 à 2.11.0 ont été reconstituées a posteriori à partir des PR. Les dates sont
celles de la mise en production.

## 3.4.0 — 26/11/2026

- Briefing du matin : chaque matin à l'heure choisie (7:00 par défaut, du lundi au vendredi), une synthèse de ta veille depuis le dernier
  briefing : nouvelles failles de Ma stack (sans IA), sujets repris par plusieurs sources, nouvelles versions de tes
  services, le reste en bref. Elle se lit en 2 à 4 minutes, chaque point mène à son topic.
- Une notification quand il est prêt, même pendant les heures calmes. Le contexte Travail de Ma stack y reste
  toujours générique, et l'aperçu « Discret » ne nomme aucun produit. Pas de notification quand il n'y a rien de neuf.
- Les phrases sont écrites par l'IA à partir des titres et extraits des articles seulement : ni Ma stack ni tes notes
  ne lui sont envoyées. Une phrase qui avance un chiffre absent des articles est écartée.
- Page du briefing avec sommaire, menu contextuel sur desktop, « Marquer ces topics lus » avec « Annuler »,
  historique sur 7 ou 30 jours (gardé 30 jours).
- Bloc « Ton briefing de ce matin » en haut de l'accueil, entrée « Briefing » dans la navigation.
- Réglages dans Mon compte › Notifications : heure, jours, sections, forums de « Mes services », longueur,
  notification, test. Mon compte gagne une sous-navigation (Intégrations y mène à l'administration).
- Accueil : le briefing, puis Ma stack, puis « À la une » ; une faille à traiter passe toujours avant l'actu.
- Correctif : « À la une » ne retient que les sujets repris par au moins deux sources distinctes (plus de
  « 1 sources »).
- Le briefing passe avant l'indexation de fond pour le quota Gemini.

## 3.3.4 — 26/11/2026

- Correctif : quand le modèle principal de Gemini ne répond plus (bloqué chez Google), la traduction et « Demande à ta
  veille » passent aussi sur le modèle de secours au lieu d'échouer en « n'a pas répondu à temps ».
- Chaque demande à l'IA tient dans un temps limité (tentatives et modèle de secours compris) : tu as toujours une
  réponse ou un message clair en moins d'une minute.

## 3.3.3 — 26/11/2026

- Quand le modèle principal de Gemini reste surchargé malgré les nouvelles tentatives, la traduction et « Demande
  à ta veille » passent sur le modèle de secours (Flash-Lite). Le bandeau de traduction ou la carte réponse
  l'indiquent, avec un bouton « Refaire avec le modèle principal ».
- Pas de modèle de secours sur un quota atteint, une clé refusée ou un modèle introuvable.

## 3.3.2 — 26/11/2026

- Correctif : quand le modèle Gemini est surchargé chez Google (« high demand »), la traduction et les questions
  réessaient d'elles-mêmes avant d'abandonner, au lieu d'afficher « Service Gemini injoignable ».
- Messages d'erreur exacts : quota atteint, clé refusée, modèle introuvable, modèle surchargé, erreur réseau.

## 3.3.1 — 26/11/2026

- Correctif : sans limite réglée dans le `.env`, l'indexation et les questions étaient bloquées (limite lue à 0 au
  lieu de 1 000 textes et 50 questions par jour).

## 3.3.0 — 26/11/2026

- **Demande à ta veille** : un seul champ pour chercher et poser des questions, dans l'en-tête (`/` ou Ctrl+K sur
  ordinateur, loupe sur mobile). Entrée cherche des mots-clés ou pose une question selon ce que tu tapes ;
  Ctrl+Entrée fait l'autre.
- **Recherche** : correspondances exactes (sans accents, en français et en anglais, mots surlignés, tes notes
  incluses), puis résultats proches par le sens ; filtres forum, période, source, listes et notes.
- **Questions** : une réponse rédigée uniquement à partir des articles de ta veille, qui arrive au fil de l'eau
  avec un renvoi vers sa source après chaque affirmation (« Arrêter » à tout moment). Sans source, pas de réponse :
  « Rien trouvé dans ta veille ». Période déduite de la question (« ce mois-ci »…) et modifiable ; tes 20 dernières
  questions, effaçables.
- **À la une** : un même sujet repris par plusieurs sources ne fait plus qu'un topic. Les autres sources y sont des
  « reprises » (Sources · N), « Séparer » si ce n'est pas le même sujet ; les sujets les plus repris des 48 dernières
  heures sont à la une sur l'accueil.
- **Sujets proches** en bas de chaque topic ; « Résumer les N sources » pour un topic repris plusieurs fois.
- Tes notes perso et ta stack ne sont jamais envoyées à Gemini.

## 3.2.0 — 25/11/2026

- **Menu contextuel** sur les lignes de topic (forums, accueil, listes), sur ordinateur : clic droit, bouton « ⋯ » au
  survol de la ligne, touche Menu ou Maj+F10. Ouvrir (aussi dans un nouvel onglet), marquer comme lu ou **non lu**,
  enregistrer dans une ou plusieurs listes d'affilée, ouvrir l'article d'origine, copier le lien de l'article ou le
  lien Folders, et retirer de la liste (avec Annuler) sur la page d'une liste.
- Tout s'applique tout de suite, sans recharger la page : la ligne, la ★ et les compteurs « non lus » changent et la
  page reste où elle était.
- Raccourcis sur une ligne sélectionnée au clavier : M, E, O, C, Maj+C, Ctrl+Entrée, Suppr (liste).
- Maj + clic droit garde le menu du navigateur. Rien ne change sur iPhone (appui long d'iOS).

## 3.1.0 — 25/11/2026

- **Administration › Intégrations** : saisis la clé Gemini (et choisis les modèles des résumés et des traductions)
  et la clé NVD depuis l'interface, sans toucher au `.env`. Une clé saisie ici remplace celle du `.env` ; la page
  indique d'où vient chaque clé (« Interface » ou « .env ») et le résultat de son dernier test.
- Clés chiffrées sur le serveur avec une clé maîtresse `SECRETS_KEY` (à ajouter au `.env` : `openssl rand -base64 32`) ;
  sans elle, la page reste en lecture seule. Une clé n'est jamais réaffichée : seulement ses 4 derniers caractères.
- Toute modification demande ton mot de passe, ou le code de double authentification, valable 5 minutes.
- « Tester la clé » vérifie en un appel qu'elle est acceptée (et que les modèles Gemini existent).
- Notifications : « Reprendre les clés du .env » (les appareils restent abonnés) ou « Générer les clés » (tous les
  appareils sont désabonnés, avec avertissement). Un appareil abonné avec d'anciennes clés apparaît désactivé et se
  réabonne d'un toucher.
- Journal des modifications : quelle clé, quand — jamais sa valeur.

## 3.0.0 — 25/11/2026

- **Ma stack** : déclare tes logiciels (Homelab / Travail) et leur version ; Folders les vérifie toutes les 30 min
  auprès du CERT-FR, de NVD et de GitHub, et crée une alerte quand une faille touche ta version. Catalogue de 23
  logiciels courants (Proxmox, Vaultwarden, OpenSSH, FortiOS, Windows Server…), recherche dans le dictionnaire NVD,
  ou suivi par nom ; contrôle immédiat de la version à l'ajout et à la modification.
- **Alertes** triées par gravité, avec la version qui corrige, un résumé et une action recommandée en français (avis
  CERT-FR, ou résumé « Généré par IA »), le topic Folders du même CVE ; « Marquer comme traitée » (avec Annuler),
  « Ignorer » avec une raison (dont le rétroportage par la distribution). Passer à une version corrigée traite
  l'alerte.
- Bloc **Ma stack** sur l'accueil et **badge** dans la navigation (rouge s'il y a une faille critique), raccourci
  bouclier sur mobile ; pages gardées pour la lecture hors ligne.
- **Notifications push** (iPhone compris, dans l'app installée) : gravité minimale, « toujours si exploitée »,
  heures calmes avec envoi groupé à la fin, notifications discrètes sans nom de produit (activées pour le Travail).
  Réglages dans Mon compte › Notifications.

## 2.13.0 — 25/11/2026

- **Releases automatiques** : chaque nouvelle version crée son tag et sa Release GitHub, avec ces notes.
- **Image publiée** sur `ghcr.io/louisdrouhin/veille` (tags `X.Y.Z`, `X.Y`, commit et `latest`), construite par
  la CI, analysée par Trivy et accompagnée de sa provenance et de son SBOM.
- Déploiement par version (`APP_VERSION`) avec `docker compose pull`, et retour arrière en remettant la version
  précédente.
- Image plus légère : sans npm, yarn ni corepack.

## 2.12.0 — 25/11/2026

- **À propos** dans Mon compte : version, commit (lien vers GitHub) et date du build, fixés au moment du build.
- **Nouveautés** : ce journal des versions, consultable dans l'app.

## 2.11.0 — 25/11/2026

- **Barre d'actions** de la page topic : ★ Enregistrer et les outils IA (Résumer, Traduire) sur une seule ligne,
  même sur mobile.
- Encart de résumé « Généré par IA » sous la barre, bandeau « Traduit de l'anglais » en tête de l'article,
  « Réessayer » en cas d'erreur.
- « Récupéré le … » dans l'en-tête du message #1 ; lien vers la source et « Recharger l'article » en fin d'article.
- L'article fait simplement partie de la page topic, sans libellé à part.

## 2.10.1 — 25/11/2026

- Un résumé ou une traduction déjà faits s'affichent sur tous les appareils, sans nouvel appel à Gemini, et dans
  la copie hors ligne.

## 2.10.0 — 25/11/2026

- Traduction qui garde les images, les liens, les tableaux et le code : seul le texte est traduit, par passages.
- Modèle Flash (plus fidèle) pour les traductions ; les articles longs sont traduits en plusieurs fois, jamais
  coupés.
- Résumés plus concrets (versions, CVE, contournements) avec une puce « À retenir » quand il y a une action.
- Les tableaux des articles sont conservés.

## 2.9.0 — 24/11/2026

- **Résumé et traduction par IA** (Gemini, optionnel) : « Résumer » en 3 à 5 puces, « Traduire en français »,
  à la demande, côté serveur et mis en cache.

## 2.8.0 — 24/11/2026

- **Listes de favoris** : ★ Enregistrer un topic dans une ou plusieurs listes colorées, repère ★ dans les
  listes de topics.
- Pages Listes : renommer, recolorer, réordonner, supprimer ; retrait avec « Annuler » ; export Markdown.

## 2.7.0 — 24/11/2026

- Tirer pour rafraîchir dans l'app installée.
- Administration en cartes sur mobile ; retouches de la connexion et des messages.

## 2.6.0 — 24/11/2026

- **Nouvel accueil** : synthèse, sources en erreur et derniers topics non lus (les 3 derniers sur mobile).

## 2.5.0 — 24/11/2026

- **Mode sombre** et nouveaux tokens de design ; choix de l'apparence dans Mon compte.

## 2.4.0 — 24/11/2026

- L'app s'appelle désormais **Folders**.
- Bouton flottant « Remonter en haut » sur mobile.

## 2.3.1 — 23/11/2026

- iPhone : barre d'état opaque, en-tête fixe teinté, icônes d'installation correctes.
- favicon.ico, cache du service worker plus strict.

## 2.3.0 — 23/11/2026

- **Application installable** (PWA) : lecture hors ligne, message de mise à jour, invitation à l'installation.

## 2.2.1 — 23/11/2026

- Les topics ouverts apparaissent comme lus au retour, sans perdre la page ni le défilement.

## 2.2.0 — 23/11/2026

- Bouton « Retour », raccourcis clavier, sauvegardes quotidiennes de la base.

## 2.1.0 — 23/11/2026

- Santé du worker, rotation des journaux, double authentification (TOTP) optionnelle.

## 2.0.0 — 19/11/2026

- L'article complet dans la page topic, depuis le flux ou extrait de la page d'origine.
