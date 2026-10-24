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

### U2: U2: Comptes, sessions, sécurité d'accès

- Endpoints: `POST /api/auth/login {role: "admin"|"user", password}` → `Me` + cookie `session`
  (`HttpOnly; Secure; SameSite=Strict; Path=/`); 401 bad password, 423 locked (`Retry-After`),
  429 rate limited. `GET /api/auth/me` → `{role, active_profile: {id, display_name, initials,
  color} | null, csrf_token}`. `POST /api/auth/logout` → 204. `POST /api/admin/user-password
  {password}` (admin) → 204, 422 with the French policy message; closes every user session.
- Sessions (`services/sessions.py`): cookie = `secrets.token_urlsafe(32)`, table stores its
  SHA-256; idle expiry sliding on every authenticated request. `create(db, account_id) -> token`,
  `load(db, token) -> (session, role) | None`, `set_active_profile(db, session, profile_id)`
  (caller validates and commits), `delete_for_account(db, account_id)`.
- CSRF: `csrf_token = HMAC(SECRET_KEY, token)`, from `/me` or the login response; send it in
  `X-CSRF-Token` on every POST/PUT/PATCH/DELETE. Checked by `current_auth` (so by every
  `require_*`); login is the only exempt write. A test hits every write route of the OpenAPI
  schema: anonymous → 401, session without token → 403.
- Deps (`app/api/deps.py`): `Db`, `CurrentAuth` (= `Auth(session, role, csrf_token)`),
  `require_admin` / `require_user` → `Auth` (403 otherwise), `require_active_profile` →
  `Profile` (403 if none or archived), `require_form_owner_or_admin(loader)` where
  `loader(db, form_id) -> form | None` (route needs a `{form_id}` path param; 404 missing,
  admin passes, user passes only if `form.owner_profile_id` == active profile), `get_request_ctx`
  → `RequestCtx(account_role, profile_id, ip)` (admin: profile None).
- Journal: `activity.log(db, ctx, action, target_type=None, target_id=None, details=None)` adds
  the row (ip goes into `details`); the caller commits with its write. CLI uses `activity.CLI`.
- Actions: `login_success`, `login_failure` (details.reason `bad_password` | `locked`),
  `account_locked` (details.attempts), `logout`, `password_reset` (target `account`/`user` with
  `via: admin`, or `account`/`admin` with `via: cli`). Auth rows: `account_role` = target role.
- Passwords (`services/passwords.py`): ≥ 12 chars + zxcvbn score ≥ 3 (`check_policy` → French
  message or None), Argon2id (argon2-cffi defaults). `services/auth.set_password` enforces the
  policy, clears the lockout, closes the account's sessions.
- Lockout: from `LOCKOUT_THRESHOLD` (5) consecutive failures, locked `LOCKOUT_BASE_SECONDS` (60)
  doubled per further failure, capped at `LOCKOUT_MAX_SECONDS` (900); attempts while locked are
  refused unchecked. Rate limit: `LOGIN_RATE_LIMIT` (10) logins/min/IP, in process memory
  (single uvicorn worker). `SESSION_IDLE_MINUTES` (30).
- CLI: `install [--admin-password-file F --user-password-file F] [--profile NAME]` refuses an
  installed instance, masked prompts with confirmation otherwise, both accounts (and the optional
  first profile) in one transaction, admin and user passwords must differ.
  `reset-admin-password [--password-file F]` closes admin sessions, logs `via: cli`. No web route
  writes the admin hash (tested).
- Tests: conftest fixtures `accounts`, `make_client(role, profile=None, app=app)`, `admin_client`,
  `user_client`, `login(client, role, password=None)`, `profile_factory(...)`; clients use
  `https://testserver`. Authz matrix: extend `ADMIN_ONLY` in `tests/test_authz_matrix.py`.

### U4: U4: Profils et profil actif

