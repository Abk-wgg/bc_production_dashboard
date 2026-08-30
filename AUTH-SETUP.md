# Signing in to the board

How viewers sign in with their Microsoft work account. One-time setup, and
simpler than `BC-SETUP.md` — this one usually needs no administrator.

## Two registrations, two different jobs

This trips people up, so it is worth being explicit. The app talks to Entra
twice, for unrelated reasons:

```
  BC-SETUP.md          the app  ──── reads ────►  Business Central
  (service identity)             as ITSELF
                                 application permissions, no redirect URI,
                                 needs ADMIN CONSENT

  AUTH-SETUP.md        a person ──── signs in ──►  the app
  (sign-in app)                  as THEMSELVES
                                 delegated sign-in, has a redirect URI,
                                 usually no admin needed
```

They stay separate on purpose. A viewer signing in proves **who they are** —
it does not give them any Business Central access, and their own BC permissions
are never consulted. **Viewers do not need a BC licence.** That is the whole
economic point of the board.

---

## Part A — Create the sign-in app registration

At **entra.microsoft.com**:

- [ ] **App registrations → New registration**
- [ ] Name: `OLC Production Board (sign-in)` — deliberately different from the
      BC one, so nobody edits the wrong registration in a year's time
- [ ] Supported account types: **Accounts in this organizational directory only**
- [ ] **Redirect URI**: platform **Web**, and add both:
      - `http://localhost:3000/api/auth/callback/microsoft-entra-id` (local dev)
      - `http://<internal-server>/api/auth/callback/microsoft-entra-id` (the real one)

      The path matters exactly as written. `microsoft-entra-id` is the provider
      id, not a name you choose.
- [ ] **Register**
- [ ] Copy the **Application (client) ID** → `AUTH_MICROSOFT_ENTRA_ID_ID`
- [ ] **Certificates & secrets → New client secret** → copy the **Value**
      immediately → `AUTH_MICROSOFT_ENTRA_ID_SECRET`

  > Shown once. Navigate away and it is gone. Note the expiry date too — when
  > it lapses, sign-in stops with no warning.

No API permissions to add. Sign-in uses `openid profile email User.Read`, which
Entra grants by default and a user can consent to for themselves.

> **If your tenant has switched off user consent**, the first person to sign in
> sees "Approval required". An administrator clicks **Grant admin consent** once
> on the registration and it never comes up again.

---

## Part B — Configure the app

Add to `.env.local`:

```ini
AUTH_SECRET=<generate it, see below>
AUTH_MICROSOFT_ENTRA_ID_ID=<Application (client) ID from Part A>
AUTH_MICROSOFT_ENTRA_ID_SECRET=<secret Value from Part A>
```

Generate the secret — this is what signs the session cookie, so it must be
random and must never be committed:

```bash
npx auth secret
```

The tenant defaults to `BC_TENANT_ID`, which is what restricts sign-in to Wilson
George accounts. Override with `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` only if the
two ever need to differ.

Restart, open the app, and you should be bounced to `/signin`.

---

## Who can get in

**Anyone with an account in the tenant.** The single-tenant issuer is the only
gate — no allow-list, no group check, no role.

That is a deliberate choice for a read-only production board that everyone
internally is meant to see. It is *not* enough if the board ever shows something
not everyone should see. Tightening it is a `signIn` callback in `src/auth.ts`
checking group membership or an allow-list — worth doing at that point, not
before.

---

## Excel and Power BI

Every page and every JSON feed now needs a signed-in browser session, which a
scheduled Excel refresh cannot hold. Two options:

**Keep pulling from BC directly.** The existing OData connections in your
workbooks are unaffected — they authenticate as you, straight to BC, and never
touch this app.

**Or give the machine a key.** Set `BOARD_API_KEY` to a long random string, and
the JSON feeds also accept it as an `x-api-key` header:

```bash
curl -H "x-api-key: <the key>" http://<server>/api/production-orders
```

Unset, that path does not exist and the feeds are session-only. A key is a
shared password with no expiry and no audit trail — use it only where a real
session is impossible, and treat it like the client secret.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `AADSTS50011: redirect URI mismatch` | The redirect URI in Part A does not match the URL you opened, character for character. Check http vs https, port, and trailing path. |
| Redirect loop between `/` and `/signin` | `AUTH_SECRET` is unset or differs between restarts, so the cookie can never be read back. |
| `UntrustedHost` | Auth.js does not recognise the hostname. The app sets `trustHost: true` for internal hosting; if you removed it, put it back or set `AUTH_TRUST_HOST=true`. |
| "Approval required" on first sign-in | User consent is off in the tenant. An admin grants consent once. |
| Signs in, immediately signed out | Usually the session cookie exceeding 4KB. The app already strips the profile photo for this reason. |
| Worked for months, now fails | The client secret expired. Create a new one and update `.env.local`. |
| Excel refresh returns HTML or 401 | Expected — see the section above. |

---

## What this does not do

Sign-in says **who** someone is. It does not yet say **what** they may see —
everyone signed in sees the same board, and there are no roles. The earlier
Power Apps prototype had `app_admin` / `app_viewer` roles, but those were
Dataverse security roles and do not carry over.
