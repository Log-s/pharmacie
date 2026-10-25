#!/usr/bin/env bash
# Fresh production stack (compose.yaml, Caddy HTTPS) on a unique project, then:
#   scripts/e2e.sh        install + the Playwright §11 scenario (HTTPS_PORT 18443)
#   scripts/e2e.sh smoke  install + health check only (HTTPS_PORT 18444)
# Env: COMPOSE (default podman-compose), ENGINE (default podman), HTTPS_PORT. Secrets and passwords
# live in a private temp dir; the stack, its volumes and its images are removed on exit, also on failure.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:-e2e}"
export HTTPS_PORT="${HTTPS_PORT:-$([ "$mode" = smoke ] && echo 18444 || echo 18443)}"
project="pharmacie-$mode-$$"
read -ra compose <<<"${COMPOSE:-podman-compose}"
engine="${ENGINE:-podman}"
tmp="$(mktemp -d)" # mode 700: only this user can reach the files below
umask 022          # the files themselves are bind-mounted one by one and read by uid 10001, so 644
rand() { head -c 18 /dev/urandom | base64 | tr -d '/+=\n'; }
for secret in db_password secret_key admin_password user_password; do rand >"$tmp/$secret"; done
# The passwords reach the Playwright container by name (`-e VAR`), never as a value on a command line.
E2E_ADMIN_PASSWORD="$(<"$tmp/admin_password")"
E2E_USER_PASSWORD="$(<"$tmp/user_password")"
E2E_NEW_USER_PASSWORD="$(rand)"
export E2E_ADMIN_PASSWORD E2E_USER_PASSWORD E2E_NEW_USER_PASSWORD
export HTTPS_BIND=127.0.0.1 # throwaway proxy: loopback only
cat >"$tmp/override.yaml" <<YAML
services:
  api:
    secrets: [admin_password, user_password]
secrets:
  db_password: { file: $tmp/db_password }
  secret_key: { file: $tmp/secret_key }
  admin_password: { file: $tmp/admin_password }
  user_password: { file: $tmp/user_password }
YAML
compose+=(-p "$project" -f "$root/compose.yaml" -f "$tmp/override.yaml")

cleanup() {
  "${compose[@]}" down -v --remove-orphans --rmi local >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

"${compose[@]}" up -d --build
url="https://localhost:$HTTPS_PORT"
for _ in $(seq 120); do
  curl -ksf "$url/api/health" >/dev/null && break
  sleep 1
done
curl -ksf -w ' -> HTTP %{http_code}\n' "$url/api/health"

install=("${compose[@]}" run --rm api python -m app.cli install
  --admin-password-file /run/secrets/admin_password --user-password-file /run/secrets/user_password)
"${install[@]}"
if "${install[@]}" >/dev/null 2>&1; then
  echo "un second install aurait dû échouer" >&2
  exit 1
fi
echo "second install refused: ok"
[ "$mode" = smoke ] && exit 0

cd "$root/frontend"
# Playwright image pinned to the @playwright/test version; --network host reaches the published port.
# keep-id: the container runs as the host user, so the report written to /work stays owned by you.
"$engine" run --rm --network host --ipc=host --userns=keep-id -e HOME=/tmp \
  -e E2E_BASE_URL="$url" -e E2E_ADMIN_PASSWORD -e E2E_USER_PASSWORD -e E2E_NEW_USER_PASSWORD -v "$PWD:/work:z" -w /work \
  mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test
echo "rapport Playwright : $PWD/playwright-report/index.html"
