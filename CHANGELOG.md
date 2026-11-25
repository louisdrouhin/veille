# Changelog

Une version par PR livrée : **mineure** pour une fonctionnalité, **patch** pour un correctif (règle dans
`CLAUDE.md`). Les versions 2.1.0 à 2.11.0 ont été reconstituées a posteriori à partir des PR. Les dates sont
celles de la mise en production.

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
