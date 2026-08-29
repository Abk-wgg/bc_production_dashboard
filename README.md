# Production board

A read-only web page showing Business Central production orders for **Own Label
Ceations** — the orders themselves, the components each one consumes, and a
day-by-day schedule split by work centre.

Anyone on the network opens a URL and looks at it. No licence per viewer, no
app to install, nothing to sign into (yet — see [Access](#access)).

## Three pages

| Page | Shows |
|---|---|
| **Production orders** | Every order, sortable and filterable, with the derived work centre. Export to Excel. |
| **Component list** | The materials on each order, including whether the warehouse has picked them. |
| **Schedule** | One day at a time, orders grouped into a column per work centre. |

## How it gets the data

```
   Business Central (Production)
   tables 5405 / 5407 / 5409
            │
            │  pages published on BC's "Web Services" screen
            │  (configuration — no extension deployment)
            ▼
   OData v4 endpoints
            │
            │  one Entra app registration, client credentials.
            │  The app reads BC as ITSELF, not as each visitor.
            ▼
   this app  ──►  browser (plain HTML, no BC access from the client)
```

Three things follow from that shape, and they are the whole reason it is built
this way:

- **Viewers cost nothing.** One identity reads BC no matter how many people have
  the page open. Responses are cached for 60 seconds, so twenty viewers are one
  call a minute, not twenty calls a refresh.
- **Nothing is deployed into BC.** Publishing a page as a web service is a
  setting, not a deployment, which matters because production does not allow AL
  extension deploys.
- **The browser never sees a credential.** All BC traffic happens server-side.

## Getting it running

```bash
npm install
cp .env.example .env.local     # then fill in the three Entra values
npm run dev                    # http://localhost:3000
```

Without credentials the app still starts — every page renders and says which
environment variable is missing rather than failing. That is deliberate: a
missing setup step should be legible, not a stack trace.

`BC-SETUP.md` walks through the Entra app registration end to end.
`WEB-SERVICES.md` records which BC pages are published and what they contain.

## Deploying

```bash
npm run build
```

`output: "standalone"` means the build produces a self-contained server. Copy
these to the internal box and run it:

```
.next/standalone/     →  the server and only the node_modules it needs
.next/static/         →  into .next/standalone/.next/static/
public/               →  into .next/standalone/public/
.env.local            →  alongside server.js
```

```bash
node server.js         # listens on PORT, default 3000
```

## JSON feeds

For Excel and Power BI, so neither has to grow its own BC connection:

| Endpoint | Returns |
|---|---|
| `/api/production-orders` | Orders with work centre attached |
| `/api/prod-order-components` | Components; `?order=OLCRELPROD100` narrows to one |
| `/api/prod-order-routing` | Routing lines (operations) |

## Tests

```bash
npm test
```

Covers the pure logic — the work-centre derivation, the schedule grouping, the
overdue and outstanding rules. No BC access needed, so these run before the
Entra registration exists.

## Access

**There is none yet.** Anyone who can reach the URL can read the board. Network
reachability is not access control, and this is the main outstanding gap. The
intended fix is Entra sign-in via Auth.js, which needs an app registration but
no Azure subscription.
