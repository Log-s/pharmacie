#!/usr/bin/env bash
# Backs up a running stack into ./backups/: a pg_dump custom-format file and a tar.gz of the
# annexes volume, both stamped with the same UTC time. Usage: COMPOSE=podman-compose scripts/backup.sh
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

# Credentials stay inside the containers: pg_dump runs in db (peer: POSTGRES_USER), tar in api.
"${compose[@]}" exec -T db pg_dump -Fc -U pharmacie pharmacie > "$tmp/db.dump"
"${compose[@]}" exec -T api tar -czf - -C /data/annexes . > "$tmp/annexes.tar.gz"

mv "$tmp/db.dump" "$out/db-$stamp.dump"
mv "$tmp/annexes.tar.gz" "$out/annexes-$stamp.tar.gz"
echo "backups/db-$stamp.dump"
echo "backups/annexes-$stamp.tar.gz"
