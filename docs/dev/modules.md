# Module reference

One section per build unit (U1 to U13), in the order they were merged: endpoints, services, front
modules and their contracts. Written in English, like the code comments. The runtime overview is in
[Architecture](index.md).

## Modules

### U1: Socle

- Stack: `compose.yaml` (proxy, api, db), run with podman-compose.
- Endpoint: `GET /api/health` → `200 {"status": "ok"}` after a `SELECT 1` on the database.
- Router stubs `backend/app/api/{auth,profiles,templates,annexes,forms,journal,admin}.py` export an
  empty `router`, mounted under `/api` (declare full paths inside, e.g. `/profiles`).
- Models: all §8 tables, UUID primary keys (`gen_random_uuid()`), except `activity_log.id`
  (bigint identity) and `sessions.id` (opaque string). `activity_log.profile_id` has no FK so the
  journal survives profile deletion.
- `activity_log` is append-only: a statement trigger rejects every UPDATE and DELETE (TRUNCATE is
  still allowed, the test fixtures use it).
- CLI: `python -m app.cli migrate` works; `install` and `reset-admin-password` are stubs (U2).
- Tests: `scripts/test-backend.sh [cmd]` builds the `test` stage of `backend/Containerfile` and runs it
  next to a throwaway Postgres 16 (`compose.test.yaml`, unique project name per run, torn down on
  exit). Fixtures in `backend/tests/conftest.py`: schema migrated once per session, all tables
  truncated after each test; `db` (Session) and `client` (TestClient).
- Frontend: React 18 + TS strict, Tailwind v4, shadcn (radix base, nova style, Geist via
  `@fontsource-variable`), oxlint (with jsx-a11y), Vitest + Testing Library, Playwright config in
  `frontend/playwright.config.ts` (suite in `frontend/e2e/`).
- Env vars: `HTTP_PORT` (8080), `HTTP_BIND` (127.0.0.1), `API_DEV_PORT` (8000), `VITE_PORT` (5173),
  `VITE_API_TARGET`; api: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `SECRET_KEY`
  (secrets come from `/run/secrets/<name>` when present).

### U2: Comptes, sessions, sécurité d'accès

- Endpoints: `POST /api/auth/login {role: "admin"|"user", password}` → `Me` + cookie `session`
  (`HttpOnly; Secure; SameSite=Strict; Path=/`); 401 bad password, 423 locked (`Retry-After`),
  429 rate limited. `GET /api/auth/me` → `{role, active_profile: {id, display_name, number,
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

### U4: Profils et profil actif

- Endpoints (`api/profiles.py`, logic in `services/profiles.py`, schemas in `schemas/profiles.py`):
  - `GET /api/profiles`: any session; active (non-archived) profiles, sorted by name.
    `?include_archived=true` is admin-only (403 for the user session). Item:
    `{id, display_name, number, color, archived_at}` (`number`: int).
  - `POST /api/profiles` (admin) → 201 `ProfileOut`. `PUT /api/profiles/{id}` (admin, full
    replacement of the three fields) → `ProfileOut`, 404 if unknown. Unknown body fields → 422.
  - `GET /api/profiles/{id}/deletion-impact` (admin) → `{forms_count, will_archive}`.
  - `DELETE /api/profiles/{id}` (admin) → `{forms_count, archived}`. No forms (owned, or named
    as an `author` value in any `forms.data`): hard delete (`archived: false`). Otherwise: `archived_at` set, forms untouched (`archived: true`); deleting an
    archived profile again keeps its first `archived_at`. The profile row is locked
    (`FOR UPDATE`) so a concurrent form insert cannot slip in between count and delete.
  - `POST /api/session/profile {profile_id}` (user only) → `Me` with the new `active_profile`;
    404 unknown, 409 archived (French messages), 403 admin, 422 malformed id.
- Validation (422, French, `detail[].msg`): `display_name` trimmed, 1-100 chars; `number` a JSON integer
  1-999 (« Le numéro doit être un nombre entier de 1 à 999. », also when missing); `color`
  `^#[0-9a-fA-F]{6}$`. Unique among non-archived profiles: partial unique index
  `uq_profiles_number_active` (migration `profile_number`, `CHECK number BETWEEN 1 AND 999`; an
  archived profile keeps its number). A clash is a 409 « Le numéro N est déjà attribué au profil
  Nom. » on create and update, raised from the index at flush time
  (`services/profiles.flush_unique_number`), so concurrent writes are covered too. `python -m
  app.cli install` gives the first profile number 1.
- Sessions pointing at a deleted profile fall back to no profile (FK `SET NULL`); an archived
  active profile is already treated as none by `/auth/me` and `require_active_profile`.
