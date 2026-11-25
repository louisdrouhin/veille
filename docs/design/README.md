# Notes de design

Chaque lot de design est une note de passation (`HANDOFF`) pour Claude Code, avec les tokens quand ils changent.
Les dossiers historiques gardent leur nom (`v1` à `v3.1`) ; les suivants portent **la version de l'app** qui les
livre (voir `CHANGELOG.md`).

## Correspondance

| Dossier | Version de l'app | Contenu |
|---|---|---|
| `v1/` | 1.x | Base : direction artistique « forum rétro », tokens d'origine |
| `v2/` | 2.5 – 2.6 | Mode sombre et tokens v2 (2.5), nouvel accueil (2.6) |
| `v3/` | 2.8 | Listes de favoris (11 tokens ajoutés) |
| `v3.1/` | 2.11 | Barre d'actions de la page topic (sans nouveau token) |
| `3.0/` | 3.0 | Ma stack (radar de vulnérabilités) et notifications push ; tokens `--sev-*` |

## Règle pour la suite

- Une note par lot : `docs/design/<version>/HANDOFF-<version>.md`, où `<version>` est la version de l'app qui la
  livre, sans le patch (ex. `docs/design/3.0/HANDOFF-3.0.md`, puis `3.1/`…).
- Les tokens (`veille-tokens.css`) sont copiés dans le dossier du lot seulement s'ils changent. Les tokens de
  référence sont ceux du dossier le plus récent qui en contient : aujourd'hui `v3/veille-tokens.css`, fusionnés dans
  `app/globals.css`.
- Ne pas renommer les dossiers existants : des tests lisent `docs/design/v3/`.
