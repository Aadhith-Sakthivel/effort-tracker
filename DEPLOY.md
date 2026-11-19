# Deploying Effort Tracker to Databricks Apps

Fill in these for your own workspace (placeholders used throughout this doc):

| Placeholder | Meaning |
|---|---|
| `https://<your-workspace>.cloud.databricks.com` | your Databricks workspace URL |
| `<your-lakebase-host>.database.cloud.databricks.com` | your Lakebase instance host |
| `<your-email>` | your workspace login (used as the Lakebase Postgres user) |
| `effort-tracker` | the app name (change if you like) |
| `<app-service-principal-client-id>` | the app's SP id, from `databricks apps get` |

> This deployment loads the **fictional demo data** from `migration/seed_dummy.py`.
> There is no company or client data anywhere in this project.

> A Lakebase **project** (serverless Postgres) authenticates with a short-lived
> Databricks **OAuth token** as the Postgres password, so the one-off seed needs a
> real login. The running app gets its password from a **Resource binding** (Step 5).

---

## Continuous deployment (GitHub Actions)

`.github/workflows/ci-cd.yml` runs the backend tests and builds the frontend on every
push and pull request. On pushes to `main` it also assembles the app bundle
(`scripts/build_bundle.py`), uploads it to `/Workspace/Users/<you>/effort-tracker`
and runs `databricks apps deploy`.

Add three repository secrets (Settings → Secrets and variables → Actions) to switch
the deploy on; without them it is skipped:

| Secret | Value |
|---|---|
| `DATABRICKS_HOST` | `https://<your-workspace>.cloud.databricks.com` |
| `DATABRICKS_TOKEN` | a personal access token (User settings → Developer → Access tokens) |
| `ADMIN_EMAILS` | login(s) that always get the lead role, comma-separated |

Manual alternative: `cd frontend && npm run build && cd .. && ADMIN_EMAILS=<you> python
scripts/build_bundle.py --zip effort-tracker.zip`, then import the zip into the workspace
and deploy from the app page.

---

## Step 0 — Install the Databricks CLI (one-time)

```powershell
winget install Databricks.DatabricksCLI
# or: https://docs.databricks.com/dev-tools/cli/install.html
databricks version        # expect v0.2xx
databricks auth login --host https://<your-workspace>.cloud.databricks.com
```

## Step 1 — Build the frontend (ship the compiled SPA)

Databricks installs Python deps but does NOT run `npm`, so build locally first:

```powershell
cd frontend
npm install
npm run build          # emits frontend/dist, which the backend serves
cd ..
```

## Step 2 — Seed Lakebase with the fictional demo data (also creates the schema)

Edit the placeholders at the top of `scripts\seed-lakebase.ps1`, then:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\seed-lakebase.ps1
```

Or by hand:

```powershell
$tok = (databricks auth token | ConvertFrom-Json).access_token   # ~1h OAuth token
$env:PGHOST     = "<your-lakebase-host>.database.cloud.databricks.com"
$env:PGPORT     = "5432"
$env:PGDATABASE = "databricks_postgres"
$env:PGUSER     = "<your-email>"
$env:PGPASSWORD = $tok
$env:PGSSLMODE  = "require"

pip install -r requirements.txt
python migration\seed_dummy.py --reset
```

Expected: **26 resources, 154 enhancements, 1994 effort rows, 7 support tickets.**

## Step 3 — Sync the code to your workspace

`.gitignore` keeps `node_modules`, the local DB and build output out of git; deploy the bundle from `scripts/build_bundle.py` (CI does this for you).

```powershell
databricks sync --watch . /Workspace/Users/<your-email>/effort-tracker
```

## Step 4 — Create the app

```powershell
databricks apps create effort-tracker
```

This provisions the app and its **service principal**. Note the SP's
**application-id** (`databricks apps get effort-tracker`) — the app connects to
Lakebase as this identity.

## Step 5 — Give the app access to Lakebase

**A. Resource binding (recommended).** In the app's page → **Resources / Add
resource → Database**, pick the Lakebase instance. Databricks creates a Postgres
role for the SP and injects the connection + a managed token as env vars.

**B. Manual grant.** Edit the placeholders in `scripts\grant-app.ps1` and run it, or:

```sql
GRANT USAGE ON SCHEMA public TO "<app-service-principal-client-id>";
GRANT ALL ON ALL TABLES    IN SCHEMA public TO "<app-service-principal-client-id>";
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "<app-service-principal-client-id>";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "<app-service-principal-client-id>";
```

## Step 6 — Confirm the app's environment

Most values come from `app.yaml`. Confirm in the app's **Environment** settings:

| Var | Value |
|---|---|
| `AUTO_INIT_DB` | `1` for the demo (creates tables on first boot); `0` when Alembic owns the schema — see Step 7 |
| `ADMIN_EMAILS` | `<your-email>` |
| `PGHOST` | `<your-lakebase-host>.database.cloud.databricks.com` |
| `PGPORT` | `5432` |
| `PGDATABASE` | `databricks_postgres` |
| `PGSSLMODE` | `require` |
| `PGUSER` / `PGPASSWORD` | injected by the Step 5A Resource binding |

> Rely on the Resource binding for `PGUSER`/`PGPASSWORD`. Do **not** set
> `LAKEBASE_INSTANCE_NAME` for a Lakebase *project*.

## Step 7 — Apply migrations, then deploy

Because `AUTO_INIT_DB=0`, the app no longer creates tables at startup — Alembic owns the
schema. Apply migrations (`scripts/deploy.ps1` does this automatically before deploying):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\migrate-lakebase.ps1   # alembic upgrade head
databricks apps deploy effort-tracker --source-code-path /Workspace/Users/<your-email>/effort-tracker
```

> A database seeded the old way (pre-Alembic) must be stamped once first:
> set the `PG*` env, then `cd backend && python -m alembic stamp head`.

Open the app URL from the Apps UI. It's behind workspace SSO; the signed-in user's
email is stamped on every audit entry automatically.

---

## How auth works at runtime (as deployed)

- **Entrypoint:** `app.yaml` runs `python app_run.py`, which adds `backend/` to the
  path and binds to `$DATABRICKS_APP_PORT`.
- **SSO:** Databricks fronts the app; the logged-in user arrives in `X-Forwarded-Email`
  (read by `backend/app/deps.py`) → written to the audit log. `ADMIN_EMAILS` →
  lead role; `is_lead` resources matched by email → lead; other active resources →
  member; everyone else → viewer.
- **Lakebase password:** the Resource binding injects `PGHOST/PGPORT/PGDATABASE/PGUSER/
  PGSSLMODE` but **not** `PGPASSWORD`. The app uses its **service-principal OAuth token
  as the Postgres password** (`backend/app/lakebase.py` → `attach_oauth_password`,
  from `DATABRICKS_CLIENT_ID/SECRET/HOST`). `pool_recycle=1800` keeps connections
  younger than the ~1h token life.

## Updating later

```powershell
cd frontend; npm run build; cd ..
databricks sync . /Workspace/Users/<your-email>/effort-tracker
databricks apps deploy effort-tracker --source-code-path /Workspace/Users/<your-email>/effort-tracker
```

Or use `scripts\deploy.ps1` (build → sync → force-import `dist/*` → deploy → verify).

## Optional — Delta mirror for BI

Schedule a Databricks Job (nightly) that reads the Lakebase tables and `MERGE`s them
into Unity Catalog Delta tables so BI tools keep working off the lakehouse.
