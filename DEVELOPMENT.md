# Development

## Tests
```bash
cd backend
python -m pytest           # API behaviour tests (SQLite, throwaway DB per test)
```
Tests live in `backend/tests/`. They spin up the FastAPI app against a temp SQLite
file, recreate tables + seed lookups per test, and exercise the API via TestClient.

## Database migrations (Alembic)
Schema is versioned in `backend/alembic/versions/`. The ORM models in
`backend/app/db.py` are the source of truth; Alembic diffs against them.

Everyday flow after changing a model:
```bash
cd backend
alembic revision --autogenerate -m "describe the change"   # review the generated file!
alembic upgrade head                                        # apply to the configured DB
```
The DB URL comes from the app settings (`DATABASE_URL` or `PG*` env), so:
- **Local SQLite:** nothing to set — uses `ams_local.db`.
- **Lakebase:** set `PGHOST/PGPORT/PGDATABASE/PGUSER/PGSSLMODE` + `PGPASSWORD` (OAuth
  token, as in `scripts/seed-lakebase.ps1`) then `alembic upgrade head`.

A DB that already has the schema (pre-Alembic) is marked current without re-running:
```bash
alembic stamp head
```
(The local dev DB and Lakebase were stamped at the `baseline schema` revision.)

> New environments should use `alembic upgrade head` instead of `AUTO_INIT_DB=1`
> once Alembic owns the schema. `AUTO_INIT_DB` remains a dev convenience for SQLite.

## Deploy (reliable, one command)
`databricks sync` is unreliable for the built `dist/*` files, so the deploy script
force-imports the frontend bundle and verifies the live hash:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1            # build + deploy
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -SkipBuild # deploy current build
```
It builds the frontend, syncs source, `workspace import --overwrite`s `index.html`
and every `dist/assets/*`, deploys the app, and checks the live page references the
just-built JS and that it returns 200.

Data-fix scripts (run once, as needed):
- `scripts/seed-lakebase.ps1` — load the Excel into Lakebase.
- `scripts/grant-app.ps1` — grant the app service principal on the tables.
- `scripts/cleanup-lakebase-lookups.ps1` — sub-status cleanup + status order/labels/flags.

## Shared frontend helpers
Formatting/presentation helpers live in `frontend/src/components/format.jsx`
(`COLORS`, `initials`, `fmtET`, `relTime`, `Avatars`) and UI primitives in
`frontend/src/components/ui.jsx` — import from there rather than redefining per page.
