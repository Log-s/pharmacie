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

# Validate both files BEFORE stopping or changing anything (a corrupt or swapped file must not cost data).
tar -tzf "$annexes" > /dev/null 2>&1 || { echo "$annexes n'est pas une archive tar.gz lisible" >&2; exit 2; }
"${compose[@]}" up -d db
until "${compose[@]}" exec -T db pg_isready -h 127.0.0.1 -U pharmacie -d pharmacie -q; do sleep 1; done
# Reading the whole archive to /dev/null catches a wrong format as well as a truncated or corrupt file.
"${compose[@]}" exec -T db pg_restore --no-owner -f /dev/null < "$dump" 2> /dev/null \
  || { echo "$dump n'est pas un dump pg_dump -Fc lisible" >&2; exit 2; }

if [ -z "$yes" ]; then
  [ -t 0 ] || { echo "non interactif : ajoutez --yes pour confirmer" >&2; exit 2; }
  read -r -p "Remplacer la base et les annexes de cette pile ? [oui/N] " answer
  [ "$answer" = "oui" ] || { echo "annulé" >&2; exit 1; }
fi

"${compose[@]}" stop proxy api # nobody writes during the restore
# One transaction: the schema is dropped and rebuilt only if the whole dump loads, else nothing changes.
"${compose[@]}" exec -T db sh -c 'set -o pipefail
  { echo "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"; pg_restore --no-owner -f -; } |
    psql -v ON_ERROR_STOP=1 --single-transaction -q -U pharmacie pharmacie' < "$dump"
# One-off api container (same volume, uid 10001): unpack aside first, then swap the entries, so the
# archive is known good before the current files are touched (the old ones stay in .old until the end).
"${compose[@]}" run --rm --no-deps -T --entrypoint sh api -c 'set -e; cd /data/annexes
  rm -rf .new .old; mkdir .new .old
  tar -xzf - -C .new || { rm -rf .new; exit 1; }
  find . -mindepth 1 -maxdepth 1 ! -name .new ! -name .old -exec mv {} .old/ \;
  find .new -mindepth 1 -maxdepth 1 -exec mv {} . \;
  rm -rf .new .old' < "$annexes"
"${compose[@]}" up -d
echo "restauration terminée"
