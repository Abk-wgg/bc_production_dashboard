<#
.SYNOPSIS
    One-time setup on the box: make the production board start by itself and
    stay up.

.DESCRIPTION
    Windows will not run a plain program as a service - a service has to speak
    a protocol that node.exe does not. The usual answer is a wrapper like NSSM,
    which is a download. This uses the Task Scheduler instead, which is already
    on every Windows machine and can do the two things that matter: start the
    board on its own, and start it again if it dies.

    Run this ONCE on the machine that will host the board. After that,
    scripts\deploy.ps1 puts new versions on.

    TWO MODES, and which one you can use depends on your rights:

      default    starts at BOOT, with nobody logged in. Needs Administrator.
      -AtLogon   starts when YOU SIGN IN. Needs no special rights at all.

    -AtLogon is not only the fallback. The board reads workbooks out of
    OneDrive, and OneDrive only syncs while somebody is signed in - so a board
    started at boot with nobody logged in serves data that stopped updating at
    the last sign-out. Both modes have the same *useful* lifetime here. What
    boot-start gives you is one less thing to remember after a reboot.

.EXAMPLE
    .\scripts\install-task.ps1 -AppDir C:\ProdBoard\app -Port 80

.EXAMPLE
    # No administrator rights: starts when you sign in, no firewall rule.
    .\scripts\install-task.ps1 -AtLogon -Port 8080

.EXAMPLE
    # Run as a named account instead of the machine - needed only if the board
    # has to read files that account owns, such as a synced OneDrive folder.
    .\scripts\install-task.ps1 -RunAsUser "NEXTGEN360\svc-prodboard"

.EXAMPLE
    # Node installed per-user by install-node-user.ps1, so not on the system path.
    .\scripts\install-task.ps1 -AtLogon -NodeExe "$env:LOCALAPPDATA\Programs\node\node.exe"
#>
[CmdletBinding()]
param(
    # Name the task appears under in Task Scheduler. deploy.ps1 must be given
    # the same name.
    [string] $Name = "ProductionBoard",

    # Where the running copy of the app lives. NOT the source folder - see the
    # note in DEPLOY.md about why the two are kept apart.
    [string] $AppDir = "C:\ProdBoard\app",

    # 80 means people type http://thisbox with no port on the end. Binding it
    # needs no rights on Windows, but IIS usually already holds it.
    [int] $Port = 80,

    [string] $NodeExe = "C:\Program Files\nodejs\node.exe",

    # SYSTEM is the machine itself: always available, no password to expire.
    # Anything else will prompt for that account's password. Ignored with
    # -AtLogon, which can only ever register a task for the person running it.
    [string] $RunAsUser = "SYSTEM",

    # Start when this user signs in, rather than when the machine boots. Needs
    # no administrator rights - a standard user may register a task that runs
    # as themselves. See the note in .DESCRIPTION about why this is a
    # reasonable choice here and not only a workaround.
    [switch] $AtLogon
)

$ErrorActionPreference = "Stop"

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$isAdmin = Test-Administrator
$me = [Security.Principal.WindowsIdentity]::GetCurrent().Name

# Admin is needed for two separate things, and they are worth keeping apart:
# a trigger that fires before anyone logs in, and a machine-wide firewall rule.
# -AtLogon avoids the first. Nothing avoids the second.
if (-not $AtLogon -and -not $isAdmin) {
    throw @"
Run this in an Administrator PowerShell, or pass -AtLogon.

  Administrator     the board starts at BOOT, with nobody logged in
  -AtLogon          the board starts when YOU SIGN IN, and needs no rights

With OneDrive workbooks as the data source, -AtLogon loses less than it looks:
the files only sync while somebody is signed in anyway.
"@
}

if (-not (Test-Path $NodeExe)) {
    throw @"
No Node at $NodeExe.

Install it, or pass -NodeExe with the right path. If you have no administrator
rights, scripts\install-node-user.ps1 installs Node into your own profile and
prints the path to give this script.
"@
}

if (-not (Test-Path (Join-Path $AppDir "server.js"))) {
    throw "No server.js in $AppDir. Run scripts\deploy.ps1 first to put the app there, then run this."
}

if ($AtLogon) {
    $runsAs = $me
    $when = "when $me signs in"
} else {
    $runsAs = $RunAsUser
    $when = "at boot, with nobody logged in"
}

Write-Host ""
Write-Host "Installing '$Name'" -ForegroundColor Cyan
Write-Host "  app       $AppDir"
Write-Host "  port      $Port"
Write-Host "  node      $NodeExe"
Write-Host "  runs as   $runsAs"
Write-Host "  starts    $when"
Write-Host ""

