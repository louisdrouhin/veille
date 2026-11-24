# CLAUDE.md

Consignes pour Claude Code sur ce dépôt. Les infos propres au serveur de déploiement sont dans `CLAUDE.local.md`
(non versionné). Rien de privé ici : le dépôt est **public**.

## Projet

**Folders** (ex-Veille) : app perso de veille tech présentée comme un forum rétro. Flux RSS/Atom → topics rangés par
forum thématique, mode lecture, notes perso. Mono-utilisateur, auto-hébergée, installée en PWA sur iPhone.

- Next.js 16 (App Router, `proxy.ts` au lieu de `middleware.ts`), React 19, TypeScript strict, Tailwind v4.
  Avant d'écrire du code Next, lire le guide concerné dans `node_modules/next/dist/docs/` (APIs différentes de la
  mémoire d'entraînement ; `AGENTS.md`, régénéré par `next dev`, le rappelle).
- PostgreSQL 17 + Drizzle ORM (migrations versionnées dans `drizzle/`).
- Better Auth (email + mot de passe, inscription désactivée, 2FA TOTP optionnelle). Chaque route API et server
  action revérifie la session (ne pas se reposer sur `proxy.ts`).
- Worker séparé (`worker/`) pour la récupération des flux ; service de sauvegarde (`scripts/backup.sh`).
- Docker Compose : `app`, `worker`, `db`, `backup`.
- Code et identifiants en anglais, interface en français, dates en Europe/Paris.

Pour se remettre à niveau : `README.md`, `docs/SPEC.md`, `docs/design/` (`v1/`, `v2/`, `v3/` : HANDOFF + tokens), `git log --oneline -40`.

## Commandes

`npm run dev` · `npm run db:dev` (PGlite local) · `npm run db:seed` (démo) · `npm run lint` · `npm run typecheck` ·
`npm test` · `npm run test:integration` (testcontainers) · `npm run build`.

## Conventions

- **Commits** : une seule ligne (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `ci:`, `build:`), sans corps ni
  co-auteur.
- **Flux** : branche → PR → CI verte (y compris CodeQL) → merge en squash → suppression de la branche →
  déploiement → vérification de `/api/health`.
- **master est protégé** (historique linéaire, conversations résolues). CodeQL publie ses alertes en fils de revue :
  un merge « BLOCKED » avec CI verte = fil CodeQL non résolu. Corriger le code, jamais `--admin`.
- **UI** : quand l'interface change, tester dans Chrome (desktop + mobile) sur un build de prod avant la PR.
- **Lockfile** : jamais `npm audit fix` ni `npm install --package-lock-only` (ils suppriment les champs `libc` et
  cassent l'image Alpine). Vérifier le diff de `package-lock.json` à chaque ajout de paquet.
- **docker-compose.yml** : `name: veille` ne doit **jamais** changer (sinon nouveau volume, base vide). Idem pour
  les volumes et identifiants internes `veille`.
- **Liens vers `/t/…`** : toujours `prefetch={false}`, sinon des topics passent en lu sans être ouverts
  (`tests/topic-links-prefetch.test.ts` le vérifie).
- **Windows / Git Bash** : les arguments commençant par `/` sont convertis en chemins ; utiliser
  `MSYS_NO_PATHCONV=1` ou PowerShell. `tests/backup-script.test.ts` est instable sous Windows quand toute la suite
  tourne : le relancer seul avant de conclure.
- **Rien de privé dans le dépôt** (IP, domaine, chemins ou comptes du serveur, secrets) : en cas de doute, lancer
  `gitleaks`.
- Design : tokens uniquement (`docs/design/v3/veille-tokens.css`, fusionnés dans `app/globals.css`), aucune couleur
  en dur. Mode sombre par `data-theme` sur `<html>` (cookie `folders-theme`), jamais de script inline (CSP).