- Endpoints (`api/profiles.py`, logic in `services/profiles.py`, schemas in `schemas/profiles.py`):
  - `GET /api/profiles`: any session; active (non-archived) profiles, sorted by name.
    `?include_archived=true` is admin-only (403 for the user session). Item:
    `{id, display_name, initials, color, archived_at}`.
  - `POST /api/profiles` (admin) → 201 `ProfileOut`. `PUT /api/profiles/{id}` (admin, full
    replacement of the three fields) → `ProfileOut`, 404 if unknown. Unknown body fields → 422.
  - `GET /api/profiles/{id}/deletion-impact` (admin) → `{forms_count, will_archive}`.
  - `DELETE /api/profiles/{id}` (admin) → `{forms_count, archived}`. No forms: hard delete
    (`archived: false`). Forms: `archived_at` set, forms untouched (`archived: true`); deleting an
    archived profile again keeps its first `archived_at`. The profile row is locked
    (`FOR UPDATE`) so a concurrent form insert cannot slip in between count and delete.
  - `POST /api/session/profile {profile_id}` (user only) → `Me` with the new `active_profile`;
    404 unknown, 409 archived (French messages), 403 admin, 422 malformed id.
- Validation (422, French, `detail[].msg`): `display_name` trimmed, 1-100 chars; `initials` trimmed,
  1-3 chars; `color` `^#[0-9a-fA-F]{6}$`.
- Sessions pointing at a deleted profile fall back to no profile (FK `SET NULL`); an archived
  active profile is already treated as none by `/auth/me` and `require_active_profile`.
- Activity actions (target `profile`, target_id = profile id):
  - `profile_create` (details: the three fields), `profile_update` (details `before`, `after`),
  - `profile_archive` (details `display_name`, `forms_count`),
  - `profile_delete` (details `display_name`, `forms_count: 0`),
  - `profile_switch` (profile_id = new profile, details `{from, to}`, `from` null when none).
- No env var, no migration.

### U5: U5: Templates API

- Tree model: `app/schemas/template_schema.py` (`TemplateTree`, node types, `walk`), documented in
  `docs/template-schema.md`; JSON Schema export `frontend/src/templates/template.schema.json`
  (regenerate: `scripts/test-backend.sh python -m app.schemas.template_schema > <that file>`).
- Endpoints (admin unless noted; writes need `X-CSRF-Token`):
  - `GET /api/templates` → `[{id, name, archived_at, latest_version}]` (all, archived included;
    `latest_version` null before the first publish).
  - `GET /api/templates/available` (both accounts) → `[{id, name, version: Version}]`:
    non-archived templates with their latest version. Templates never published are left out.
  - `POST /api/templates {name}` → 201 template.
  - `GET /api/templates/{id}` → template + `versions: [Version]` (ascending).
    `Version = {id, template_id, version, published_at, schema_json}`.
  - `POST /api/templates/{id}/versions` body = the tree `{nodes: [...]}` → 201 Version n+1.
    422 on an invalid tree, or with the missing ids when an `annex_ref.annex_id` does not exist.
  - `POST /api/templates/{id}/versions/{n}/restore` → 201 Version n+1 with version n's tree
    (annexes checked again).
  - `POST /api/templates/{id}/archive` → template (idempotent). No unarchive route.
  - `DELETE /api/templates/{id}` → 204; 409 when any form uses any of its versions (relies on
    `forms.template_version_id ON DELETE RESTRICT`, so it is race-free).
- Versions are immutable: no PUT/PATCH route exists (a test checks the OpenAPI paths). Publish
  locks the template row, so concurrent publishes get consecutive numbers.
- Stored `schema_json` is the validated dump (defaults written out), so restore copies it exactly.
- Activity actions (target `template`/<template id>, details `name`, plus `version`):
  `template_created`, `template_published`, `template_restored` (+ `restored_from`),
  `template_archived`, `template_deleted`.
- For U7: `walk(tree.nodes, is_open)` yields the visible nodes when `is_open(group, option)` says
  whether the option is selected. Ids are unique across nodes and options.
- For U6: annex references are only at `node.annex_ref.annex_id` (never on options).
- No env vars.

