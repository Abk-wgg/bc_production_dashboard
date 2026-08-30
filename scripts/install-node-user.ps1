<#
.SYNOPSIS
    Install Node and npm for one user, with no administrator rights.

.DESCRIPTION
    The nodejs.org .msi writes to C:\Program Files and needs an administrator.
    The .zip does not - it is the same build, just not wrapped in an installer,
    so it can go anywhere the user can already write. Nothing is registered,
    nothing is shared, and removing it is deleting the folder.

    What this does:
      1. asks nodejs.org which version is the current LTS
      2. downloads that .zip and its official SHASUMS256.txt
      3. checks the file against the published hash before opening it
      4. extracts it to a folder in the user's own profile
      5. adds that folder to the USER Path, not the machine one

    Step 3 is not ceremony. This downloads an executable and then puts it on
    PATH; if the bytes are not the ones nodejs.org published, that is worth
    finding out before running them rather than after.

    Step 5 is done through .NET rather than `setx`, deliberately. `setx PATH
    "%PATH%;..."` is the usual advice and it corrupts PATH two ways: %PATH% is
    the machine and user paths already joined, so it writes the whole machine
    path into the user one, and setx silently truncates at 1024 characters.
    SetEnvironmentVariable('Path', ..., 'User') reads and writes only the user
    value, which is the one a non-admin owns.

.EXAMPLE
    .\scripts\install-node-user.ps1

.EXAMPLE
    # A specific version, and somewhere other than the profile
    .\scripts\install-node-user.ps1 -Version v22.11.0 -InstallDir D:\tools\node

.EXAMPLE
    # Put the files down but leave PATH alone - for a service account that will
    # be given the full path to node.exe instead.
    .\scripts\install-node-user.ps1 -NoPath
#>
[CmdletBinding()]
param(
    # Somewhere the user can write without being asked. Under the profile by
    # default, so it needs no permission from anybody.
    [string] $InstallDir = "$env:LOCALAPPDATA\Programs\node",

    # Blank asks nodejs.org for the current LTS. Pass e.g. "v22.11.0" to pin.
    [string] $Version = "",

    # Skip the PATH edit. node.exe still works by full path.
    [switch] $NoPath,

    # Replace an existing install at -InstallDir.
    [switch] $Force
)

$ErrorActionPreference = "Stop"

function Write-Step([string] $Text) {
    Write-Host ""
    Write-Host "== $Text" -ForegroundColor Cyan
}

# PowerShell 5.1 still defaults to TLS 1.0 for Invoke-WebRequest on some
# builds, and nodejs.org refuses it. The failure looks like a network outage.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$arch = "x64"
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { $arch = "arm64" }

Write-Host ""
Write-Host "Installing Node for $env:USERNAME (no administrator needed)" -ForegroundColor Cyan
Write-Host "  into   $InstallDir"
Write-Host "  arch   win-$arch"

# --- 1. which version ------------------------------------------------------
if ($Version -eq "") {
    Write-Step "Asking nodejs.org for the current LTS"
    $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing
    $lts = $index | Where-Object { $_.lts -ne $false } | Select-Object -First 1
    if (-not $lts) { throw "nodejs.org returned no LTS release. Pass -Version to pin one." }
    $Version = $lts.version
    Write-Host "latest LTS is $Version ($($lts.lts))"
} else {
    Write-Step "Using $Version as asked"
}

$name = "node-$Version-win-$arch"
$zipName = "$name.zip"
$base = "https://nodejs.org/dist/$Version"

# --- 2. download -----------------------------------------------------------
$work = Join-Path $env:TEMP "node-user-install"
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Path $work -Force | Out-Null

$zipPath = Join-Path $work $zipName

Write-Step "Downloading $zipName"
# ProgressPreference off: the progress bar makes Invoke-WebRequest on 5.1
# roughly ten times slower on a file this size.
$oldProgress = $ProgressPreference
$ProgressPreference = "SilentlyContinue"
try {
    Invoke-WebRequest -Uri "$base/$zipName" -OutFile $zipPath -UseBasicParsing
    Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -OutFile (Join-Path $work "SHASUMS256.txt") -UseBasicParsing
} finally {
    $ProgressPreference = $oldProgress
}
Write-Host ("got {0:N1} MB" -f ((Get-Item $zipPath).Length / 1MB))

# --- 3. check it is what nodejs.org published ------------------------------
Write-Step "Verifying the download"

$line = Get-Content (Join-Path $work "SHASUMS256.txt") | Where-Object { $_ -match "\s$([regex]::Escape($zipName))$" }
if (-not $line) { throw "$zipName is not listed in SHASUMS256.txt for $Version." }

$expected = ($line -split "\s+")[0].ToLower()
$actual = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()

if ($expected -ne $actual) {
    Remove-Item -Recurse -Force $work
    throw "Checksum mismatch. Expected $expected, got $actual. The file was NOT extracted."
}
Write-Host "sha256 matches nodejs.org" -ForegroundColor Green

# --- 4. put it in place ----------------------------------------------------
Write-Step "Extracting"

if (Test-Path $InstallDir) {
    if (-not $Force) {
        throw "$InstallDir already exists. Pass -Force to replace it."
    }
    Remove-Item -Recurse -Force $InstallDir
}

Expand-Archive -Path $zipPath -DestinationPath $work -Force
# The zip contains one folder, node-vX.Y.Z-win-x64, and everything is inside it.
Move-Item -Path (Join-Path $work $name) -Destination $InstallDir
Remove-Item -Recurse -Force $work

$nodeExe = Join-Path $InstallDir "node.exe"
if (-not (Test-Path $nodeExe)) { throw "No node.exe under $InstallDir after extracting." }

# --- 5. PATH, for this user only -------------------------------------------
if ($NoPath) {
    Write-Step "Leaving PATH alone (-NoPath)"
} else {
    Write-Step "Adding it to your PATH"

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($null -eq $userPath) { $userPath = "" }

    $parts = $userPath -split ";" | Where-Object { $_ -ne "" }
    $already = $parts | Where-Object { $_.TrimEnd("\") -ieq $InstallDir.TrimEnd("\") }

    if ($already) {
        Write-Host "already there"
    } else {
        $newPath = ($parts + $InstallDir) -join ";"
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Host "added to the USER Path (the machine Path is untouched)"
    }

    # This session inherited its PATH at launch, so make it usable now too.
    $env:Path = "$env:Path;$InstallDir"
}

# --- 6. prove it runs ------------------------------------------------------
Write-Step "Checking it works"

$nodeVersion = & $nodeExe --version
$npmCmd = Join-Path $InstallDir "npm.cmd"
$npmVersion = "not found"
if (Test-Path $npmCmd) { $npmVersion = & $npmCmd --version }

Write-Host "node  $nodeVersion" -ForegroundColor Green
Write-Host "npm   $npmVersion" -ForegroundColor Green

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  node.exe   $nodeExe"
Write-Host ""
if (-not $NoPath) {
    Write-Host "Open a NEW PowerShell window before `node` works by name - this one"
    Write-Host "and every window already open still has the old PATH."
    Write-Host ""
}
Write-Host "To point the board's scheduled task at it without relying on PATH:"
Write-Host "  .\scripts\install-task.ps1 -AppDir C:\ProdBoard\app -Port 8080 -NodeExe `"$nodeExe`""
Write-Host ""
