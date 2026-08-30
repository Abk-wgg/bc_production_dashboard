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
- Auth.js v5 (`next-auth@beta`) with the Microsoft Entra ID provider, JWT
  sessions, no database.
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
- `src/lib/board.ts`, `work-center.ts`, `schedule.ts`, `floor.ts`, `format.ts` —
  pure derivations, no BC access.
- `src/components/` — client components. `data-table.tsx` is the shared sortable
  and filterable table with Excel export; pass it `expand` and every row opens a
  detail panel underneath.
- `src/app/api/*` — the same data as JSON, for Excel and Power BI.
- `src/auth.ts` + `src/middleware.ts` — who may look at the board. Entirely
  separate from how the app reads BC; see the note at the top of `auth.ts`.

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

### What is in scope (`src/lib/scope.ts`)

Two rules decide which rows exist at all. They are applied in the **data layer**,
so the tables, the schedule and the JSON feeds cannot disagree.

- **Orders: `Location Code = PRODUCTION` only.** The other location, TRADE, is
  bought-in and labelling work — real orders, but not this board, and they
  outnumber production roughly fifteen to one.
- **Components: manually flushed only** (`Flushing Method = Manual`, option 0).
  Forward and backward flushed lines are consumed by BC automatically, so nobody
  works from them. In the current data this removes about 46% of component lines.

Both rules accept the option index or the caption, and an unreadable flushing
method is treated as Manual — hiding a line because we could not parse it would
remove real work from the board.
- **Work centre comes from the routing line, not the order.** Table 5405 has no
  work centre. `PRINTING` is excluded from the derived value — it runs on nearly
  every order, so including it would collapse the schedule into one column.
- **The whole board runs on planned dates, not due dates.** A production board
  answers "what runs when"; the due date answers "what is owed when". On all 982
  open orders the due date is simply the planned end plus a day (962 of them
  exactly one day, the rest carried over a weekend), so judging lateness on it
  would call a late order on time for a day.
  - The schedule groups on the routing line's `Starting Date`; the card shows
    the planned end, flagged red once it has passed.
  - The Production orders table leads with **Planned start** and **Planned end**
    and sorts on planned start. "Behind plan" means past the planned end and not
    finished. The due date is still a column, well to the right — it is a real
    commitment, it just does not drive anything.
  - The component "Due Date" (5407) is not a promise either: on every row checked
    it is exactly the parent order's planned start, so the column is labelled
    **Needed**.
- **`NETVAPS Earliest Start Date` and `NETVAPS EMAD` are empty** on all 980
  routing lines sampled — same trap as `Finished Quantity`. The VAPS output that
  *is* populated: `Starting Date`, `Ending Date`, and `NETVAPS Scheduled`
  (true on 752 of 980).
- OData renames fields when a page is published: `"Sales Order No."` arrives as
  `Sales_Order_No`. The mappers try several spellings rather than hard-coding
  one and rendering a column of blanks.
- **`Finished Quantity` (5405) read 0 on every row sampled.** Treat it as
  unpopulated, not as evidence nothing is finished. "Outstanding" is derived
  from `status`, never from this field.
- `NETVAPS Scheduled` exists on both 5405 and 5409. VAPS is the scheduling
  add-on.
- **Floor status comes from the button presses, not a field.** BC has no "is
  this running" flag. Table 50403 (`Prod_Order_Data_Entry_Excel`) logs every
  press — Start, Pause, Restart, Complete, QA Book — and the order's state is
  the LAST one, ties broken on entry number. `Complete` is a booking, not the
  end of the order, so it still reads as Running. The rules are in
  `src/lib/floor.ts` and match the shop floor's own picking control board on
  979 of 982 orders; the three that differ have a blank timestamp in that
  board's export.
- **`Line Leader` (the operator's name) is deliberately absent from the
  snapshot.** The mapper reads it and the board shows it, so it appears as soon
  as the app reads BC live; the snapshot is a file that leaves the server, and
  employee names do not belong in it.

## Conventions

- Secrets live in `.env.local` (gitignored). Never put `NEXT_PUBLIC_` on
  anything credential-related.
- New external integrations go in `src/lib/`, not in components or routes.
- Pages stay server components; interactivity lives in `src/components/`.
- A source that is not configured returns a `not-configured` result and the page
  explains itself. Only a genuine failure throws.

## Known gaps (deliberate, not oversights)

- **No roles.** Sign-in is in place (Auth.js + Entra, tenant-restricted), but
  everyone who can sign in sees the same board. Add a `signIn` callback in
  `src/auth.ts` if that ever stops being true.
- Needs one Entra app registration with admin consent and a BC permission set
  before it can read live data (`BC-SETUP.md`), plus a second, separate
  registration for sign-in (`AUTH-SETUP.md`).
- Tests cover the pure modules only (`npm test`). Nothing exercises the BC
  mappers, because that needs live credentials.
- Errors go to the console only; no logging destination decided.

## Commands

```
npm install
npm run dev      # http://localhost:3000
npm run build    # produces .next/standalone
npm start
npm test         # pure logic, no BC access needed
```
