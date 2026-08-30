# Putting the board on a machine

What this gets you: a page anyone in the business can open, that comes back on
its own after a reboot, and costs nothing per person looking at it.

```
        Office and shop-floor browsers
                    |
                    |   http://wg-prodboard
                    v
   +------------------------------------------+
   |  A Windows machine that is always on     |
   |                                          |
   |   +----------------------------------+   |
   |   |  Scheduled task "ProductionBoard"|   |
   |   |    run.cmd  ->  node server.js   |   |
   |   |    listening on port 80          |   |
   |   +---------------+------------------+   |
   |                   |                      |
   |          C:\ProdBoard\app                |
   +-------------------|----------------------+
                       |
                       |  one identity, any number of viewers
                       v
             Business Central / the workbooks
```

Two folders, and keeping them apart is the point:

| | |
|---|---|
| **the source** | wherever the repo is checked out. Where you build. |
| **`C:\ProdBoard\app`** | the running copy. Only `deploy.ps1` writes here. |

Serving straight out of `.next\standalone` seems simpler and is the cause of
the worst failure in this document — see **A build that never finishes** below.

## Before you start: where does the data come from?

**Read this bit properly. It is the one thing that will silently not work.**

`.env.local` points at workbooks in OneDrive:

```
BC_WORKBOOK_FILE=C:\Users\abhishekkohli\OneDrive - NextGEN360 Ltd\...
```

OneDrive is not a drive that is simply *there*. It is a program that runs **in a
desktop session** and keeps a folder in step with the cloud. No session, no
syncing.

**The chosen machine is signed in to the same account, so those files are on
it.** That works. Three things make it keep working:

### 1. Make the workbooks real files, not placeholders

By default OneDrive leaves files "online-only": what is on disk is a stub, and
opening one makes OneDrive fetch it. That fetch is done by OneDrive in the
desktop session, so a background task reading a stub can stall or fail
depending on what is awake at the time.

In File Explorer, right-click the **`BC-WAREHOUSE - Raw data`** folder and
choose **Always keep on this device**. The files become ordinary local files
that anything can read at any time.

### 2. Check the path is the same on that machine

The profile folder is usually the same but is not guaranteed. On the machine:

```powershell
$env:USERPROFILE
Test-Path "$env:USERPROFILE\OneDrive - NextGEN360 Ltd\BC-WAREHOUSE - Raw data\BC-FEED.xlsx"
```

`True` means `.env.local` can go over as it is. `False` means edit the two
paths in the copy at `C:\ProdBoard\app\.env.local`.

### 3. Know what a reboot does

The board itself is fine — the task starts it at boot with nobody logged in.
**OneDrive is not.** Until someone signs in, the workbooks stop updating and the
board carries on serving the last set it got. It does not break; it goes quietly
out of date.

So after a Windows Update reboot, **sign back in on that machine**. The date on
every page ("BC warehouse — refreshed ...") is what tells you whether that
happened.

### Where this should end up

Turning on live BC (`BC-SETUP.md`) removes all three of the above. One Entra app
registration, admin consent, a BC permission set — free, no per-user licence.
The board then reads BC directly: no file, no OneDrive, no session, and the data
stops being as-of-the-last-refresh.

If the machine is ever handed over or the account changes, that is the moment to
do it rather than re-solving this.

### If it ends up on the snapshot anyway

The board does not error when a workbook is unreadable. It falls through to the
bundled snapshot and serves **543 component lines instead of 1,957**, which looks
entirely like working software. `deploy.ps1` checks for exactly this at the end
and warns you. To ask at any time:

```powershell
(Invoke-RestMethod http://localhost/api/prod-order-components).source
```

`workbook` or `live` is good. `snapshot` means it could not read the files.

## What the machine needs

- **On all the time.** Sleep and hibernate off (`powercfg /change standby-timeout-ac 0`).
- **Node**, from nodejs.org. It is not optional - see below.
- **Administrator**, once, to create the startup task and open the port.
- **A fixed address.** Ask IT for a DHCP reservation, or the machine's IP moves
  and the name stops resolving.

### Node has to be on that machine

The board is a Node program. `deploy.ps1` copies the app and every library it
uses, but **not the thing that runs them** - that is `node.exe`, and copying the
folder across does not bring it with it.

Install **Node LTS** from nodejs.org: the Windows `.msi`, next-next-finish,
about 60 MB. That is the whole job. Nothing is fetched at boot - the app ships
with its libraries already inside it, so the machine never runs `npm install`
in order to start.

```powershell
node --version
```