- Activity actions (target `profile`, target_id = profile id):
  - `profile_create` (details: `display_name`, `number`, `color`), `profile_update` (details `before`, `after`),
  - `profile_archive` (details `display_name`, `forms_count`),
  - `profile_delete` (details `display_name`, `forms_count: 0`),
  - `profile_switch` (profile_id = new profile, details `{from, to}`, `from` null when none).
- No env var, no migration.

### U5: Templates API

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

### U3: Design system, app shell, auth UI

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
  `sonner`. Paraphe (the profile number in a ring of the profile color) for every profile display.
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

### U6: Annexes (API)

Annexes are notes (title + rich text) kept in a folder tree. No file is stored: the only state is the database.

- Tables: `annex_folders(id, name, parent_id -> annex_folders ON DELETE CASCADE, created_at)` and
  `annexes(id, title, folder_id -> annex_folders ON DELETE CASCADE (null = root), body_html,
  body_text, created_at, updated_at)`. Migration `annex_notes` (after `profile_number`) drops the
  PDF columns; the cascade in the database is what makes a folder delete recursive.
- Endpoints (`api/annexes.py`; one router serves both prefixes). Reads: both roles. Writes: admin.
  - `GET /annexes/tree` -> `{folders: [{id, name, parent_id}], notes: [{id, title, folder_id,
    excerpt, updated_at}]}`, flat lists sorted by name/title; the client builds the tree.
  - `GET /annexes?q=` -> the same note summaries, `q` = case-insensitive match on title or
    `body_text`. `GET /annexes/{id}` -> summary fields + `body_html`, `created_at`
    (`excerpt` = first 300 characters of `body_text`).
  - `POST /annexes {title, body_html?, folder_id?}`, `PATCH /annexes/{id}` (`title`, `body_html`,
    `folder_id`; an explicit `null` moves to the root), `DELETE /annexes/{id}`: 409
    `{detail, templates}` while the latest version of a template references the note.
  - `POST /annex-folders {name, parent_id?}`, `PATCH /annex-folders/{id}` (`name`, `parent_id`):
    422 when the new parent is the folder itself or one of its descendants.
    `DELETE /annex-folders/{id}` deletes the subtree; 409 with the same `{detail, templates}`
    payload (nothing deleted) when a note of the subtree is referenced.
  - Unknown folder (create, move) -> 404 "Dossier introuvable.". `GET /annexes/tree` and
    `GET /annexes/export.pdf` are declared before `/annexes/{annex_id}`.
