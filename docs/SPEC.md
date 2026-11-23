# Veille — page de veille façon forum (usage perso)

## Objectif
Une application web perso, auto-hébergée sur mon homelab Proxmox, qui agrège mes sources de veille (flux RSS d'abord) et les affiche **comme un forum à l'ancienne, façon JVC 18-25** : chaque article est un **topic** dans un **forum** thématique (ex. Sécu/CVE, DevOps, Proxmox/homelab, Actu tech).

Un seul utilisateur (moi). Pas de multi-tenant, pas d'inscription publique, pas d'abonnement.

## Stack
- **Next.js 16** (App Router, TypeScript strict). Attention : `middleware.ts` s'appelle désormais `proxy.ts`.
- **PostgreSQL** + **Drizzle ORM** (migrations versionnées).
- **Better Auth** (email + mot de passe).
- **Tailwind CSS**.
- **Worker séparé** (process Node dans le même repo, dossier `worker/`) pour la récupération des flux. Parsing avec `rss-parser`.
- **Docker Compose** : services `app`, `worker`, `db`.
- Code et identifiants en anglais, interface en français, dates affichées en Europe/Paris.

## Authentification
- Better Auth, `emailAndPassword` activé, `disableSignUp: true`.
- Compte unique créé par un script : `npm run create-user -- --email ... --password ...`.
- Les pages protégées sont sous `app/(protected)/`. Le `layout.tsx` de ce groupe vérifie la session avec `auth.api.getSession({ headers: await headers() })` et redirige vers `/login` s'il n'y en a pas.
- **Ne pas se reposer uniquement sur `proxy.ts`** (cf. CVE-2025-29927). Chaque route API et chaque server action revérifie la session.
- Page `/login` simple, bouton de déconnexion dans le header.

## Modèle de données
- `forums` : id, name, slug (unique), position.
- `sources` : id, forum_id, type (`rss` pour la v1), name, url (unique), enabled, etag, last_modified, last_fetched_at, last_error, consecutive_failures.
- `topics` : id, forum_id, source_id, title, url, normalized_url (**unique**), excerpt, published_at, last_activity_at, reply_count, read_at (nullable), score (0 par défaut).
- `replies` : id, topic_id, type (`note` | `source` | `comment`), author, content, url (nullable), created_at.
- Plus les tables générées par Better Auth.

## Worker de récupération
- Toutes les 15 min (configurable par variable d'environnement), récupère chaque source active.
- Utilise ETag / If-Modified-Since, timeout de 10 s, User-Agent explicite.
- Après 3 échecs consécutifs, la source est mise en pause 1 h. L'erreur est stockée dans `last_error` et visible dans l'UI.
- **Normalisation des URL** : retirer `utm_*`, `fbclid`, `gclid` et le fragment `#…`, mettre l'hôte en minuscules, retirer le `/` final. C'est la clé de dédoublonnage.
- Nouvel article avec une `normalized_url` inconnue : création d'un topic (extrait = résumé du flux, nettoyé du HTML, ~500 caractères).
- **(v2)** URL déjà connue, venant d'une autre source : on ne crée pas de topic, on ajoute une `reply` de type `source`, on incrémente `reply_count` et on met à jour `last_activity_at`.

## Interface (v1)
### Accueil `/`
La liste des forums, avec pour chacun le nombre de topics non lus.

### Liste des topics `/f/[slug]`
Un tableau dense, style forum classique :

| Icône | Sujet | Auteur | Nb | Dernier msg |
|---|---|---|---|---|

- Icône : dossier jaune pour un topic normal, grisé s'il est lu. **(v2)** Dossier rouge si le topic est « chaud » (`reply_count` ≥ seuil ou score élevé).
- Auteur = nom de la source.
- Tri par `last_activity_at` décroissant, pagination de 25.
- Topic lu : titre grisé. Bouton « Tout marquer comme lu ».
- Inspiration visuelle forum rétro, mais **design original** : pas de logo, d'assets ni de nom JVC.

### Page topic `/t/[id]`
- Premier message : titre, source, date, lien « Lire l'article » (nouvel onglet).
- **(v2) Mode lecture** : l'article complet (contenu du flux, sinon extrait de la page avec Readability), en HTML
  assaini côté serveur, images servies par `/api/image-proxy`. En cas d'échec : « Article non disponible en mode
  lecture », l'extrait et le lien d'origine. Bouton « Recharger l'article ». Cache `article_contents`, purge à 90 jours.
  CSP stricte (`img-src 'self'`).
- Les réponses en dessous (notes perso, et en v2 les autres sources et commentaires).
- Formulaire pour ajouter une **note perso** (= une reply de type `note`).
- Ouvrir le topic le marque comme lu.

### Administration `/admin`
- CRUD des forums (nom, ordre).
- CRUD des sources (nom, URL, forum, actif/inactif), avec le statut de la dernière récupération et l'erreur éventuelle.
- Bouton « Récupérer maintenant » par source.

## Feuille de route
- **v1** : auth, forums, sources RSS, worker, liste des topics, page topic, lu/non lu, notes perso, admin, Docker Compose.
- **v2** : mode lecture (fait), fusion des doublons multi-sources, dossier rouge, sources Reddit (`/r/x.json`), Hacker News (API officielle), releases GitHub (`/releases.atom`), YouTube et Mastodon (RSS), récupération des commentaires HN/Reddit comme réponses.
- **v3** : recherche plein texte (Postgres `tsvector`), raccourcis clavier, mode sombre.

## Déploiement
- `Dockerfile` (build Next `standalone`), `docker-compose.yml` (app, worker, db avec volume persistant), `.env.example` documenté.
- L'app tourne derrière mon reverse proxy existant (HTTPS géré en amont). Prévoir `BETTER_AUTH_URL` et `BETTER_AUTH_SECRET` en variables d'environnement.
- Endpoint `/api/health` pour la supervision (base + fraîcheur du worker, 503 au-delà de 3 intervalles sans cycle) ;
  `/api/health/app` (base seule) pour le healthcheck Docker.

## Consignes de travail
1. Commence par me proposer un plan et l'arborescence avant de coder.
2. Implémente **uniquement la v1**, étape par étape (setup + DB → auth → worker → UI → admin → Docker).
3. Tests unitaires au minimum pour la normalisation des URL et le parsing des flux.
4. Si un point de cette spec est ambigu, demande-moi plutôt que de deviner.