**The version does not have to match the machine you build on.** Anything from
v20 up runs this build. Almost all of it is plain JavaScript; the single
compiled file in the bundle is `sharp`, the image resizer Next includes by
default, and this board puts no images through it, so it is never opened.

#### No administrator rights? Node still installs

The `.msi` writes to `C:\Program Files` and needs an administrator. The `.zip`
is the same build without the installer around it, so it goes anywhere the user
can already write. Nothing is registered, nothing is shared, and uninstalling is
deleting the folder.

```powershell
.\scripts\install-node-user.ps1
```

That asks nodejs.org which release is the current LTS, downloads it, **checks it
against the published SHA256 before opening it**, extracts it to
`%LOCALAPPDATA%\Programs\node`, and adds that one folder to the *user* Path -
never the machine Path, which a non-admin cannot write anyway. Open a new
PowerShell window afterwards, or the old one still has the old Path.

`-InstallDir` puts it somewhere else, `-Version v22.11.0` pins one, and
`-NoPath` skips the Path edit for an account that will be given the full path to
`node.exe` instead:

```powershell
.\scripts\install-task.ps1 -AppDir C:\ProdBoard\app -NodeExe "$env:LOCALAPPDATA\Programs\node\node.exe"
```

The zip carries `npm` as well, so `deploy.ps1` builds there too. If that is
awkward, build on your own PC and copy `C:\ProdBoard\app` across: **the machine
that builds needs npm, the machine that runs needs only `node.exe`.**

#### What still needs an administrator

Node does not. Three things around it do, and it is worth knowing before you
start rather than at the last step:

| | |
|---|---|
| **Starting at boot, with nobody logged in** | The `-AtStartup` trigger runs as the machine. Needs admin. |
| **A firewall rule** | Without one, other machines cannot reach the board. Needs admin. |
| **Port 80** | Not an admin thing on Windows, but IIS usually holds it. `-Port 8080` avoids the argument. |

**Starting at logon instead needs no rights at all**, and on this setup it is
arguably the better fit: the workbooks live in OneDrive, which only syncs while
somebody is signed in, so a board that starts at boot and a board that starts at
logon have the same *useful* lifetime anyway. What you lose is a board that
survives a reboot on its own - somebody has to sign in.

The firewall is the one with no workaround. It is a single rule, once, and it is
a reasonable thing to ask IT for:

> Allow inbound TCP 8080 on this machine, Domain and Private profiles only.

## First time

Two ways, and which one you use depends on the rights you have on that machine.
Both end with the same board on the same address.

### With Administrator

```powershell
cd C:\path\to\production-dash-board

# 1. build and copy it into place (the task does not exist yet - it will warn, that is fine)
.\scripts\deploy.ps1 -AppDir C:\ProdBoard\app -Port 80

# 2. make it start at boot and restart if it dies
.\scripts\install-task.ps1 -AppDir C:\ProdBoard\app -Port 80
```

Because the workbooks live in your profile, run the task as **your account**
rather than as the machine:

```powershell
.\scripts\install-task.ps1 -AppDir C:\ProdBoard\app -Port 80 -RunAsUser "NEXTGEN360\abhishekkohli"
```

It prompts for the password once and Windows stores it with the task. SYSTEM
also works if you marked the OneDrive folder "Always keep on this device", but
running as the account that owns the files takes the question off the table.

### Without Administrator

```powershell
cd C:\path\to\production-dash-board

# 1. Node into your own profile, if it is not there already
.\scripts\install-node-user.ps1

# 2. build and copy it into place (open a NEW window first - PATH changed)
.\scripts\deploy.ps1 -AppDir C:\ProdBoard\app -Port 8080

# 3. start it when you sign in
.\scripts\install-task.ps1 -AtLogon -AppDir C:\ProdBoard\app -Port 8080
```

`-AtLogon` registers the task in your own account with a logon trigger, which a
standard user is allowed to do. Port 8080 rather than 80 only because IIS
usually already holds 80 and you cannot stop it.

**Do not read `-AtLogon` as the lesser option.** The workbooks live in OneDrive,
which only syncs while somebody is signed in — so a board started at boot with
nobody logged in serves data frozen at the last sign-out. Both modes have the
same *useful* lifetime here. What you give up is the board coming back by itself
after a reboot: somebody has to sign in, which is what you want anyway.

`AppDir` can be anywhere you can write. `C:\ProdBoard\app` normally is; if not,
use something under your profile.

### Either way

`install-task.ps1` finishes by printing the address and will tell you if nothing
answered. Without Administrator it also prints the one thing it could not do —
see below.

**If the port is taken** — IIS is the usual culprit — use a different `-Port` on
both commands. People then type `http://wg-prodboard:8080`.

### The firewall, if you had no Administrator

