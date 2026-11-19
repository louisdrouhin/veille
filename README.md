# Veille

Agrégateur de veille perso (flux RSS / Atom) présenté comme un forum rétro :
chaque article est un topic dans un forum thématique. Voir [SPEC.md](SPEC.md).

**v1** : auth mono-utilisateur, forums, sources RSS, worker, liste des topics,
page topic, lu / non lu, notes perso, administration, Docker Compose.

## Déploiement (Docker Compose)

```sh
cp .env.example .env        # remplir POSTGRES_PASSWORD, BETTER_AUTH_URL, BETTER_AUTH_SECRET
docker compose up -d --build
```

**Premier lancement** : tant qu'aucun compte n'existe, toutes les pages mènent à `/setup` (email, mot de passe
≥ 12 caractères + confirmation). Le compte est créé côté serveur dans une transaction protégée par
`pg_advisory_xact_lock` (un seul setup peut réussir), puis `/setup` renvoie 404 définitivement.
⚠️ Tant que le setup n'est pas fait, n'importe qui atteignant l'app peut le faire : crée le compte **avant**
de l'exposer via le reverse proxy, ou crée-le en ligne de commande :

```sh
docker compose exec app node dist/create-user.js --email moi@example.com --password 'un long mot de passe' --name Moi
# Récupération (mot de passe oublié) : change le mot de passe et ferme toutes les sessions
docker compose exec app node dist/reset-password.js --email moi@example.com --password 'un nouveau mot de passe'
```

