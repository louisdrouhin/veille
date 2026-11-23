#!/bin/sh
# Daily PostgreSQL dump with retention, run by the `backup` service of docker-compose.yml
# (image postgres:17-alpine, so pg_dump matches the server version).
#
#   backup.sh          loop: every BACKUP_CHECK_INTERVAL seconds, dump if one is due
#   backup.sh once     dump now (then apply the retention)
#   backup.sh due      print "yes" / "no"
#
# A dump is due when there is none yet, or when none was made today and it is
# BACKUP_HOUR or later (local time, TZ). Checking periodically instead of
# sleeping until a fixed time survives restarts and catches up a missed day.
# Files: $BACKUP_DIR/veille-YYYY-MM-DD_HHMM.dump (pg_dump custom format, compressed),
# written to a .partial file then renamed: a failed dump never replaces a good one.
# Retention: the BACKUP_KEEP most recent dumps are kept (7 = one week of daily dumps),
# counted on successful dumps only, so failures never delete the last good backups.
# Connection: PGHOST, PGUSER, PGPASSWORD, PGDATABASE.
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_HOUR="${BACKUP_HOUR:-3}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
BACKUP_CHECK_INTERVAL="${BACKUP_CHECK_INTERVAL:-600}"
PREFIX="veille-"

log() { echo "$(date +%Y-%m-%dT%H:%M:%S%z) [backup] $*"; }

list_dumps() { ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E "^${PREFIX}[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}\.dump$" | sort; }

prune() {
  list_dumps | sort -r | tail -n +"$((BACKUP_KEEP + 1))" | while read -r f; do
    rm -f "$BACKUP_DIR/$f" && log "supprimé (rétention : $BACKUP_KEEP) : $f"
  done
}

dump() {
  umask 077
  file="$BACKUP_DIR/${PREFIX}$(date +%Y-%m-%d_%H%M).dump"
  tmp="$file.partial"
  if pg_dump --format=custom --no-owner --file="$tmp"; then
    mv "$tmp" "$file"
    log "sauvegarde OK : $(basename "$file") ($(du -k "$file" | cut -f1) Ko)"
    prune
  else
    rm -f "$tmp"
    log "ERREUR : pg_dump a échoué, nouvel essai dans $BACKUP_CHECK_INTERVAL s"
    return 1
  fi
}

is_due() {
  latest=$(list_dumps | tail -n 1)
  [ -z "$latest" ] && return 0
  case "$latest" in "${PREFIX}$(date +%Y-%m-%d)_"*) return 1 ;; esac
  hour=$(date +%H)
  hour=${hour#0}
  [ "${hour:-0}" -ge "$BACKUP_HOUR" ]
}

case "${1:-loop}" in
  once) dump ;;
  due) if is_due; then echo yes; else echo no; fi ;;
  loop)
    trap 'log "arrêt"; exit 0' TERM INT
    mkdir -p "$BACKUP_DIR"
    log "démarré : dossier $BACKUP_DIR, chaque jour à partir de ${BACKUP_HOUR} h, $BACKUP_KEEP sauvegardes conservées"
    while :; do
      if is_due; then dump || true; fi
      sleep "$BACKUP_CHECK_INTERVAL" &
      wait $!
    done
    ;;
  *)
    echo "usage : backup.sh [loop|once|due]" >&2
    exit 2
    ;;
esac
