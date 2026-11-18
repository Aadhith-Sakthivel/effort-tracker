# Applies the sub-status cleanup (migration/cleanup_lookups.py) to Lakebase.
# Run it yourself (needs an OAuth token, like the seed):
#   powershell -ExecutionPolicy Bypass -File scripts\cleanup-lakebase-lookups.ps1

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$Dbx = "databricks"   # or the full path to databricks.exe
$tok = (& $Dbx auth token -p DEFAULT | ConvertFrom-Json).access_token
if (-not $tok) { throw "No token. Run: databricks auth login --host https://<your-workspace>.cloud.databricks.com" }

$env:PGHOST     = "<your-lakebase-host>.database.cloud.databricks.com"
$env:PGPORT     = "5432"
$env:PGDATABASE = "databricks_postgres"
$env:PGUSER     = "<your-email>"
$env:PGPASSWORD = $tok
$env:PGSSLMODE  = "require"

python migration\cleanup_lookups.py
$env:PGPASSWORD = ""