- `services/annexes.sanitize(html) -> (html, text)` runs on every write (POST and PATCH) with
  `nh3`: tags `p h1 h2 h3 strong em u s ul ol li blockquote code pre a br hr`, only `href` (on
  `a`; http, https, mailto), `rel="noopener noreferrer"` on links, `<script>`/`<style>` removed
  with their content. `body_text` = the sanitised HTML without tags (block ends become a space),
  entities unescaped, whitespace collapsed. `body_html` is limited to 200 000 characters.
  See [Sécurité](securite.md#annexes-html-assaini).
- `descendants(db, folder_id)` walks all folders in Python; `would_cycle(db, folder_id,
  new_parent_id)` uses it. `referencing_templates(db, annex_ids)` takes a set of ids.
- Journal actions: `annex_created`, `annex_updated`, `annex_deleted`, `annex_folder_created`,
  `annex_folder_updated`, `annex_folder_deleted`.
- Removed: PDF upload and storage, `annexes_dir`, `annex_max_bytes`, `python-multipart`, the
  `annexes` volume; `pypdf` is a dev dependency (tests only). The Caddy body limit is 1 MB.
- Tests: `backend/tests/test_annexes.py`, `test_annexes_export.py`, rows in `test_authz_matrix.py`.

### U9: Journal API et durcissement

- `GET /api/journal?from=&to=&action=&profile_id=&page=&page_size=` (admin; 403 user, 401 anonymous):
  `{items, total, page, page_size}`, newest first (`at DESC, id DESC`). `from`/`to` are `YYYY-MM-DD`
  UTC days, both inclusive. `page` 1..100000, `page_size` 1..200 (default 50), `total` ignores paging.
  Item: `id, at, account_role, profile_id, profile_name (null if none/deleted), action, target_type,
  target_id, details`.
- `GET /api/journal/actions` (admin): distinct `action` values present in the table, sorted. Nothing
  is hard-coded; U9 itself defines no action name.
- Append-only: the router has GET routes only (OpenAPI assertion in `tests/test_journal.py`); the U1
  trigger rejects UPDATE/DELETE (tested). Code: `api/journal.py`, `services/journal.py`,
  `schemas/journal.py`.
- `make backup` (`scripts/backup.sh`): `backups/db-<UTC stamp>.dump` (`pg_dump -Fc`, run in the db
  container), mode 600, temp dir then rename. Annex notes live in the database, so the dump is the whole
  backup. `make restore [YES=--yes] DB=...` (`scripts/restore.sh`): destructive, but validates first:
  the dump must be non-empty and fully readable by `pg_restore` (wrong or truncated file refused with
  exit 2 before anything is stopped). Then confirms (or `--yes`), stops proxy+api and loads the dump in
  ONE transaction (`DROP SCHEMA public CASCADE`, `CREATE SCHEMA`, `pg_restore --no-owner | psql
  --single-transaction`: all or nothing; a failure leaves the database untouched), then the stack
  restarts. Both honor `COMPOSE`. Procedure: [Sauvegarde et restauration](backup-restore.md).
- `make audit` (`scripts/audit.sh`, honors `ENGINE`): builds the api and proxy images, then pip-audit
  (installed with `--target` in a throwaway container, `--path` on the image's site-packages),
  `npm audit --omit=dev`, Trivy (`aquasec/trivy` container, images passed as `podman save` tarballs,
  DB cached in volume `pharmacie-trivy-cache`) on api, proxy and `postgres:16-alpine` (pulled first, so the script is self-contained). Exit 1 on any
  pip-audit/npm finding or Trivy HIGH/CRITICAL; all severities are printed.
- Caddyfile: `request_body { max_size 1MB }` on `/api/*` (JSON bodies only, the largest being a note of
  at most 200 000 characters; over it the proxy answers 413); added COOP/CORP `same-origin` and `Cache-Control: no-store` on `/api/*`; CSP unchanged
  (`default-src 'self'`, `frame-ancestors 'none'`). README: new "Sécurité" section.
- Env vars documented (already read since U2): `SESSION_IDLE_MINUTES`, `LOGIN_RATE_LIMIT`,
  `LOCKOUT_THRESHOLD`, `LOCKOUT_BASE_SECONDS`, `LOCKOUT_MAX_SECONDS`; set them via
  `compose.override.yaml` (compose.yaml does not forward them). CSRF has no switch.
- Audit findings 2026-10-24 (`make audit` exit 1; log `test-results/U9-C4.log`):
  - pip-audit (api deps): 0. `npm audit --omit=dev`: 0.
  - Trivy api (python:3.12-slim, Debian 13.7): OS 178 (CRITICAL 0, HIGH 44, MEDIUM 68, LOW 64,
    UNKNOWN 2; HIGH = util-linux, systemd, ncurses, acl, perl-base, mostly without a fix yet);
    pip's vendored libs 7 (HIGH 4, MEDIUM 2, LOW 1: urllib3 fix 2.8.0, msgpack fix 1.2.1) => bump the
    pinned `pip` in `backend/Containerfile` when a fixed release exists.
  - Trivy proxy (caddy:2.11-alpine): Alpine 1 (HIGH 1: brotli-libs, fix 1.2.1-r0); `usr/bin/caddy` Go
    21 (CRITICAL 0, HIGH 5, MEDIUM 14, LOW 1, UNKNOWN 1: x/net, Go stdlib) => rebuild on a newer caddy tag.
  - Trivy postgres:16-alpine: Alpine OS 0; `gosu` Go binary 61 (CRITICAL 1 stdlib CVE-2025-68121,
    HIGH 25, MEDIUM 31, LOW 3, UNKNOWN 1) => pull a newer postgres:16-alpine.
  - None fixed in this unit (images/dependencies are out of its scope); the gate stays red until the
    base images are bumped.

### U7: Fiches API

- Code: `api/forms.py` (routes), `services/forms.py` (create/update/delete/search), `services/form_validation.py`
  (`clean(db, tree, data) -> (data, errors)`), `services/references.py`, `schemas/forms.py`.
- **`data` format** (contract for U8, U11, U12): `{"<node id>": value}`, keys = node ids of the bound version's tree.
  `text` → string (≤ `max_length`; whitespace-only = empty) · `date` → `"YYYY-MM-DD"` · `author` → profile id
  (any existing profile, archived included) · `radio_group` → option id · `checkbox_group` → list of option ids
  (stored deduplicated, in template order). `category` and `reference` nodes have no key: the reference lives only
  in `forms.reference` (top-level `reference` in responses), `data` never mirrors it.
- Stored data = visible value nodes only (`walk` with "option selected"): hidden conditional children, unknown keys
  and empty values (`null`, `""`, `[]`, any node type) are dropped, never validated. Absent key = empty.
  Required = non-empty. A string with U+0000 or a lone surrogate (unstorable in PostgreSQL) → 422.
- Validation errors: 422 `detail[] = {type, loc: ["body", "data", <node id>], msg: "« Label » : …"}`, all at once.
- Reference: auto when `reference` is null/absent: `reference_counters` row of the current month (key `MM-YYYY`, month read in `Europe/Paris`, so the sequence restarts at
  `001` every month; `allocate`/`preview` take an injectable `now`), atomic
  `INSERT … ON CONFLICT DO UPDATE SET value = value + 1 RETURNING` (row lock until commit), numbers already taken
  are skipped. A user-chosen reference does **not** bump the counter (a typo like `…-999` must not exhaust the
  sequence). Format `MM-YYYY-NNN` (NNN: 3 digits, 4+ without leading zero past 999) checked with `is_valid_reference` (422), unique: 409 « Cette référence est déjà utilisée par
  une autre fiche. » (also on a race, via `uq_forms_reference`).
- Endpoints (writes need `X-CSRF-Token`):
  - `GET /api/forms` (any session) → `{items: [FormSummary], total, page, page_size}`, newest first. Query: `q`
    (reference or any text field, case-insensitive substring), `reference` (substring), `date_from`/`date_to`
    (ISO, inclusive, any date field), `author_id` (any author field), `owner_profile_id`, `template_id`, `page`
    (1-100000, default 1), `page_size` (1-100, default 25); U+0000 in `q`/`reference` → 422.
    Field filters use each form's own version tree.
  - `FormSummary = {id, reference, template_id, template_name, template_version_id, version, owner: {id,
    display_name, number, color, archived}, created_at, updated_at, can_edit}`.
  - `GET /api/forms/next-reference` (any session) → `{reference}`: preview, not reserved (send `null` to get one).
  - `POST /api/forms {template_version_id, reference?, data}` (user + active profile; admin 403) → 201 `FormOut`.
    Owner = active profile. 422 if the version is unknown or its template archived (any version of a live
    template is accepted).
  - `GET /api/forms/{id}` (any session) → `FormOut = FormSummary + {data, schema_json}` (the bound version's tree:
    users cannot read `/api/templates/{id}`). 404 « Fiche introuvable. »
  - `PUT /api/forms/{id} {reference, data}` (full replacement) → `FormOut`; `DELETE /api/forms/{id}` → 204. Both via
    `require_form_owner_or_admin` (row locked `FOR UPDATE`); owner and template version never change.
- `can_edit`: admin always; user only when the active profile owns the form and is not archived. Forms of an
  archived owner are read-only for the user (writes 403 through the deps), the admin can still edit/delete them.
- Activity (target `form`/<form id>): `form_created` (details `reference`, `template`, `version`), `form_updated`
  (`reference`, + `previous_reference` when changed), `form_deleted` (`reference`). Admin rows: role admin,
  profile null. U8 adds `form_export` and the route `GET /api/forms/{id}/pdf`.
- No env var, no migration.

### U11: Éditeur de templates et moteur de rendu

- Zod mirror of the tree: `templates/schema.ts` (`templateTree`, node types, `walk`, `isGroup`), French messages,
  server invariants (unique ids, one reference, trimmed labels). Parity test against `template.schema.json`
  (`schema.test.ts`, tiny JSON Schema validator + the Pydantic-only rules). Reference format: `config/reference.ts`
  (mirror of `backend/app/config/reference.py`: `REFERENCE_RE`, `isValidReference`, `REFERENCE_HINT`, `REFERENCE_EXAMPLE` for the current month).
- **Renderer** (`forms/renderer/index.ts`, for U12): `<FormRenderer tree mode="edit|readonly" defaultValue onSubmit
  onChange errors id headingLevel>{actions}</FormRenderer>`. `FormValue = {reference: string | null, data}` is ready for
  `POST/PUT /api/forms`. No `defaultValue` = new form: date today, author = active profile, reference = `GET
  /forms/next-reference`; an untouched proposal is sent as `null` (server numbers it). `data` is U7's format: visible
  value nodes only, no empty value, checkbox ids in template order. `errors` = node id (or `reference`) -> message;
  build it with `serverFieldErrors(apiError)` (422 `loc ["body","data",id]`, 409 reference); anything else: show
  `error.message`. `id` lets a submit button live outside (`form={id}`). react-hook-form, `mode: onTouched`.
- `visibility.ts` (pure): `visibleNodes`, `cleanData`, `validateData`, `applySelection` (new data + filled fields an
  option change clears; the renderer confirms with an AlertDialog before clearing).
- Profiles query key `['profiles','active']`, next reference `['forms','next-reference']`, annexes `['annexes',…]`.
- **Editor** (admin): `/templates` list (archive, delete with the 409 message), `/templates/nouveau` (name, then the
  editor), `/templates/:id`: dnd-kit tree (drop gaps in the root, categories and option children), properties panel,
  annex picker (`GET /annexes?q=`, « Annexe supprimée » for a dangling id), side-by-side preview (edit / read-only),
  zod errors listed and pinned to nodes, server 422 mapped by `loc` (annex ids too), publish (version n+1), history
  with restore, archive, unsaved-draft guard (`useBlocker` + `beforeunload`). Tree ops in `templates/editor/tree.ts`.
- No env var, no backend change, no new token.
- web-design-guidelines audit (templates/**, forms/renderer/**), fixed:
  1. Drag and drop had to have keyboard paths: dnd-kit KeyboardSensor with French announcements, Monter/Descendre
     buttons per node, « Emplacement » select (moves into any category or option) in the properties panel.
  2. Annex button named by its `<label>` hid its visible text (2.5.3) -> group title instead of `htmlFor`.
  3. Icons carrying meaning (annex, error) used `aria-label` on SVG -> `aria-hidden` + sr-only text.
  4. Node delete had no confirmation; deleting an option with children too -> AlertDialog on both.
  5. Missing hover state on tree rows; option inputs without `name` -> added.
  6. French typography: no-break space before `: ; ? !` in all UI copy.
  7. Shadcn `Button` drops refs under React 18, so `…Trigger asChild` + `Button` lost popover anchoring -> triggers
     styled with `buttonVariants` instead.
  Kept: Publish disabled while the draft equals the latest version (status says « À jour. »); straight apostrophes
  (project convention); preview mode not in the URL. Not fixed (outside scope): React 18 ref warning raised by
  `components/ui/dialog`/`alert-dialog` overlays.

### U10: UI admin (profils, annexes, journal) et choix de profil

- Pages: `profiles/ProfilePickerPage` (`/profil`, cartes-boutons, Entrée/Espace), `profiles/ProfilesPage` (admin CRUD,
  `ProfileFormDialog` = nom, numéro (pré-rempli avec le plus petit numéro libre parmi les profils actifs; 409 affiché sur le champ), pastilles de couleur + `<input type=color>`, aperçu paraphe), `annexes/AnnexesPage`
  (arbre de dossiers et notes, voir « Annexes (front) » plus bas), `admin/JournalPage`.
- `components/ProfileSwitcher`: menu déroulant d'en-tête (radio des profils actifs, chargés à l'ouverture). Changer =
  `POST /api/session/profile` puis `setQueryData(me)` + `invalidateQueries()` (`profiles/api.ts`). Export `Paraphe` inchangé.
- `annexes/AnnexInfo` (signature de U3 conservée): `GET /api/annexes/{id}` (cache 60 s); icône « i » = lien vers
  `/annexes/notes/:id` (`target=_blank rel=noopener`); HoverCard (survol ET focus clavier) avec titre + extrait
  cliquable et le texte « Ouvrir l'annexe »; 404 → « Annexe supprimée » sans lien; erreur réseau: lien seul.
- Suppression de profil: `GET deletion-impact` dans la boîte de dialogue (nombre de fiches, archivage ou suppression).
  Annexe ou dossier: 409 `{detail, templates[]}` affiché dans la boîte (`annexes/api.ts annexRequest`, car `api()` ne
  garde pas le corps 409; même CSRF/401/403).
- Journal: filtres `from`, `to`, `action`, `profile_id`, `page` dans l'URL (`useSearchParams`), pagination serveur (50/page).
  Libellés français des actions connues, code brut sinon. Dates via `Intl.DateTimeFormat('fr-FR')`.
- Durcissement: `admin/validation.ts` refuse U+0000 et les surrogates isolés côté client (recherche, titres, noms) comme le
  serveur (422); 422 serveur affichés sur le champ (`fieldErrors`).
- Gotcha React 18: `Button` shadcn ne transmet pas `ref`, donc `asChild` sur `PopoverTrigger`/`DropdownMenuTrigger` ne se
  positionne pas (contenu à -200 %). Utiliser `<button className={buttonVariants(...)}>`. `ui/calendar.tsx` journalise le même
  avertissement (boutons de jour), sans effet visible ici.
- Tests: `AnnexInfo.test`, `AnnexesPage.test`, `NoteEditorPage.test`, `profiles.test`, `JournalPage.test` (Vitest). Parcours navigateur: Playwright
  (image `mcr.microsoft.com/playwright:v1.64.1-noble`, `--network host`), captures dans `frontend/test-results/U10/`.
- Audit web-design-guidelines (JournalPage, AnnexesPage, AnnexDialogs, AnnexInfo, ProfilesPage, ProfileFormDialog,
  ProfilePickerPage, ProfileSwitcher), corrigé:
  1. Popper sans position (ref perdu sur `Button asChild`) → boutons natifs `buttonVariants`.
  2. Filtres, page du journal et recherche d'annexes absents de l'URL → `useSearchParams`.
  3. Dates formatées à la main (`dd/MM/yyyy`) → `Intl.DateTimeFormat('fr-FR')`.
  4. Pastilles de couleur nommées `#rrggbb` → noms français (Vert, Bleu…) pour les lecteurs d'écran.
  5. Pas de focus sur le premier champ en erreur → `focusFirstInvalid` (par id) dans les deux formulaires.
  6. Espaces insécables manquants avant `:` et dans « » → ajoutés dans le texte visible.
  7. Placeholder sans exemple ni points de suspension → « Par défaut, le nom du fichier… ».
  8. Boutons d'action de ligne `sm` (28 px) → taille normale (32 px) pour la tablette.
  Conservé: confirmations avant suppression, régions `aria-live` polies, `role=alert` sur les erreurs, `aria-invalid` +
  `aria-describedby`, focus visible partout, `tabular-nums` sur dates et nombres. Non corrigé: `transition-all` dans `ui/button`.
- Aucune variable d'environnement, aucune migration, aucun changement backend. `App.test.tsx` (U3) adapté: le sélecteur
  d'en-tête est un bouton, et le test de déconnexion part de `/fiches` (le Journal appelle maintenant l'API).

### Annexes (front)

`frontend/src/annexes/`. Le journal affiche les libellés `annex_created`, `annex_updated`, `annex_deleted`,
`annex_folder_created`, `annex_folder_updated` et `annex_folder_deleted`.

- `api.ts`: types `Folder`, `Note`, `NoteItem`, `Tree`; hooks `useAnnexTree`, `useAnnexSearch`, `useNote`; `indexTree`
  construit l'arbre côté client à partir de la liste plate de `GET /api/annexes/tree` (sous-dossiers puis notes, ordre
  alphabétique `fr`); `annexExportUrl(folderId?)`; `annexRequest` ne sert plus qu'aux DELETE qui renvoient un 409.
- `AnnexesPage` (`/annexes?dossier=<id>&q=<recherche>`): arbre repliable à gauche, contenu du dossier courant avec fil
  d'Ariane à droite (empilés sur mobile), recherche à plat avec le chemin du dossier (la recherche est dans l'URL et
  disparaît quand on change de dossier). « Exporter en PDF » pour les deux rôles; l'admin a en plus « Nouveau dossier »,
  « Nouvelle note », « Renommer », « Déplacer » et « Supprimer ».
- `AnnexDialogs`: `FolderDialog` (créer ou renommer), `MoveDialog` (exclut le dossier déplacé et ses descendants),
  `DeleteDialog` (décompte des notes et sous-dossiers, liste des templates en cas de 409).
- `NotePage` (`/annexes/notes/:id`, les deux rôles): affiche le HTML assaini par le serveur dans un conteneur
  `.note-content` (typographie dans `frontend/src/index.css`, partagée avec l'éditeur). « Modifier » n'apparaît que pour
  l'administrateur.
- `NoteEditorPage` (`/annexes/notes/nouvelle?dossier=<id>` et `/annexes/notes/:id/modifier`, `RequireRole allow="admin"`):
  titre, éditeur Tiptap v3 (StarterKit: gras, italique, souligné, barré, titres 1 à 3, listes, citation, lien) et
  `useUnsavedGuard`. Les liens sont limités à http, https et mailto et ne s'ouvrent pas au clic dans l'éditeur.
- `AnnexPicker` (éditeur de templates) affiche le chemin du dossier sous le titre de chaque note.
- Tests: jsdom ne mesure pas le texte; `frontend/src/test-setup.ts` ajoute les polyfills `getClientRects`,
  `getBoundingClientRect` et `elementFromPoint` que ProseMirror appelle.
- Audit web-design-guidelines (tous les fichiers de `annexes/` et `AnnexPicker`), corrigé:
  1. Recherche absente de l'URL → paramètre `q` (`AnnexesPage`).
  2. Libellés de chargement sans points de suspension → « Chargement des annexes… », « Recherche en cours… ».
  3. Noms de dossier ou titres très longs sans retour à la ligne → `break-words` sur les liens de ligne.
  4. Titre vide dans l'éditeur: pas de focus ni de description de l'erreur → `focusFirstInvalid` + `aria-describedby`.
  Conservé: confirmations avant suppression, régions `aria-live`, `role=alert`, `aria-current` sur l'arbre, focus visible.
  Non corrigé: apostrophes droites (convention du projet), `transition-all` dans les primitives shadcn.

### U8: Export PDF

- Route: `GET /api/forms/{form_id}/pdf` (`api/forms.py`), any authenticated session (every profile reads
  every form, spec §3.1; admin included). 200 `application/pdf`, `Content-Disposition: attachment;
  filename="<reference>.pdf"` (the reference format has no quote or path character). 404 unknown form,
  401 anonymous. No body or query parameter, so no input to harden.
- Activity: `form_export` (target `form`/<form id>, details `reference`), committed with the response.
- Code: `app/pdf/render.py` (`render(db, form: FormOut) -> bytes`), `form.html` (Jinja2, autoescape on),
  `form.css` (inlined into the page).
- Content: header (template name + version, Référence, « Profil propriétaire » = form owner, « Créée le » = creation day in
  Europe/Paris, `dd/mm/yyyy`); each category is a section; each field prints its label and answer(s). Only checked
  options are printed, with their visible children nested (the `data` already holds visible nodes only).
  Unanswered fields print « — ». Author fields print the profile name (« (profil supprimé) » when
  archived). The `reference` node is not printed again (header). Annex ref: « Annexe : <title> », or
  « Annexe supprimée » when the annex no longer exists.
- Footer on every page via `@page`: « Référence : <ref> » (CSS `string-set` on the header reference) and
  « Page X / Y » (`counter(page)` / `counter(pages)`).
- Offline: `LocalFetcher` (a `weasyprint.urls.URLFetcher`) raises for anything that is not a `file://`
  path under `app/pdf/` (http, https, data, other files), so rendering never touches the network.
  Rendering is synchronous in the sync route (threadpool).
- Fonts: system Liberation Sans (then DejaVu Sans), installed by `backend/Containerfile` (`base` stage, so
  also the test stage). No font file is bundled.
- Tests: `backend/tests/test_pdf.py` (pypdf text extraction, 2-page fixture, headers, journal, injection,
  fetcher).
- No env var, no migration, no dependency added (WeasyPrint 70, Jinja2, pypdf were already pinned).
- Annex export: `GET /api/annexes/export.pdf[?folder_id=<uuid>]` (both roles) renders the subtree of the
  chosen folder, or the whole tree without `folder_id` (title « Annexes »). Unknown folder: 404
  « Dossier introuvable. ». Code in `app/pdf/annexes.py` (template `annexes.html`, style `annexes.css`),
  reusing `ENV`, `LocalFetcher` and `PDF_DIR` of `render.py`.
  - Headings: the chosen node is the `h1`; a sub-folder at depth d is an `h(min(d+1,6))`; a note title sits
    one level under its folder; the headings inside the note are shifted by the same amount (cap `h6`) by a
    regex on `<h[1-6]>`, which is safe because nh3 leaves no attribute on them. WeasyPrint turns the
    `h1`-`h6` into PDF bookmarks.
  - Order: sub-folders first, then notes, alphabetical. A sub-tree without any note is left out.
  - The note HTML goes through `|safe`: acceptable because nh3 sanitised it on write and `LocalFetcher`
    refuses every external resource (see [Sécurité](securite.md#annexes-html-assaini)).
  - Tests: `backend/tests/test_annexes_export.py` reads the bookmarks back with pypdf.

### U12: UI Fiches (liste, éditeur, lecture seule, export PDF)

- Pages (`frontend/src/forms/`, noms exportés inchangés pour `router.tsx`): `FormsListPage` (`/fiches`), `FormNewPage`
  (`/fiches/nouvelle`, utilisateur seul), `FormViewPage` (`/fiches/:id`), `FormEditPage` (`/fiches/:id/modifier`).
  Toutes rendent le U11 `FormRenderer` (`@/forms/renderer`, `mode="readonly"` pour la lecture).
- Liste: recherche serveur `q` (référence ou texte d'un champ, debounce 300 ms) + filtres `reference`, `date_from`/`date_to`
  (calendrier shadcn, `fr`), `author_id`, `owner_profile_id`, `template_id`, `page` (≤ 100000), 25 par page. Tout est dans l'URL
  (`useSearchParams`). Texte avec U+0000 ou surrogate isolé: signalé sur le champ, jamais envoyé. Valeurs vides jamais envoyées.
  Listes de profils/templates des filtres: admin = archivés inclus (`include_archived`, `GET /templates`), utilisateur =
  actifs (`GET /profiles`, `GET /templates/available`).
- Propriétaire: `OwnerBadge` = paraphe + nom, « (profil supprimé) » si archivé. « Fiche de *Nom* » + badge « Lecture seule » sur
  la vue quand le profil actif n'est pas le propriétaire (toujours pour l'admin, qui garde Modifier/Supprimer).
- Boutons: Modifier/Supprimer selon `can_edit` renvoyé par le serveur (U7), jamais recalculé côté client. « Nouvelle fiche »
  masqué pour l'admin. Modifier par URL sans droit: redirection vers la vue lecture seule.
- Création: choix du template (`?template=<id>`, `GET /templates/available`), puis `POST /forms {template_version_id, reference, data}`;
  référence proposée par le renderer, renvoyée `null` si intacte. Édition: `PUT /forms/{id} {reference, data}`.
- Erreurs serveur: `serverFieldErrors` (409 référence, 422 par nœud) affichées sur le champ; autre erreur: Alert au-dessus du formulaire.
- Garde de sortie (`useUnsavedGuard`): `useBlocker` (chemin + query) + `beforeunload`; « modifié » = valeur courante ≠ valeur
  de départ (fiche enregistrée, ou date du jour + profil actif pour une nouvelle). Désactivée juste après un enregistrement réussi.
- Suppression: AlertDialog « Supprimer définitivement ». Export: `GET /api/forms/{id}/pdf` en `fetch` (erreurs en toast),
  fichier `<référence>.pdf`. Après écriture, les listes en cache sont retirées (pas de fiche supprimée qui réapparaît).
- Noms accessibles stables pour U13: « Nouvelle fiche » (un seul lien par page), « Modifier », « Supprimer », « Exporter en PDF »,
  « Rechercher », « Enregistrer ». Aucun nouveau token, aucune dépendance, aucun changement backend, aucune variable d'environnement.
- Tests: `forms/forms.test.tsx` (Vitest, 23 cas: propriété, liste/filtres/debounce, garde, 409/422, suppression, export, création).
  Parcours navigateur Playwright (Chromium, dev stack): 31 étapes, captures clair/sombre/tablette dans `frontend/test-results/U12/`.
- Audit web-design-guidelines (forms/**), corrigé:
  1. Boutons-liens via `buttonVariants({className})` non fusionnés (cva sans twMerge) → `cn(...)` (lien « Changer de template », retour, dates).
  2. Déclencheurs de date à bordure `border` trop pâle (contraste 1.4.11) → `border-input`.
  3. Libellés de chargement sans points de suspension → « Chargement… ».
  4. Zone « Modifications non enregistrées » insérée dynamiquement (non annoncée) → région `aria-live` toujours présente.
  5. Placeholder de recherche sans exemple → « Ex. : amoxicilline, 10-2026-042… ».
  6. Deux liens « Nouvelle fiche » (en-tête + état vide) → un seul.
  Conservé: filtres et page dans l'URL, vrais liens, confirmation avant suppression, focus visible, Intl `fr-FR`.
  Non corrigé: avertissement React 18 « refs » du Slot shadcn (connu, hors périmètre).

### U13: E2E Playwright, audit final, déploiement

- `make e2e` → `scripts/e2e.sh`: unique compose project `pharmacie-e2e-<pid>`, `compose.yaml` + a temp override
  that points the two compose secrets at generated files, HTTPS on `HTTPS_PORT` 18443, non-interactive
  `python -m app.cli install` (a second install must fail), then Playwright in
  `mcr.microsoft.com/playwright:v1.64.1-noble` (`--network host --ipc=host --userns=keep-id`). `trap`: `down -v
  --remove-orphans --rmi local` + temp dir removed, also on failure. Passwords come from the script via
  `E2E_ADMIN_PASSWORD`, `E2E_USER_PASSWORD`, `E2E_NEW_USER_PASSWORD`; `E2E_BASE_URL` overrides the target.
- `make smoke` → `scripts/e2e.sh smoke`, port 18444:
  up, `/api/health` 200, install, down. Env read: `COMPOSE`, `ENGINE`, `HTTPS_PORT`.
- Suite: `frontend/e2e/scenario.spec.ts` (serial, 12 tests, admin and user in separate browser contexts). The annex
  part: the admin creates the folder « Protocoles » and the sub-folder « Dilutions », writes a note with bold and
  underlined text in the Tiptap editor, links it in a template; the user hovers the « i » on the fiche, opens the
  note in a new tab (`/annexes/notes/:id`), then fetches the PDF of « Protocoles » and `e2e/pdf.ts` (`pdfHeadings`,
  no dependency: it inflates the object streams and walks the bookmark tree) checks h1 folder, h2 sub-folder, h3 note.
- Not in `make check` (needs podman + the Playwright image); `frontend/e2e` is type-checked by `tsc -b`
  (`tsconfig.node.json` includes it) and linted by `npm run lint`.
- web-design-guidelines audit of the whole `frontend/src` (grep for the anti-patterns + axe-core 4.10 over
  every route, 2 roles, light/dark, 1280 and 820 px, with screenshots): 0 WCAG 2.0/2.1 A/AA violations,
  no horizontal overflow, no console error other than the anonymous `/auth/me` 401. Fixed:
  1. Every screen kept the `index.html` title → `lib/usePageTitle.ts`, called by `PageHeader` and `StatusPage`.
  2. Client-side navigation left focus on the clicked link → `App.tsx` focuses `<main>` on pathname change.
  3. Annex « i » target 20 px → 24 px (`AnnexInfo.tsx`, tablet).
  4. Login top bar outside any landmark (axe `region`) → `<header>`.
  Not fixed: no `prefers-reduced-motion` rule (shadcn/tw-animate transitions are short fades; `index.css` is
  reserved: add `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms
  !important; transition-duration: .01ms !important } }`); `index.html` has no `theme-color` (outside `src`); straight apostrophes (project convention); `transition-all` in shadcn
  `ui/button` (generated primitive); React 18 `ref` warnings from the shadcn Slot (known, no effect).
