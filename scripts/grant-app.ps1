# Grants the app's service-principal Postgres role access to the seeded tables.
# Run once after seeding (tables are created as YOU; the app connects as its SP).
#
#   powershell -ExecutionPolicy Bypass -File scripts\grant-app.ps1
#
# The SP role = the app's service_principal_client_id (from `databricks apps get`).

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$Role  = "<app-service-principal-client-id>"   # from `databricks apps get`
$Host_ = "<your-lakebase-host>.database.cloud.databricks.com"
$Dbx   = "databricks"   # or the full path to databricks.exe

$tok = (& $Dbx auth token -p DEFAULT | ConvertFrom-Json).access_token
$env:PGPASSWORD = $tok

$sql = @"
GRANT USAGE ON SCHEMA public TO ""$Role"";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ""$Role"";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ""$Role"";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ""$Role"";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ""$Role"";
"@

python -c @"
import sys, psycopg
sql = sys.stdin.read()
conn = psycopg.connect(host='$Host_', port=5432, dbname='databricks_postgres',
                       user='<your-email>', password='$tok',
                       sslmode='require', connect_timeout=20, autocommit=True)
cur = conn.cursor()
for s in [x.strip() for x in sql.split(';') if x.strip()]:
    cur.execute(s); print('OK:', s[:60])
conn.close(); print('GRANTS APPLIED')
"@ <<< $sql

$env:PGPASSWORD = ""
