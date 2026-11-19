# Veille

Agrégateur de veille perso (flux RSS / Atom) présenté comme un forum rétro :
chaque article est un topic dans un forum thématique. Voir [SPEC.md](SPEC.md).

**v1** : auth mono-utilisateur, forums, sources RSS, worker, liste des topics,
page topic, lu / non lu, notes perso, administration, Docker Compose.

## Déploiement (Docker Compose)

```sh
cp .env.example .env        # remplir POSTGRES_PASSWORD, BETTER_AUTH_URL, BETTER_AUTH_SECRET
docker compose up -d --build
docker compose exec app node dist/create-user.js --email moi@example.com --password 'un long mot de passe' --name Moi
```

- `app` applique les migrations au démarrage puis lance Next (port `APP_PORT`, 3000 par défaut).
- `worker` démarre une fois `app` healthy (donc après les migrations).
- `db` : PostgreSQL 17, données dans le volume `db-data`.
- Healthcheck : `GET /api/health` (200 si la base répond, 503 sinon ; non authentifié, n'expose aucune donnée).
- Relancer `create-user` avec le même email réinitialise le mot de passe.

Reverse proxy : il doit transmettre l'en-tête `Host` d'origine (ou `X-Forwarded-Host`),
sinon Next refuse les server actions (protection CSRF), et `BETTER_AUTH_URL` doit être l'URL publique exacte.

Sauvegarde : `docker compose exec db pg_dump -U veille veille > veille.sql`.

## Développement

```sh
npm install
cp .env.example .env        # DATABASE_URL pointant sur un Postgres local
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db   # optionnel
npm run db:migrate
npm run create-user -- --email moi@example.com --password 'un long mot de passe'
npm run dev                 # app sur http://localhost:3000
npm run worker              # dans un autre terminal
```

| Script | Rôle |
|---|---|
| `npm test` | Tests (normalisation d'URL, parsing RSS/Atom, récupération sur un Postgres PGlite en mémoire) |
| `npm run typecheck` | TypeScript strict |
| `npm run db:generate` | Génère une migration après modification de `lib/db/schema.ts` |
| `npm run build` | Build Next standalone + bundles `dist/{worker,migrate,create-user}.js` |

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
- **Dédoublonnage** : `normalized_url` unique (sans `utm_*`, `fbclid`, `gclid`, fragment ; hôte en minuscules ;
  sans `/` final), insertion en `ON CONFLICT DO NOTHING` — le worker et « Récupérer maintenant » peuvent tourner en même temps.
- **Premier import** d'une source (ou après changement d'URL) : les articles arrivent marqués comme lus.
- **Dates** : une date absente, invalide ou dans le futur est remplacée par la date de récupération. Affichage en Europe/Paris.
- **Suppression d'une source** : les topics sont conservés (`source_id` → NULL, auteur « Source supprimée »).
  L'admin propose d'abord de la désactiver.
- **Suppression d'un forum** : refusée tant qu'il contient des sources ou des topics.
- **Notes perso** : incrémentent `reply_count` mais pas `last_activity_at` (le topic ne remonte pas).
  Le calcul « topic chaud » de la v2 ne comptera que les réponses `source` / `comment` (`HOT_REPLY_TYPES`).
