# Database & environment changes — apply on the personal laptop

This note is for whoever applies the replica to the **personal Lakebase** and the
**Databricks App**. It lists exactly what changed versus the original app and the
commands to apply it. Fill in the placeholders from [DEPLOY.md](DEPLOY.md).

## TL;DR — is there a schema (table) change?

**Same tables and columns as the original.** There is **one included Alembic migration**
beyond a bare baseline — `a048de425e38_timestamp_not_null` — which makes the `created_at`/
`updated_at` columns `NOT NULL` to match the ORM. Apply it with `alembic upgrade head`
(the deploy runs `scripts/migrate-lakebase.ps1` for you). On a **fresh** database the seed
also creates every table via the ORM, so you can skip Alembic for a throwaway DB. No other
table or column changed. The remaining differences are **data + a few lookup labels + env**.

## What's in this build

1. **All data is fictional.** No real people, emails, phone numbers, ticket titles,
   comments or client data. Generated deterministically by `migration/seed_dummy.py`.
2. **Lead / admin login** is the first `ADMIN_EMAILS` entry (injected into `app.yaml` at deploy time).
3. **Generic lookups.** Groups, statuses, sub-statuses and skills use neutral demo
   values (e.g. `In Progress Internal`, `Streaming`, `Migration`).
4. **Branding** (app code only, no DB impact): product name "Effort Tracker", logo,
   a `your-instance` ServiceNow placeholder, `first.last@example.com` emails.
5. **Infra values** in `scripts/*.ps1`, `DEPLOY.md` are placeholders — set your own.

6. **Schema is Alembic-managed.** Migrations live in `backend/alembic/versions/`; for a
   managed database run `alembic upgrade head` (see `scripts/migrate-lakebase.ps1`) and set
   `AUTO_INIT_DB=0`. The public demo keeps `AUTO_INIT_DB=1` so its fresh schema is created
   on first boot. A pre-Alembic database must be `alembic stamp head` once first.
7. **API writes require the `X-Requested-With` header** (CSRF guard in `main.py`); the SPA
   sends it from `api.js`. The Python seed/ORM scripts bypass HTTP, so they are unaffected.

> Seed into a clean/empty database (or use `--reset`, which wipes app data first) so
> no row references a lookup code from an older seed.

## Apply to local SQLite (sanity check first)

```bash
cd effort-tracker
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
python migration/seed_dummy.py --reset      # builds ams_local.db with the fictional data
cd frontend && npm install && npm run build && cd ..
uvicorn app.main:app --app-dir backend --port 8000   # open http://localhost:8000
```

Expected counts: **26 resources, 154 enhancements, 1994 effort rows, 7 support tickets.**

## Apply to Lakebase (personal Databricks)

1. Make sure the schema exists. On a **fresh** Lakebase database, the seed creates all
   tables itself (the ORM `init_db()` runs `CREATE TABLE IF NOT EXISTS`). You can also
   run `backend/sql/001_schema.sql` once in the SQL editor — it is equivalent.

2. Seed (wipes app data, then loads the fictional data). Set the connection env, then:

   ```powershell
   $tok = (databricks auth token | ConvertFrom-Json).access_token
   $env:PGHOST="<your-lakebase-host>.database.cloud.databricks.com"
   $env:PGPORT="5432"; $env:PGDATABASE="databricks_postgres"
   $env:PGUSER="<your-email>"; $env:PGPASSWORD=$tok; $env:PGSSLMODE="require"
   pip install -r requirements.txt
   python migration\seed_dummy.py --reset
   ```

   (Or just run `scripts\seed-lakebase.ps1` after editing its placeholders.)

   `--reset` deletes rows in dependency order (children → parents → lookups) inside the
   app’s tables only; it does not drop tables or touch anything else in the database.

3. If you seeded as yourself but the **app runs as its service principal**, grant the SP:
   run `scripts\grant-app.ps1` (edit placeholders) or the `GRANT` block in DEPLOY.md.

## Apply to the Databricks App

1. The deploy sets `ADMIN_EMAILS` from the GitHub secret of that name. Confirm it in the app’s
   **Environment** tab (or set it there) so your login gets the lead role.
2. Rebuild the SPA (`cd frontend && npm run build`) so the new branding/logo ship.
3. Redeploy:
   ```powershell
   databricks sync . /Workspace/Users/<your-email>/effort-tracker
   databricks apps deploy effort-tracker --source-code-path /Workspace/Users/<your-email>/effort-tracker
   ```
   or `scripts\deploy.ps1`.

## Table inventory (for reference — unchanged from the original)

Lookups: `grp`, `status`, `sub_status`, `skill_category`
Core: `resource`, `enhancement`, `effort`, `app_setting`
Enhancement detail: `enhancement_group`, `enhancement_resource`, `enhancement_skill`,
`enh_comment`, `enh_link`, `enh_group_state`
Support: `support_ticket`, `support_comment`, `support_ticket_resource`
Audit: `audit_log`

The authoritative DDL is `backend/sql/001_schema.sql` (Postgres) / the ORM in
`backend/app/db.py` (also used for SQLite locally).
