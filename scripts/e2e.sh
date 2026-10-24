#!/usr/bin/env bash
# Fresh production stack (compose.yaml, Caddy HTTPS) on a unique project, then:
#   scripts/e2e.sh        install + the Playwright §11 scenario (HTTPS_PORT 18443)
#   scripts/e2e.sh smoke  install + health check only, for podman-compose (HTTPS_PORT 18444)
# Env: COMPOSE (default "docker compose"), ENGINE (docker|podman), HTTPS_PORT. Secrets and passwords
# live in a temp dir; the stack, its volumes and its images are removed on exit, also on failure.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mode="${1:-e2e}"
export HTTPS_PORT="${HTTPS_PORT:-$([ "$mode" = smoke ] && echo 18444 || echo 18443)}"
project="pharmacie-$mode-$$"
read -ra compose <<<"${COMPOSE:-docker compose}"
engine="${ENGINE:-docker}"
tmp="$(mktemp -d)"
chmod 755 "$tmp" # the api container (uid 10001) reads the password files
umask 022
rand() { head -c 18 /dev/urandom | base64 | tr -d '/+=\n'; }
for secret in db_password secret_key; do rand >"$tmp/$secret"; done
admin_pw="$(rand)" user_pw="$(rand)" new_user_pw="$(rand)"
printf %s "$admin_pw" >"$tmp/admin"
printf %s "$user_pw" >"$tmp/user"
cat >"$tmp/override.yaml" <<YAML
secrets:
  db_password: { file: $tmp/db_password }
  secret_key: { file: $tmp/secret_key }
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

install=("${compose[@]}" run --rm -v "$tmp:/run/e2e:ro" api python -m app.cli install
  --admin-password-file /run/e2e/admin --user-password-file /run/e2e/user)
"${install[@]}"
if "${install[@]}" >/dev/null 2>&1; then
  echo "un second install aurait dû échouer" >&2
  exit 1
fi
echo "second install refused: ok"
[ "$mode" = smoke ] && exit 0

cd "$root/frontend"
# Playwright image pinned to the @playwright/test version; --network host reaches the published port.
"$engine" run --rm --network host --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e E2E_BASE_URL="$url" -e E2E_ADMIN_PASSWORD="$admin_pw" -e E2E_USER_PASSWORD="$user_pw" \
  -e E2E_NEW_USER_PASSWORD="$new_user_pw" -v "$PWD:/work" -w /work \
  mcr.microsoft.com/playwright:v1.64.1-noble npx playwright test
echo "rapport Playwright : $PWD/playwright-report/index.html"
