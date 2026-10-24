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
