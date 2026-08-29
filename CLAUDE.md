# Project context

Read-only production board for Wilson George (BC company **Own Label Ceations**;
the Entra tenant is still named NextGEN360 after the rebrand). Shows Business
Central production orders, their components and a day-by-day schedule. Hosted on
internal infrastructure — not Vercel, not Azure.

## Why it is built this way

The constraints are the design. Check any change against all of them at once.

- **Read-only.** Nothing writes to BC. The worst a bug can do is put a wrong
  number on a screen, not corrupt production data.
- **One service identity, many viewers.** The app reads BC as itself via Entra
  client credentials, so adding a viewer costs nothing. This is why it is not a
  Power Apps code app — that needs a Premium licence *per viewer* for a screen
  people only look at.
- **No AL extension deploys in production.** Data comes from pages published on
  BC's **Web Services** screen, which is a configuration action. An earlier
  prototype used a custom AL extension plus Dataverse virtual tables; that only
  ever worked in sandbox.
- **No Azure subscription.** App Service and VMs are unavailable, so hosting is
  a Windows box on the network.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript strict. No CSS framework —
  one hand-written `globals.css`.
- `output: "standalone"` — deploy by copying `.next/standalone`, `.next/static`
  and `public/` to the server and running `node server.js`.
- Only runtime dependency beyond React/Next is `xlsx`, loaded on demand for the
  Excel export.

## Structure

- `src/lib/bc/` — **the only code that talks to BC.** Every file is
  `server-only`. `client.ts` holds the token and the OData fetch; `orders.ts`,
  `components.ts` and `routing.ts` map one table each.
- `src/lib/types.ts` — row shapes. Deliberately outside `bc/`: a client
  component importing a type from a `server-only` module would drag the server
  code into the browser bundle.
- `src/lib/board.ts`, `work-center.ts`, `schedule.ts`, `format.ts` — pure
  derivations, no BC access.
- `src/components/` — client components. `data-table.tsx` is the shared sortable
  and filterable table with Excel export.
- `src/app/api/*` — the same data as JSON, for Excel and Power BI.

## BC specifics

Three published web services, all on the **Production** environment:

| Table | What | Service name |
|---|---|---|
| 5405 | Production Order headers | `Production_Order_List_Excel` |
| 5407 | Prod. Order Components | `prod_order_comp_with_pick` |
| 5409 | Prod. Order Routing Lines | `Prod_Order_Routing_Excel` |

- **Routing lines are table 5409, not 5410.** 5410 is "Prod. Order Capacity
  Need". The earlier Power Apps prototype's AL page commented it as 5410 and got
  away with it because AL resolves `SourceTable` by name.
- `Status` option: 0 Simulated, 1 Planned, 2 Firm Planned, 3 Released,
  4 Finished. Released is what the shop floor works to.
- **Work centre comes from the routing line, not the order.** Table 5405 has no
  work centre. `PRINTING` is excluded from the derived value — it runs on nearly
  every order, so including it would collapse the schedule into one column.
- OData renames fields when a page is published: `"Sales Order No."` arrives as
  `Sales_Order_No`. The mappers try several spellings rather than hard-coding
  one and rendering a column of blanks.
- **`Finished Quantity` (5405) read 0 on every row sampled.** Treat it as
  unpopulated, not as evidence nothing is finished. "Outstanding" is derived
  from `status`, never from this field.
- `NETVAPS Scheduled` exists on both 5405 and 5409. VAPS is the scheduling
  add-on.

## Conventions

- Secrets live in `.env.local` (gitignored). Never put `NEXT_PUBLIC_` on
  anything credential-related.
- New external integrations go in `src/lib/`, not in components or routes.
- Pages stay server components; interactivity lives in `src/components/`.
- A source that is not configured returns a `not-configured` result and the page
  explains itself. Only a genuine failure throws.

## Known gaps (deliberate, not oversights)

- **No authentication.** Network reachability is not access control. The
  intended next step is Entra sign-in (Auth.js Microsoft Entra provider) — free,
  no Azure subscription needed, just an app registration.
- Needs one Entra app registration with admin consent and a BC permission set
  before it can read live data. See `BC-SETUP.md`.
- No test suite yet. The pure modules (`board`, `work-center`, `schedule`) are
  the ones worth covering first.
- Errors go to the console only; no logging destination decided.

## Commands

```
npm install
npm run dev      # http://localhost:3000
npm run build    # produces .next/standalone
npm start
```
