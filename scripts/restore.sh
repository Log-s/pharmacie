#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into the stack of the current COMPOSE project.
# DESTRUCTIVE: replaces the database. Usage:
#   COMPOSE=podman-compose scripts/restore.sh [--yes] backups/db-<stamp>.dump
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
read -ra compose <<< "${COMPOSE:-podman-compose}"
yes=""
[ "${1:-}" = "--yes" ] && { yes=1; shift; }
[ $# -eq 1 ] || { echo "usage: $0 [--yes] DB_DUMP" >&2; exit 2; }
dump="$(realpath "$1")"
[ -s "$dump" ] || { echo "fichier de sauvegarde absent ou vide" >&2; exit 2; }

# Validate the dump BEFORE stopping anything (a corrupt or wrong file must not cost data).
"${compose[@]}" up -d db
until "${compose[@]}" exec -T db pg_isready -h 127.0.0.1 -U pharmacie -d pharmacie -q; do sleep 1; done
# Reading the whole dump to /dev/null catches a wrong format as well as a truncated or corrupt file.
"${compose[@]}" exec -T db pg_restore --no-owner -f /dev/null < "$dump" 2> /dev/null \
  || { echo "$dump n'est pas un dump pg_dump -Fc lisible" >&2; exit 2; }

if [ -z "$yes" ]; then
  [ -t 0 ] || { echo "non interactif : ajoutez --yes pour confirmer" >&2; exit 2; }
  read -r -p "Remplacer la base de cette pile ? [oui/N] " answer
  [ "$answer" = "oui" ] || { echo "annulé" >&2; exit 1; }
fi

"${compose[@]}" stop proxy api # nobody writes during the restore
# One transaction: the schema is dropped and rebuilt only if the whole dump loads, else nothing changes.
"${compose[@]}" exec -T db sh -c 'set -o pipefail
  { echo "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"; pg_restore --no-owner -f -; } |
    psql -v ON_ERROR_STOP=1 --single-transaction -q -U pharmacie pharmacie' < "$dump" \
  || { echo "chargement de la base refusé : base inchangée, pile arrêtée" >&2; exit 1; }
"${compose[@]}" up -d
echo "restauration terminée"
