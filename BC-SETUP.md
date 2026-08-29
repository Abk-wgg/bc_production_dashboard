# Connecting the app to Business Central

How to give this app read-only access to Business Central. One-time setup.

The web services are **already published** (see `WEB-SERVICES.md`), so this
document is only about the Entra app registration — the one remaining step
between the app and live data.

Three parts, and **two different people**. Parts A and C are yours if you have
the rights; Part B needs an Entra administrator.

| Part | What | Who | Where |
|---|---|---|---|
| A | Create the Entra app registration | You, if permitted | entra.microsoft.com |
| B | **Grant admin consent** | Entra administrator | entra.microsoft.com |
| C | Register the app inside BC + assign a read-only permission set | You, if BC SUPER | Business Central |

Nothing works until all three are done. Part B is the usual blocker.

---

## Part A — Create the app registration

At **entra.microsoft.com** (or portal.azure.com → Microsoft Entra ID):

- [ ] **App registrations → New registration**
- [ ] Name: `OLC Production Board (read-only)` — or something equally obvious to
      whoever audits app registrations in two years
- [ ] Supported account types: **Accounts in this organizational directory only**
      (single tenant)
- [ ] Redirect URI: **leave blank**. This is a service; nobody signs in through it.
- [ ] **Register**
- [ ] Copy the **Application (client) ID** → this becomes `BC_CLIENT_ID`
- [ ] Copy the **Directory (tenant) ID** → this becomes `BC_TENANT_ID`
- [ ] **Certificates & secrets → New client secret**
- [ ] Copy the secret **Value** immediately → this becomes `BC_CLIENT_SECRET`

  > Shown **once**. Navigate away and it is gone forever — you would have to
  > delete it and create another. Copy it before doing anything else.