- `app` applique les migrations au démarrage puis lance Next (port `APP_PORT`, 3000 par défaut).
- `worker` démarre une fois `app` healthy (donc après les migrations).
- `db` : PostgreSQL 17, données dans le volume `db-data`.
- Healthcheck : `GET /api/health` (200 si la base répond, 503 sinon ; non authentifié, n'expose aucune donnée).
- `create-user` refuse un email déjà pris ; pour changer un mot de passe, utiliser `reset-password`.

Reverse proxy : il doit transmettre l'en-tête `Host` d'origine (ou `X-Forwarded-Host`),
sinon Next refuse les server actions (protection CSRF), et `BETTER_AUTH_URL` doit être l'URL publique exacte.

Sauvegarde : `docker compose exec db pg_dump -U veille veille > veille.sql`.

## Développement

```sh
npm install
cp .env.example .env        # DATABASE_URL pointant sur un Postgres local
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # optionnel
npm run db:migrate
npm run dev                 # puis http://localhost:3000 → /setup au premier lancement
# (ou : npm run create-user -- --email moi@example.com --password 'un long mot de passe')
# récupération : npm run reset-password -- --email moi@example.com --password '…'
npm run worker              # dans un autre terminal
```

**Sans Docker ni Postgres** : `npm run db:dev` lance un Postgres embarqué (PGlite, données dans `.pglite/`) sur
`localhost:5432` ; dans `.env`, `DATABASE_URL=postgres://postgres@localhost:5432/postgres` et
`BETTER_AUTH_URL=http://localhost:3000`. Puis, dans un autre terminal, `npm run db:migrate`, `npm run db:seed`
(base de démo : forums, sources, topics lus / non lus, notes ; compte `demo@veille.local` / `demo-veille-2026`,
refusé si la base n'est pas vide) et `npm run dev`. Pour repartir de zéro : arrêter `db:dev` et supprimer `.pglite/`.

| Script | Rôle |
|---|---|
| `npm test` | Tests (normalisation d'URL, parsing RSS/Atom, récupération sur un Postgres PGlite en mémoire) |
| `npm run test:integration` | Nécessite `npm run build`. Setup de premier lancement (course de 8 setups libérés au même instant ; app réelle en HTTP : redirections vers `/setup`, deux soumissions simultanées, 404 ensuite). Worker réel (`--once`, `FETCH_CONCURRENCY=4`) sur un **vrai PostgreSQL** : 10 sources aux articles partagés (variantes `utm_*`, `fbclid`, `#…`, `/` final), puis deux workers simultanés. Vérifie : aucune erreur, aucun topic en double, favicons stockés. Postgres via testcontainers (Docker requis) ou `TEST_DATABASE_URL` (une base jetable y est créée puis supprimée) |
| `npm run lint` | ESLint (config Next : core-web-vitals + TypeScript, règles React Compiler) |
| `npm run typecheck` | TypeScript strict |
| `npm run db:generate` | Génère une migration après modification de `lib/db/schema.ts` |
| `npm run build` | Build Next standalone + bundles `dist/{worker,migrate,create-user,reset-password}.js` |

## CI

`.github/workflows/ci.yml` (push sur `master`/`main`, pull requests) : un job lint + typecheck + `npm test`,
et en parallèle un job `npm run test:integration` (PostgreSQL 17 lancé par testcontainers, Docker des runners `ubuntu-latest`).

## Design

Direction artistique dans [`DA/`](DA/) : `veille-tokens.css` (copié tel quel dans `app/globals.css`) et `HANDOFF.md`
(composants, responsive, accessibilité). Règle : **aucune couleur en dur** dans les composants, uniquement les classes
de tokens (`bg-surface`, `text-fg-muted`, `border-line`…) — le thème sombre (v3) n'aura qu'à poser `class="dark"` sur `<html>`.
Polices IBM Plex (Sans, Sans Condensed, Mono) auto-hébergées dans `app/fonts/` (sous-ensemble latin, licence SIL OFL 1.1,
fichiers `OFL-*.txt`) et chargées par `next/font/local` : le build ne fait aucun appel réseau pour les polices.

## Fonctionnement

- **Sécurité** : `proxy.ts` ne fait qu'une redirection de confort vers `/login`. Chaque layout/page protégé,
  chaque server action revérifie la session côté serveur (`requireSession()`), cf. CVE-2025-29927.
  Inscription désactivée (`disableSignUp`).
- **Worker** (`worker/index.ts`) : toutes les `FETCH_INTERVAL_MINUTES`, récupère les sources actives et non en pause.
  ETag / If-Modified-Since, timeout 10 s, User-Agent explicite. 3 échecs consécutifs → pause 1 h (`paused_until`),
  erreur visible dans l'admin.
- **Favicons** : téléchargés par le worker (jamais par le navigateur) après chaque récupération si absents ou vieux
  de plus de 7 jours, depuis le site du dernier article (`<link rel="icon">` de la page d'accueil, sinon `/favicon.ico`).
  Seuls PNG, ICO, GIF, JPEG et WebP ≤ 100 Ko sont acceptés (identifiés par leurs octets, SVG refusé). Stockés dans la
  table `source_favicons`, servis par `/api/favicon/[sourceId]` (session requise). Repli sur l'initiale de la source.
- **Anti-SSRF** (favicons uniquement, `lib/net/safe-fetch.ts`) : http/https seulement ; DNS résolu et toute adresse
  privée, loopback, link-local ou réservée refusée (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 100.64/10,
  0/8, multicast, ::1, fc00::/7, fe80::/10, IPv4 mappée…) ; la socket elle-même passe par un `lookup` filtré
  (pas de fenêtre de DNS rebinding) ; redirections suivies à la main, 3 au maximum, revérifiées à chaque saut ;
  limite de 100 Ko appliquée pendant le téléchargement (flux coupé). Les URL des flux, saisies par toi, restent libres.
- **Worker `--once`** : `node dist/worker.js --once` (ou `npm run worker -- --once`) fait un seul cycle puis s'arrête.
- **Dédoublonnage** : `normalized_url` unique (sans `utm_*`, `fbclid`, `gclid`, fragment ; hôte en minuscules ;
  sans `/` final), insertion en `ON CONFLICT DO NOTHING` — le worker et « Récupérer maintenant » peuvent tourner en même temps.
- **Premier import** d'une source (ou après changement d'URL) : les articles arrivent marqués comme lus.
- **Dates** : une date absente, invalide ou dans le futur est remplacée par la date de récupération. Affichage en Europe/Paris.
- **Suppression d'une source** : les topics sont conservés (`source_id` → NULL, auteur « Source supprimée »).
  L'admin propose d'abord de la désactiver.
- **Suppression d'un forum** : refusée tant qu'il contient des sources ou des topics.
- **Notes perso** : incrémentent `reply_count` mais pas `last_activity_at` (le topic ne remonte pas).
  Le calcul « topic chaud » de la v2 ne comptera que les réponses `source` / `comment` (`HOT_REPLY_TYPES`).