### U3: U3: Design system, app shell, auth UI

- Design tokens and conventions: `frontend/DESIGN.md` (« Registre »); tokens are the CSS variables of
  `frontend/src/index.css` (light + `.dark`, toggled by `next-themes`, class on `<html>`, default = system).
  Font: Atkinson Hyperlegible Next via `@fontsource-variable` (no network font).
- Routes (`frontend/src/router.tsx`, French paths): `/connexion` (public); under `RequireAuth` + shell
  (`App.tsx`): `/` → `/fiches`; user only: `/profil` (picker, U10); both roles, user needs an active
  profile (`RequireProfile` → `/profil`): `/fiches`, `/fiches/:formId`, `/fiches/:formId/modifier`,
  `/annexes`; user only: `/fiches/nouvelle` (U12); admin only: `/profils`, `/journal` (U10),
  `/templates`, `/templates/nouveau`, `/templates/:templateId` (U11), `/compte-utilisateur` (U3,
  functional); `*` → 404. Wrong role → "Accès refusé" page (the API refuses too).
- API client `frontend/src/lib/api.ts`: `api<T>(path, {method, json})` on `/api${path}`, same-origin
  cookie, `X-CSRF-Token` (from the cached `/auth/me`) on POST/PUT/PATCH/DELETE, rejects with
  `ApiError {status, message (French, from detail), detail}`; 401 (except login) sets the `me` cache to
  null so the guards show the login page; 403 shows a toast; network failure = status 0.
  Exports the app's `queryClient` (4xx not retried) and `meQueryKey`.
- Session hooks `frontend/src/auth/session.ts`: `useMe()` (`null` = anonymous), `useLogin()`,
  `useLogout()`. After changing the active profile (U10), `queryClient.invalidateQueries()`.
- Shell slots: `components/ProfileSwitcher.tsx` (U10 replaces it, keep the export), `components/nav.ts`
  (links per role), `components/PageHeader.tsx`, `PagePlaceholder.tsx`, `StatusPage.tsx`; toasts via
  `sonner`. Paraphe (initials in a ring of the profile color) for every profile display.
- Compte utilisateur: `POST /api/admin/user-password`; client checks ≥ 12 chars + confirmation, shows
  the live length and the server's zxcvbn verdict (422 message) on the field.
- Dev stack used for browser tests: `compose run` api dev (`-p 127.0.0.1:$API_DEV_PORT:8000`, as
  `make dev`) + vite on `http://localhost:$VITE_PORT` proxying `/api`. Chromium accepts the `Secure`
  session cookie on `http://localhost` (secure context), so no Caddy needed in dev. Playwright: the
  `mcr.microsoft.com/playwright:v1.64.1-noble` image with `--network host`.
- No backend change, no new activity action, no env var.
- web-design-guidelines audit (App, LoginPage, UserAccountPage, components, guards, index.css), fixed:
  1. Selected role toggle barely visible (bg-muted) → menthe fill + croix text + inset ring (`ui/toggle.tsx`).
  2. `color-scheme` missing → set on `:root` / `.dark` (native controls follow the theme).
  3. No focus management on error → password field refocused after a failed login; first invalid
     field focused on Compte utilisateur (by id: shadcn `Input` drops `ref` under React 18).
  4. Inputs without `name` → `name` added (password managers); `autoComplete` current/new-password.
  5. Loading labels in English ("Loading") → French with ellipsis ("Connexion en cours…").
  6. French typography: no-break space before `:`/`;` in UI copy; code sample `translate="no"`.
  7. Mismatch error had no next step → "… ressaisissez la confirmation".
  8. Tablet: `touch-action: manipulation`; header nav wraps to its own scrollable row below `lg`.
  9. Logout crash (shell rendered with `me = null` after the cache clear) → guard + ordered clear.
  Kept as is: skip link, `aria-current` nav, radiogroup role choice (arrow keys), `role=alert`
  errors, contrast AA verified (DESIGN.md). Not fixed: `transition-all` inside shadcn `ui/` primitives.
