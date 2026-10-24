#!/usr/bin/env bash
# Creates the compose secret files if missing. Never overwrites an existing secret.
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/secrets"
mkdir -p "$dir"
chmod 700 "$dir"
for name in db_password secret_key; do
  if [ ! -s "$dir/$name" ]; then
    # 644: the containers (non-root uids) read the bind-mounted file; the 700 dir keeps host users out.
    (umask 022; od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$dir/$name")
    echo "secrets/$name créé"
  fi
done
