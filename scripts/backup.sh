#!/usr/bin/env bash
# Backs up a running stack into ./backups/: a pg_dump custom-format file, stamped with the UTC time.
# Usage: COMPOSE=podman-compose scripts/backup.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
read -ra compose <<< "${COMPOSE:-podman-compose}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$root/backups"
umask 077 # the dump holds personal data (profile names, journal)
mkdir -p "$out"
tmp="$(mktemp -d "$out/.tmp.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# Credentials stay inside the container: pg_dump runs in db (peer: POSTGRES_USER).
"${compose[@]}" exec -T db pg_dump -Fc -U pharmacie pharmacie > "$tmp/db.dump"

mv "$tmp/db.dump" "$out/db-$stamp.dump"
echo "backups/db-$stamp.dump"
