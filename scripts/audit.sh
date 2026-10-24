#!/usr/bin/env bash
# Dependency and image audit. Runs every check even if one fails; exits 1 if any reports findings
# (pip-audit/npm audit: any vulnerability; Trivy: HIGH or CRITICAL, lower ones are still printed).
# Usage: ENGINE=docker scripts/audit.sh   (ENGINE=podman works too)
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
engine="${ENGINE:-docker}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=()

run() { # run NAME CMD...
  local name="$1"; shift
  echo "=== $name"
  "$@" || { echo "--- $name: exit $?"; fail+=("$name"); }
}

api=pharmacie-audit-api proxy=pharmacie-audit-proxy
$engine build -q -t "$api" --target runtime backend >/dev/null || exit 1
$engine build -q -t "$proxy" -f frontend/Dockerfile . >/dev/null || exit 1

# pip-audit lives in a throwaway container layer (--target keeps the audited env untouched).
run "pip-audit (image api)" $engine run --rm --user 0 --entrypoint sh "$api" -c \
  'pip install -q --target /tmp/pa pip-audit && PYTHONPATH=/tmp/pa python -m pip_audit --path "$(python -c "import site;print(site.getsitepackages()[0])")"'

run "npm audit --omit=dev (frontend)" npm audit --omit=dev --prefix frontend

trivy() { # trivy IMAGE [extra trivy args]: scan a saved tarball, DB cached in a named volume
  local image="$1"; shift
  $engine save -o "$tmp/img.tar" "$image" || return 1
  $engine run --rm -v pharmacie-trivy-cache:/root/.cache -v "$tmp/img.tar:/img.tar:ro" \
    aquasec/trivy:latest image --input /img.tar --scanners vuln --quiet "$@"
}
for image in "$api" "$proxy" postgres:16-alpine; do
  echo "=== Trivy $image (all severities)"
  trivy "$image" --table-mode detailed || echo "--- Trivy scan error on $image"
  run "Trivy $image (HIGH/CRITICAL gate)" trivy "$image" --quiet --severity HIGH,CRITICAL --exit-code 1 --output /dev/null
done

echo
if [ ${#fail[@]} -gt 0 ]; then
  printf 'AUDIT: findings or errors in: %s\n' "$(IFS=';'; echo "${fail[*]}")"
  exit 1
fi
echo "AUDIT: clean"
