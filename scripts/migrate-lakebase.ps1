# Applies Alembic migrations (`alembic upgrade head`) to the Lakebase database.
# Run on every deploy (deploy.ps1 calls this) so the managed schema stays
# current now that the app no longer create_all()s at startup (AUTO_INIT_DB=0).
#
#   powershell -ExecutionPolicy Bypass -File scripts\migrate-lakebase.ps1
#
# The OAuth token is held only in this process's env and passed straight to Postgres —
# it is never written to a file.
#
# ONE-TIME: a DB that already had its schema created the old way (create_all /
# migrate_excel.py, pre-Alembic) must be stamped once before upgrades apply cleanly:
#   (set the PG* env below, then)  python -m alembic stamp head
# See DEVELOPMENT.md.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$Host_ = "<your-lakebase-host>.database.cloud.databricks.com"
$WsUrl = "https://<your-workspace>.cloud.databricks.com"

$profile = if ($env:DB_PROFILE) { $env:DB_PROFILE } else { "DEFAULT" }
$tok = $env:LAKEBASE_TOKEN
if (-not $tok) {
  Write-Host "Getting an OAuth token via profile '$profile'..." -ForegroundColor Cyan
  try { $tok = (databricks auth token -p $profile | ConvertFrom-Json).access_token } catch { $tok = $null }
}
if (-not $tok) {
  Write-Host ""
  Write-Host "No OAuth token yet. Do ONE of these, then re-run:" -ForegroundColor Yellow
  Write-Host "  (a) databricks auth login --host $WsUrl" -ForegroundColor Yellow
  Write-Host "  (b) `$env:LAKEBASE_TOKEN = '<token>'   # from the Lakebase project's Connect page" -ForegroundColor Yellow
  throw "No Lakebase token available."
}

$env:PGHOST     = $Host_
$env:PGPORT     = "5432"
$env:PGDATABASE = "databricks_postgres"
$env:PGUSER     = "<your-email>"
$env:PGPASSWORD = $tok
$env:PGSSLMODE  = "require"

try {
  Push-Location backend
  Write-Host "Applying Alembic migrations (upgrade head)..." -ForegroundColor Cyan
  python -m alembic upgrade head
  Write-Host "Schema is at head." -ForegroundColor Green
} finally {
  Pop-Location
  $env:PGPASSWORD = ""   # clear the token from this session
}