# --- the wrapper -----------------------------------------------------------
# A scheduled task can run a program but cannot set an environment variable
# for it, and server.js reads PORT from the environment on its very first line
# - before Next.js loads .env.local. So the port cannot live in .env.local
# with everything else; it has to be set by something that runs first. This
# two-line batch file is that something.
$runCmd = Join-Path $AppDir "run.cmd"
$runLines = @(
    "@echo off",
    "rem Written by scripts\install-task.ps1 - change the port there, not here.",
    "rem PORT cannot go in .env.local: server.js reads it before Next loads that file.",
    "set PORT=$Port",
    "set HOSTNAME=0.0.0.0",
    "`"$NodeExe`" server.js"
)
Set-Content -Path $runCmd -Value $runLines -Encoding ascii
Write-Host "wrapper    $runCmd" -ForegroundColor Green

# --- the task --------------------------------------------------------------
$action = New-ScheduledTaskAction -Execute $runCmd -WorkingDirectory $AppDir

# ExecutionTimeLimit 0 means "never time out" - the default kills a task after
# three days, which would take the board down without explanation. RestartCount
# is what makes this behave like a service rather than a one-shot.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue

$description = "Read-only Business Central production board. Serves HTTP on port $Port from $AppDir. Starts $when. Deployed by scripts\deploy.ps1."

if ($AtLogon) {
    # Interactive, and RunLevel Limited rather than Highest: a standard user
    # cannot grant a task more privilege than they have, and asking for it is
    # how this fails with "Access is denied" on a machine where everything else
    # would have worked.
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description | Out-Null
    Write-Host "task       registered, starts when you sign in, restarts up to 3 times" -ForegroundColor Green
} elseif ($RunAsUser -eq "SYSTEM") {
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal -Description $description | Out-Null
    Write-Host "task       registered, starts at boot, restarts up to 3 times" -ForegroundColor Green
} else {
    $trigger = New-ScheduledTaskTrigger -AtStartup
    Write-Host ""
    Write-Host "Enter the password for $RunAsUser - Windows stores it with the task." -ForegroundColor Yellow
    $cred = Get-Credential -UserName $RunAsUser -Message "Account the board runs as"
    Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
        -Settings $settings -Description $description `
        -User $cred.UserName -Password $cred.GetNetworkCredential().Password `
        -RunLevel Highest | Out-Null
    Write-Host "task       registered, starts at boot, restarts up to 3 times" -ForegroundColor Green
}

# --- the firewall ----------------------------------------------------------
# Domain and Private only, deliberately. Public is the profile Windows picks on
# an untrusted network; a board that answered there would be reachable from a
# coffee shop if this machine ever moved.
#
# This is machine-wide, so it is the one thing -AtLogon cannot do for itself.
$ruleName = "$Name (TCP $Port)"
$firewallDone = $false

if ($isAdmin) {
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -Profile Domain,Private | Out-Null
    Write-Host "firewall   inbound TCP $Port allowed on Domain and Private networks" -ForegroundColor Green
    $firewallDone = $true
} else {
    $existing = Get-NetFirewallRule -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq $ruleName -and $_.Enabled -eq "True" }
    if ($existing) {
        Write-Host "firewall   a rule called '$ruleName' already exists - nothing to do" -ForegroundColor Green
        $firewallDone = $true
    } else {
        Write-Warning "firewall   SKIPPED - opening a port is machine-wide and needs Administrator."
        Write-Warning "           The board will answer on this machine but not from any other."
    }
}

# --- start it --------------------------------------------------------------
Start-ScheduledTask -TaskName $Name
Write-Host ""
Write-Host "Waiting for it to answer..." -NoNewline

$deadline = (Get-Date).AddSeconds(60)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) { $ok = $true; break }
    } catch {
        Start-Sleep -Seconds 2
        Write-Host "." -NoNewline
    }
}
Write-Host ""

if (-not $ok) {
    Write-Warning "No answer on http://localhost:$Port after 60 seconds."
    Write-Warning "Open Task Scheduler, find '$Name', and look at Last Run Result."
    Write-Warning "Port $Port in use by IIS or another site is the usual cause - try -Port 8080."
    exit 1
}

$hostName = $env:COMPUTERNAME.ToLower()
$suffix = ""
if ($Port -ne 80) { $suffix = ":$Port" }

Write-Host ""
Write-Host "Up." -ForegroundColor Green
Write-Host "  on this machine   http://localhost$suffix"
if ($firewallDone) {
    Write-Host "  from anywhere     http://$hostName$suffix"
} else {
    Write-Host "  from anywhere     not yet - see the firewall note below"
}

Write-Host ""
if ($AtLogon) {
    Write-Host "It starts again each time you sign in. It does NOT survive a reboot on"
    Write-Host "its own - sign in and it comes back. That is also when OneDrive starts"
    Write-Host "syncing the workbooks again, so the two go together."
} else {
    Write-Host "It will now come back on its own after a reboot."
}

if (-not $firewallDone) {
    Write-Host ""
    Write-Host "One thing left, and it needs somebody with Administrator:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    Please allow inbound TCP $Port on $hostName," -ForegroundColor Yellow
    Write-Host "    Domain and Private profiles only." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Until that is done the board answers only on this machine. To do it"
    Write-Host "yourself in an Administrator PowerShell:"
    Write-Host ""
    Write-Host "    New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound ``"
    Write-Host "      -Action Allow -Protocol TCP -LocalPort $Port -Profile Domain,Private"
}

Write-Host ""
Write-Host "To put a new version on, run:"
$deployArgs = "-Name '$Name' -AppDir '$AppDir' -Port $Port"
Write-Host "    scripts\deploy.ps1 $deployArgs"
Write-Host ""
