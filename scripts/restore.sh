#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into the stack of the current COMPOSE project.
# DESTRUCTIVE: replaces the database and the annexes volume. Usage:
#   COMPOSE="docker compose" scripts/restore.sh [--yes] backups/db-<stamp>.dump backups/annexes-<stamp>.tar.gz
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
read -ra compose <<< "${COMPOSE:-docker compose}"
yes=""
[ "${1:-}" = "--yes" ] && { yes=1; shift; }
[ $# -eq 2 ] || { echo "usage: $0 [--yes] DB_DUMP ANNEXES_TAR_GZ" >&2; exit 2; }
dump="$(realpath "$1")"; annexes="$(realpath "$2")"
[ -s "$dump" ] && [ -s "$annexes" ] || { echo "fichier de sauvegarde absent ou vide" >&2; exit 2; }
if [ -z "$yes" ]; then
  [ -t 0 ] || { echo "non interactif : ajoutez --yes pour confirmer" >&2; exit 2; }
  read -r -p "Remplacer la base et les annexes de cette pile ? [oui/N] " answer
  [ "$answer" = "oui" ] || { echo "annulé" >&2; exit 1; }
fi

"${compose[@]}" up -d db
"${compose[@]}" stop proxy api # nobody writes during the restore
until "${compose[@]}" exec -T db pg_isready -h 127.0.0.1 -U pharmacie -d pharmacie -q; do sleep 1; done
"${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -q -U pharmacie pharmacie \
  -c 'DROP SCHEMA public CASCADE' -c 'CREATE SCHEMA public'
"${compose[@]}" exec -T db pg_restore --no-owner -U pharmacie -d pharmacie --exit-on-error < "$dump"
# One-off api container (same volume, uid 10001): empty the volume, then unpack.
"${compose[@]}" run --rm --no-deps -T --entrypoint sh api \
  -c 'find /data/annexes -mindepth 1 -delete && tar -xzf - -C /data/annexes' < "$annexes"
"${compose[@]}" up -d
echo "restauration terminée"
