# Architecture

Internal web app to fill structured forms ("fiches") from versioned templates, export them as PDF
and link PDF annexes. Product spec (French, authoritative): `specification.md`.

## Runtime

```
browser ──HTTPS:${HTTPS_PORT:-8443}──> proxy (Caddy, tls internal, built front in /srv)
                                         │ /api/*
                                         ▼
                                  api (FastAPI/uvicorn :8000, uid 10001, volume annexes)
                                         │ network "back" (internal: true)
                                         ▼
                                  db (PostgreSQL 16, volume pgdata, no published port)
```

- Secrets (`secrets/db_password`, `secrets/secret_key`) are compose secrets mounted at
  `/run/secrets/*`, read by pydantic-settings; never baked into an image or committed.
- Security headers (HSTS, CSP `default-src 'self'`, `frame-ancestors 'none'`, nosniff,
  `Referrer-Policy: no-referrer`) and the SPA fallback live in `Caddyfile`.
- The api container applies Alembic migrations at start (`python -m app.cli migrate`).

## Code layout

- `backend/app/main.py`: app factory, `/api/health`, router registration (every `app/api/*.py`
  router is mounted under `/api`).
- `backend/app/models/`: SQLAlchemy models for every table of spec §8; schema changes only through
  Alembic (`backend/alembic/versions/`, revision ids `<unit>_<slug>`). A test fails if models and
  migrations drift.
- `backend/app/config/reference.py`: the only place that knows the reference format.
- `frontend/src/main.tsx`: TanStack Query + react-router providers; routes in `src/router.tsx`.

## Modules

### U1: Socle (U1)

- Stack: `compose.yaml` (proxy, api, db), works with docker compose and podman-compose.
- Endpoint: `GET /api/health` → `200 {"status": "ok"}` after a `SELECT 1` on the database.
- Router stubs `backend/app/api/{auth,profiles,templates,annexes,forms,journal,admin}.py` export an
  empty `router`, mounted under `/api` (declare full paths inside, e.g. `/profiles`).
- Models: all §8 tables, UUID primary keys (`gen_random_uuid()`), except `activity_log.id`
  (bigint identity) and `sessions.id` (opaque string). `activity_log.profile_id` has no FK so the
  journal survives profile deletion.
- `activity_log` is append-only: a statement trigger rejects every UPDATE and DELETE (TRUNCATE is
  still allowed, the test fixtures use it).
- CLI: `python -m app.cli migrate` works; `install` and `reset-admin-password` are stubs (U2).
- Tests: `scripts/test-backend.sh [cmd]` builds the `test` stage of `backend/Dockerfile` and runs it
  next to a throwaway Postgres 16 (`compose.test.yaml`, unique project name per run, torn down on
  exit). Fixtures in `backend/tests/conftest.py`: schema migrated once per session, all tables
  truncated after each test; `db` (Session) and `client` (TestClient).
- Frontend: React 18 + TS strict, Tailwind v4, shadcn (radix base, nova style, Geist via
  `@fontsource-variable`), oxlint (with jsx-a11y), Vitest + Testing Library, Playwright config in
  `frontend/playwright.config.ts` (suite in `frontend/e2e/`).
- Env vars: `HTTPS_PORT` (8443), `SITE_HOST` (localhost), `API_DEV_PORT` (8000), `VITE_PORT` (5173),
  `VITE_API_TARGET`; api: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `SECRET_KEY`,
  `ANNEXES_DIR` (secrets come from `/run/secrets/<name>` when present).
