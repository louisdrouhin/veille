# Politique de sécurité

## Signaler une vulnérabilité

**N'ouvre pas d'issue publique** pour une faille de sécurité.

Utilise le signalement privé de GitHub : onglet **Security** du dépôt → **Report a vulnerability**
(<https://github.com/louisdrouhin/veille/security/advisories/new>). Le rapport n'est visible que par le mainteneur.

Merci d'indiquer :

- la version ou le commit concerné ;
- la description de la faille et son impact ;
- les étapes pour la reproduire (preuve de concept minimale) ;
- si possible, une piste de correction.

## Suivi

Projet personnel maintenu sur mon temps libre : je m'efforce d'accuser réception sous 7 jours et de publier un
correctif, puis un avis de sécurité (GitHub Security Advisory) crédité si tu le souhaites, une fois la faille corrigée.

## Périmètre

Seule la dernière version de la branche `master` est maintenue. Sont notamment dans le périmètre : contournement de
l'authentification ou du setup de premier lancement, SSRF via le mode lecture, les favicons ou le proxy d'images,
XSS malgré l'assainissement HTML ou la CSP, injection SQL.

Hors périmètre : les déploiements mal configurés (setup laissé ouvert sur Internet, `BETTER_AUTH_SECRET` faible,
absence de HTTPS en amont), le déni de service par volume, et les URL de flux saisies par l'utilisateur authentifié
(volontairement non filtrées).
