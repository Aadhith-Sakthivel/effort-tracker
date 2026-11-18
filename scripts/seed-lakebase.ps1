# Seeds a Lakebase project with the fictional demo data (migration/seed_dummy.py).
# Run this yourself (it needs a Databricks OAuth token, which requires your login).
#
#   1) one-time: install the new Databricks CLI, then log in with OAuth:
#        winget install Databricks.DatabricksCLI       # or see DEPLOY.md
#        databricks auth login --host https://<your-workspace>.cloud.databricks.com
#   2) run this script from the repo root:
#        powershell -ExecutionPolicy Bypass -File scripts\seed-lakebase.ps1
#
# The token is held only in this process's env and passed straight to Postgres —
# it is never written to a file.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# --- Fill these in for your own Databricks workspace / Lakebase instance ---
$Host_ = "<your-lakebase-host>.database.cloud.databricks.com"
$WsUrl = "https://<your-workspace>.cloud.databricks.com"
$PgUser = "<your-email>"      # your workspace login (Lakebase Postgres role)

# Token source: an already-set $env:LAKEBASE_TOKEN wins; otherwise ask the CLI.
$profile = if ($env:DB_PROFILE) { $env:DB_PROFILE } else { "DEFAULT" }
$tok = $env:LAKEBASE_TOKEN
if (-not $tok) {
  Write-Host "Getting an OAuth token via profile '$profile'..." -ForegroundColor Cyan
  try { $tok = (databricks auth token -p $profile | ConvertFrom-Json).access_token } catch { $tok = $null }
}
if (-not $tok) {
  Write-Host ""
  Write-Host "No OAuth token yet. Do ONE of these, then re-run this script:" -ForegroundColor Yellow
  Write-Host "  (a) databricks auth login --host $WsUrl    # press Enter at the profile prompt, finish in browser" -ForegroundColor Yellow
  Write-Host "  (b) `$env:LAKEBASE_TOKEN = '<token>'         # paste a token from the Lakebase project's Connect page" -ForegroundColor Yellow
  throw "No Lakebase token available."
}

$env:PGHOST     = $Host_
$env:PGPORT     = "5432"
$env:PGDATABASE = "databricks_postgres"
$env:PGUSER     = $PgUser
$env:PGPASSWORD = $tok
$env:PGSSLMODE  = "require"

Write-Host "Installing Python deps..." -ForegroundColor Cyan
python -m pip install --quiet -r requirements.txt

Write-Host "Creating schema + loading fictional demo data into Lakebase..." -ForegroundColor Cyan
python migration\seed_dummy.py --reset

# clear the token from the environment of this session
$env:PGPASSWORD = ""
Write-Host "Done. Lakebase is seeded with the fictional demo data." -ForegroundColor Green
