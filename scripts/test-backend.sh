#!/usr/bin/env bash
# Runs a command (default: pytest) in the backend test image against a throwaway Postgres 16.
# Concurrency-safe: unique compose project per run, no published port, torn down on exit.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
wt="$(basename "$root" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-')"
export TEST_TAG="$wt"
read -ra compose <<<"${COMPOSE:-podman-compose}"
compose+=(-p "pharmatest-$wt-$$" -f "$root/compose.test.yaml")
trap '"${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true' EXIT
trap 'exit 130' INT TERM
"${compose[@]}" build tests >/dev/null
"${compose[@]}" run --rm tests "$@"
