# One-command, reliable deploy: build -> sync source -> force-import the frontend
# bundle (databricks sync is unreliable for dist/*) -> deploy -> verify live.
#
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -SkipBuild
param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$dbx     = Get-ChildItem "$env:USERPROFILE\.vscode\extensions" -Filter "databricks.exe" -Recurse -ErrorAction SilentlyContinue |
           Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $dbx) { $dbx = (Get-Command databricks -ErrorAction SilentlyContinue).Source }
if (-not $dbx) { throw "databricks CLI not found" }
$ws      = "/Workspace/Users/<your-email>/effort-tracker"
$base    = "https://<your-app-url>.databricksapps.com"
$app     = "effort-tracker"
$profile = "DEFAULT"

if (-not $SkipBuild) {
  Write-Host "Building frontend..." -ForegroundColor Cyan
  Push-Location frontend; npm run build; Pop-Location
}

Write-Host "Syncing source..." -ForegroundColor Cyan
& $dbx sync . $ws -p $profile | Out-Null

Write-Host "Force-importing frontend bundle..." -ForegroundColor Cyan
& $dbx workspace import "$ws/frontend/dist/index.html" --file "$repo\frontend\dist\index.html" --format RAW --overwrite -p $profile
Get-ChildItem "$repo\frontend\dist\assets" -File | ForEach-Object {
  & $dbx workspace import "$ws/frontend/dist/assets/$($_.Name)" --file $_.FullName --format RAW --overwrite -p $profile
}

Write-Host "Deploying app..." -ForegroundColor Cyan
& $dbx apps deploy $app --source-code-path $ws -p $profile | Select-String "state" | Select-Object -Last 1

Write-Host "Verifying live bundle..." -ForegroundColor Cyan
$localJs = (Select-String -Path "$repo\frontend\dist\index.html" -Pattern 'assets/index-[A-Za-z0-9_\-]+\.js').Matches.Value
$tok = (& $dbx auth token -p $profile | ConvertFrom-Json).access_token
$h = @{ Authorization = "Bearer $tok" }
Start-Sleep -Seconds 5
$idx = (Invoke-WebRequest -Uri "$base/?cb=$(Get-Random)" -Headers $h -UseBasicParsing).Content
$liveJs = ([regex]::Match($idx, 'assets/index-[A-Za-z0-9_\-]+\.js')).Value
if ($liveJs -ne $localJs) {
  Write-Host "WARNING: live JS ($liveJs) != built JS ($localJs) - propagation lag or stale index." -ForegroundColor Yellow
}
$code = (Invoke-WebRequest -Uri "$base/$liveJs" -Headers $h -UseBasicParsing).StatusCode
if ("$code" -eq "200" -and $liveJs -eq $localJs) {
  Write-Host "OK - live serves $liveJs (200)." -ForegroundColor Green
} else {
  Write-Host "CHECK - live=$liveJs status=$code (expected $localJs/200)." -ForegroundColor Yellow
}
