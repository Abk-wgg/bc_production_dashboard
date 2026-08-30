<#
.SYNOPSIS
    Put a new version of the production board on the box.

.DESCRIPTION
    Builds, swaps the running copy, restarts, and checks the result is
    actually serving live data.

    The order matters. The build happens FIRST, while the old version is still
    up, so the board is only down for the few seconds the copy takes. That is
    also why the running copy lives in its own folder rather than being served
    straight out of .next\standalone: a running server holds those files open,
    and on Windows a build that cannot overwrite a file it needs does not fail
    - it hangs at the end, silently, looking exactly like a slow build.

    The last step is the one worth keeping. It asks the app which data source
    it ended up on. Without .env.local the board does not break, it quietly
    serves the bundled snapshot - 543 component lines instead of 1,957, which
    looks like working software unless you check.

.EXAMPLE
    .\scripts\deploy.ps1

.EXAMPLE
    .\scripts\deploy.ps1 -Clean          # throw .next away first, if a build looks wrong
#>
[CmdletBinding()]
param(
    # Must match the name given to install-task.ps1.
    [string] $Name = "ProductionBoard",

    # The running copy. Kept apart from the source folder on purpose.
    [string] $AppDir = "C:\ProdBoard\app",

    [int] $Port = 80,

    # The source folder - defaults to the repo this script sits in.
    [string] $Source = (Split-Path -Parent $PSScriptRoot),

    # Delete .next before building. For when a build behaves oddly, usually
    # after dev and build have both written to it.
    [switch] $Clean,

    # Copy what is already built instead of building again.
    [switch] $SkipBuild
)

$ErrorActionPreference = "Stop"

function Write-Step([string] $Text) {
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor Cyan
}

function Invoke-Robocopy([string] $From, [string] $To, [switch] $Mirror) {
    # robocopy reports success with exit codes 0 to 7 - anything below 8 means
    # it did what was asked. Treating non-zero as failure, the usual reflex,
    # makes every successful copy look broken.
    $options = @("/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:2", "/W:2")
    if ($Mirror) { $options = @("/MIR") + $options }
    & robocopy $From $To @options | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Copy failed: $From -> $To (robocopy exit $LASTEXITCODE)"
    }
    $global:LASTEXITCODE = 0
}

if (-not (Test-Path (Join-Path $Source "package.json"))) {
    throw "No package.json in $Source. Pass -Source with the path to the repo."
}

Write-Host ""
Write-Host "Deploying the production board" -ForegroundColor Cyan
Write-Host "  from   $Source"
Write-Host "  to     $AppDir"
Write-Host "  task   $Name  (port $Port)"

# --- 1. build, with the old version still serving --------------------------
if (-not $SkipBuild) {
    Write-Step "Building"

    Push-Location $Source
    try {
        if ($Clean -and (Test-Path ".next")) {
            Remove-Item -Recurse -Force ".next"
            Write-Host "cleared .next"
        }

        & npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed. Nothing was copied - the running version is untouched."
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Step "Skipping build (-SkipBuild)"
}

$standalone = Join-Path $Source ".next\standalone"
if (-not (Test-Path (Join-Path $standalone "server.js"))) {
    throw "No build output at $standalone. Run without -SkipBuild."
}

# --- 2. stop, and make sure it really stopped ------------------------------
Write-Step "Stopping"

$task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    Write-Host "asked the task to stop"
} else {
    Write-Warning "No scheduled task called '$Name'. Copying anyway; run install-task.ps1 to set it up."
}

# Stopping the task kills the batch wrapper, which does not always take node
# with it - and a node still holding these files turns the copy below into a
# permission error. Wait for it, then insist.
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    $holding = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$AppDir*" })
    if ($holding.Count -eq 0) { break }
    Start-Sleep -Seconds 1
}

$stubborn = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$AppDir*" })
foreach ($proc in $stubborn) {
    Write-Host "forcing node $($proc.ProcessId) to close"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

# --- 3. swap ---------------------------------------------------------------
Write-Step "Copying"

if (-not (Test-Path $AppDir)) { New-Item -ItemType Directory -Path $AppDir -Force | Out-Null }

# /E rather than /MIR for the server itself: run.cmd and .env.local live in
# $AppDir and are not in the build output, so mirroring would delete them.
Invoke-Robocopy -From $standalone -To $AppDir
Write-Host "server and node_modules"

# Static assets ARE purely build output, so mirror them - otherwise every
# deploy leaves the last one's chunks behind for ever.
Invoke-Robocopy -From (Join-Path $Source ".next\static") -To (Join-Path $AppDir ".next\static") -Mirror
Write-Host "static assets"

$public = Join-Path $Source "public"
if (Test-Path $public) {
    Invoke-Robocopy -From $public -To (Join-Path $AppDir "public") -Mirror
    Write-Host "public files"
}

# The one that is easy to forget and hard to notice. The standalone server runs
# with its own working directory and never reads the repo's .env.local.
$envSource = Join-Path $Source ".env.local"
if (Test-Path $envSource) {
    Copy-Item -Path $envSource -Destination (Join-Path $AppDir ".env.local") -Force
    Write-Host "settings (.env.local)"
} else {
    Write-Warning "No .env.local in $Source - the board will fall back to the bundled snapshot."
}

# --- 4. start --------------------------------------------------------------
Write-Step "Starting"

if (-not $task) {
    Write-Warning "No task to start. Set one up with install-task.ps1."
    exit 1
}

Start-ScheduledTask -TaskName $Name

Write-Host "waiting for it to answer" -NoNewline
$deadline = (Get-Date).AddSeconds(90)
$up = $false
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) { $up = $true; break }
    } catch {
        Start-Sleep -Seconds 2
        Write-Host "." -NoNewline
    }
}
Write-Host ""

if (-not $up) {
    Write-Warning "No answer on http://localhost:$Port after 90 seconds."
    Write-Warning "Task Scheduler -> '$Name' -> Last Run Result will say why."
    exit 1
}

# --- 5. check it is serving real data, not the fallback ---------------------
Write-Step "Checking the data"

try {
    $feed = Invoke-RestMethod -Uri "http://localhost:$Port/api/prod-order-components" -TimeoutSec 30
    Write-Host ("source: {0} - {1} component lines" -f $feed.source, $feed.count)

    if ($feed.source -eq "snapshot") {
        Write-Warning "This is the BUNDLED SNAPSHOT, not live data."
        Write-Warning "The board works and looks right, it is just months out of date."
        Write-Warning "Check .env.local reached $AppDir, and that the paths in it are readable by the account the task runs as."
    }
} catch {
    Write-Warning "Could not read the components feed: $_"
    Write-Warning "Pages are up, so this is a data problem rather than a hosting one."
}

$hostName = $env:COMPUTERNAME.ToLower()
$suffix = ""
if ($Port -ne 80) { $suffix = ":$Port" }

Write-Host ""
Write-Host "Deployed." -ForegroundColor Green
Write-Host "  http://$hostName$suffix"
Write-Host ""