The board will answer on the machine itself and **nowhere else** until an
inbound rule exists, because that setting is machine-wide. `install-task.ps1`
says so rather than leaving you to discover it. The ask is small and specific:

> Please allow inbound TCP 8080 on `<machine>`, Domain and Private profiles only.

Domain and Private and not Public on purpose: Public is the profile Windows
picks on an untrusted network, and a board that answered there would be
reachable from a coffee shop if the machine ever moved.

### Why a scheduled task and not a service

A Windows service has to speak a protocol `node.exe` does not, so running Node
as a real service needs a wrapper program like NSSM, which is a download. The
Task Scheduler is already on the machine and does the two things that actually
matter: start at boot with nobody logged in, and restart on failure. If you
would rather have a proper service later, NSSM is a drop-in swap — only
`install-task.ps1` changes.

## Every time after that

```powershell
cd C:\path\to\production-dash-board
git pull
.\scripts\deploy.ps1
```

It builds first, **while the old version keeps serving**, then stops, copies,
starts and checks. The board is down for the few seconds the copy takes.

If the build fails, nothing is copied and the running version is untouched.

## Giving it a name people can type

Windows already answers to the machine's own name on the local network, so
`http://wg-prodboard` works with no setup at all — find the name with
`hostname`.

For something friendlier (`http://board.wilsongeorge.co.uk`), IT adds one DNS
record pointing at the machine's reserved IP. Nothing in the app changes.

## Sign-in: the gap to close next

**Right now there is no sign-in.** `.env.local` has no `AUTH_*` values, so
`isAuthConfigured()` is false, every page says so in a banner, and anyone who
can reach the address can read the board. On localhost that is fine. On a
machine on the network it means the whole business — and, once live BC is on,
the operator names on the schedule cards.

Closing it needs two things, and the second is the awkward one:

1. The Entra app registration in `AUTH-SETUP.md`. Free.
2. **HTTPS.** Microsoft only allows plain `http://` redirect addresses for
   `localhost`. As soon as other machines reach the board by name, sign-in
   needs a certificate for that name.

If IT controls `wilsongeorge.co.uk` DNS, a certificate can be issued for an
internal-only name without exposing the machine to the internet. An internal
certificate authority or a self-signed certificate trusted by group policy also
work.

Until then, treat "on our network" as the access control and keep the audience
deliberate.

## When it goes wrong

### A build that never finishes

**Symptom:** `npm run build` compiles, prints nothing more, and sits there. Not
an error — it looks like a slow build. It will never end.

**Cause:** something is running the server out of the folder the build is
trying to write. Windows will not let a build replace a file an open process
holds, and Next.js waits rather than failing.

**Fix:** stop whatever is serving, then build. This is why the running copy
lives in `C:\ProdBoard\app` and not in `.next\standalone` — with them apart,
you can build while the board stays up.

**The nastier half:** stopping an `npm run build` kills npm and leaves the
`next build` underneath it alive, still holding the folder. The next attempt
hangs too, and now two builds are writing the same place. Always check:

```powershell
Get-Process node -ErrorAction SilentlyContinue
```

With nothing in the way a build here takes about 30 seconds.

### The board is up but the numbers are stale

It is on the bundled snapshot. `deploy.ps1` says so at the end, or ask it
yourself:

```powershell
(Invoke-RestMethod http://localhost/api/prod-order-components).source
```

`workbook` or `live` is good. `snapshot` means the real source was unreachable
— almost always `.env.local` missing from `C:\ProdBoard\app`, or the account
the task runs as cannot see the workbook paths. See the OneDrive section above.

### Nothing answers at all

```powershell
Get-ScheduledTask -TaskName ProductionBoard | Get-ScheduledTaskInfo
```

`LastTaskResult` of 0 means it started cleanly. Otherwise Task Scheduler ->
Task Scheduler Library -> `ProductionBoard` -> History.

Port already in use is the most common cause. Check with:

```powershell
Get-NetTCPConnection -LocalPort 80 -State Listen
```

### Checking it from another machine

```powershell
Test-NetConnection wg-prodboard -Port 80
```

`TcpTestSucceeded: True` means the firewall rule is right. False means the rule
is missing, or the machine is on a network Windows classes as Public — the rule
`install-task.ps1` creates covers Domain and Private only, on purpose.

## Deliberately not used

- **GitHub Pages** — serves files, not a running program; nowhere to keep the
  BC secret; and public. The code belongs on GitHub, the running app does not.
- **Azure App Service / a VM** — no Azure subscription on the tenant.
- **Vercel** — the board would have to reach BC from outside the network, and
  it is not ours to put company data on.
