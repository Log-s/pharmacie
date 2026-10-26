# Plain HTTP on HTTP_BIND:HTTP_PORT (make up); HTTPS is terminated by nginx in front.
HTTP_PORT ?= 8080
HTTP_BIND ?= 127.0.0.1
# Other host ports: API_DEV_PORT / VITE_PORT (make dev). Runs on rootless podman + podman-compose.
SHELL := /usr/bin/env bash
.SHELLFLAGS := -ec
COMPOSE ?= podman-compose
ENGINE ?= podman
export API_DEV_PORT ?= 8000
export VITE_PORT ?= 5173
DOCS_PORT ?= 8001
DOCS_IMAGE := docker.io/squidfunk/mkdocs-material:9.6.14
DEV_API := $(shell basename "$(CURDIR)" | tr A-Z a-z)-api-dev
BACKEND_CHECK := ruff check . && ruff format --check . && pytest

.PHONY: up down install migrate reset-admin-password backup restore audit test check e2e smoke secrets dev docs docs-serve

secrets: ## create secrets/* if missing
	@scripts/make-secrets.sh

up: secrets ## build and start proxy + api + db
	HTTP_PORT=$(HTTP_PORT) HTTP_BIND=$(HTTP_BIND) $(COMPOSE) up -d --build

down:
	$(COMPOSE) down

install: ## create the admin and user accounts (interactive)
	$(COMPOSE) run --rm api python -m app.cli install

migrate:
	$(COMPOSE) run --rm api python -m app.cli migrate

reset-admin-password: ## new admin password, closes admin sessions (interactive, server only)
	$(COMPOSE) run --rm api python -m app.cli reset-admin-password

backup: ## pg_dump into ./backups/ (stack must be running)
	COMPOSE='$(COMPOSE)' scripts/backup.sh

restore: ## make restore [YES=--yes] DB=backups/db-X.dump (replaces the database)
	COMPOSE='$(COMPOSE)' scripts/restore.sh $(YES) $(DB)

audit: ## pip-audit, npm audit --omit=dev, Trivy on the built images (non-zero when findings)
	ENGINE='$(ENGINE)' scripts/audit.sh

test: ## backend pytest (throwaway Postgres) + frontend vitest
	COMPOSE='$(COMPOSE)' scripts/test-backend.sh pytest
	npm --prefix frontend run test -- --run

check: ## Gate 1: backend ruff + pytest, frontend lint + typecheck + vitest
	COMPOSE='$(COMPOSE)' scripts/test-backend.sh sh -c '$(BACKEND_CHECK)'
	npm --prefix frontend run lint
	npm --prefix frontend run typecheck
	npm --prefix frontend run test -- --run

e2e: ## Playwright §11 scenario on a throwaway production stack (HTTP_PORT 18080)
	COMPOSE='$(COMPOSE)' ENGINE='$(ENGINE)' scripts/e2e.sh

smoke: ## production stack on a throwaway project (HTTP_PORT 18081), health check, install
	COMPOSE='$(COMPOSE)' ENGINE='$(ENGINE)' scripts/e2e.sh smoke

dev: secrets ## db + api (reload, port API_DEV_PORT) + vite dev server (port VITE_PORT, proxies /api)
	$(COMPOSE) run -d --rm --build --name $(DEV_API) -p 127.0.0.1:$(API_DEV_PORT):8000 \
		-v "$(CURDIR)/backend:/app:z" api \
		sh -c 'python -m app.cli migrate && exec uvicorn app.main:app --reload --host 0.0.0.0'
	trap '$(ENGINE) rm -f $(DEV_API) >/dev/null; $(COMPOSE) stop db' EXIT; trap 'exit 130' INT TERM; \
		VITE_API_TARGET=http://127.0.0.1:$(API_DEV_PORT) npm --prefix frontend run dev

docs: ## build the MkDocs site into site/ (strict: broken links fail)
	$(ENGINE) run --rm -v "$(CURDIR):/docs:z" $(DOCS_IMAGE) build --strict

docs-serve: ## live preview of the documentation on http://127.0.0.1:$(DOCS_PORT)
	$(ENGINE) run --rm -it -p 127.0.0.1:$(DOCS_PORT):8000 -v "$(CURDIR):/docs:z" $(DOCS_IMAGE)