- [ ] Note the secret's **expiry date** and put it in your calendar. See
      [Secret rotation](#secret-rotation) below.
- [ ] **API permissions → Add a permission → APIs my organization uses**
- [ ] Search **Dynamics 365 Business Central**
- [ ] Choose **Application permissions** (not Delegated — the app acts as itself,
      not as a signed-in person)
- [ ] Tick **`API.ReadWrite.All`** — listed as *"Full access to web services API"*.
      On older tenants this may appear as `app_access`.
- [ ] **Add permissions**

The permission now shows as **"Not granted"**. That is expected — Part B fixes it.

> **If "New registration" is greyed out**, the tenant has *"Users can register
> applications"* switched off. Part A goes to the administrator as well; send
> them this whole document rather than just Part B.

---

## Part B — Grant admin consent

**This is the ask. Everything else is preparation.**

On the app's **API permissions** page there is a button:

> **Grant admin consent for NextGEN360 Ltd**

It requires **Global Administrator**, **Privileged Role Administrator** or
**Cloud Application Administrator**. Once clicked, the permission's status
changes to **"Granted for NextGEN360 Ltd"** with a green tick.

Until then every call fails with a `401` or `403` that looks exactly like an
application bug.

### What to say when you ask

Copy this to whoever administers the tenant:

> I need admin consent granted on an Entra app registration called
> **OLC Production Board (read-only)**.
>
> It's an internal dashboard that displays Business Central production data on
> screen — read-only, no writes to BC at all. It reads as a service account
> rather than as each viewer, so it doesn't need a licence per person looking
> at it.
>
> The permission is `API.ReadWrite.All` on Dynamics 365 Business Central. **The
> name overstates it.** Microsoft doesn't publish a read-only variant of this
> scope — it grants access to the BC API surface, and what the app can actually
> do is controlled separately by the permission set assigned to it *inside*
> Business Central. I'm assigning `D365 READ`, which is read-only. You can
> verify that yourself in BC under **Microsoft Entra Applications** after the
> app is enabled.
>
> Nothing happens until you grant consent — the app can't reach any data before
> that point.

---

## Part C — Register the app inside Business Central

**This is where read-only is actually enforced.** Part B opened the door; this
decides which rooms the app can enter.

- [ ] In BC, press **Alt+Q** and search **"Microsoft Entra Applications"**
      (called *Azure Active Directory Applications* on older versions)
- [ ] **New**
- [ ] **Client ID**: paste the Application (client) ID from Part A
- [ ] **Description**: `Production board - read only`
- [ ] Set **State = Enabled** (BC may prompt for a consent step here — accept it)
- [ ] In the **User Permission Sets** subpage, add a **read-only** permission set:
      - `D365 READ` — the standard read-only set. Simplest correct choice.
      - Or a custom set granting **Read** on only tables 5405, 5407 and 5409,
        if you want tighter scope.

> **Do not assign `SUPER`.** It will work, and it gives an unattended service
> full write access to the entire ERP. `D365 READ` is the whole point of doing
> Part C properly.

---

## Configure the app

Create `.env.local` in the project root (it is gitignored — never commit it):

```ini
BC_TENANT_ID=8616734f-e2d9-4f2c-ad38-2c7635809074
BC_CLIENT_ID=<Application (client) ID from Part A>
BC_CLIENT_SECRET=<secret Value from Part A>
BC_ENVIRONMENT=Production
BC_COMPANY=Own Label Ceations
```

That is all four values plus the environment. The three web service names are
built in as defaults and only need setting if a service is ever renamed —
see `WEB-SERVICES.md`.

Restart the app. The "Not connected" notice is replaced by data, and the stamp
at the top right reads **Business Central**.

### Verify

```bash
npm run dev
curl -s http://localhost:3000/api/production-orders | head -c 200
```

`"source":"business-central"` means it worked. `"source":"not-configured"` means
one of the values above is missing or empty — the app says so rather than
crashing, by design.

Check the other two feeds as well, since they are separate services and can fail
independently:

```bash
curl -s http://localhost:3000/api/prod-order-components | head -c 120
curl -s http://localhost:3000/api/prod-order-routing    | head -c 120
```

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Still says `not-configured` | One of the five env vars is unset. All are required before a real call is attempted. Restart after editing `.env.local`. |
| `401 Unauthorized` from Entra | Wrong client ID, wrong secret, or the secret has expired. |
| `401` from BC (token was fine) | Part C not done — the app exists in Entra but BC doesn't know it. Check **State = Enabled**. |
| `403 Forbidden` from BC | Permission set missing or too narrow. Check the User Permission Sets subpage in Part C. |
| `404 Not Found` | `BC_COMPANY` doesn't match, or a service was renamed. The company must match BC's spelling exactly — including the missing "r" in "Own Label Ceations". |
| One page has data, another is empty | Those are separate web services. Check that one is still published under the name in `WEB-SERVICES.md`. |
| A whole column is blank | The service exposes that field under a different name. See the renaming note in `WEB-SERVICES.md`. |
| Consent shows "Not granted" | Part B hasn't been done. |
| Worked for months, now `401` | The client secret expired. See below. |

---

## Secret rotation

Client secrets expire — typically 6, 12 or 24 months depending on tenant policy.
When one lapses the board simply stops, months later, with an auth error and no
warning beforehand.

- Record the expiry date somewhere you will actually see it
- To rotate: create a **new** secret in Part A, update `BC_CLIENT_SECRET`,
  restart, confirm it works, then delete the old secret
- Both secrets are valid simultaneously, so there is no outage if you do it in
  that order

A certificate instead of a secret avoids this, at the cost of a more involved
setup. Worth considering if this board becomes something people depend on.

---

## Why it is built this way

- **One service identity, many viewers.** The app reads BC as itself, so adding
  viewers costs nothing. This is the reason it isn't a Power Apps code app —
  that needs a Premium licence *per viewer* for a screen people only look at.
- **Read-only throughout.** No code path writes to BC, and the permission set
  enforces it independently of the code.
- **Web service, not an extension.** Publishing a page on BC's Web Services
  screen is configuration, not a deployment — no production extension rights
  needed.

See `CLAUDE.md` for the wider design and known gaps — notably that the app
itself still has **no authentication**. Network reachability is not access
control.
