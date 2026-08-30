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
- **Each page owns one hue, declared once and read everywhere** — orders rust,
  components green, schedule blue, vendors purple. The semantic colours already
  hold green, amber, red and teal, so a fifth page must not reuse one or its
  tint starts reading as a status.
  - Four cues, one colour: the **accent** inside the page, the **plane** behind
    it, the **header bar** and the current **tab** in the nav, and the page's
    own **favicon and title** in the browser's tab strip.
  - `--plane`, `--page-accent` and `--page-soft` are set on `<body>` through
    `:has(.page-*)`, and those three declarations are the entire per-page
    treatment — nothing downstream knows which page it is on. `<body>` rather
    than the page itself because the background that covers the window is the
    body's, the page class is on `<main>`, and a custom property cannot travel
    up the tree. Without `:has()` everything falls back to neutral and the
    favicon still carries.
  - So adding a page means adding a `--<page>-accent/-soft/-plane` triple to
    `:root` plus one `body:has()` block — never a bare `--accent` on the page
    class. The header is outside `<main>` and can only see global tokens.
  - **Floor-state colours are the exception: they are global, never page-tinted.**
    Running, Complete, Paused and Not started hardcode theirs, and QA booked now
    has its own `--qa-ink` for the same reason. Built from `--accent` it was
    rust on orders - a warm tone sitting beside Paused's amber - and blue on the
    schedule. A state that changes colour by page is not a state you can read by
    colour, which is the only thing a 12px pill is for.
  - **The header's accent band is 1px of border plus a 2px inset shadow, not a
    3px border.** `--header-h` is a fixed 54px that every sticky bar offsets
    against; a thicker border makes the header taller and leaves them all 2px
    adrift, showing content scrolling behind. An inset shadow costs no height.
  - **The browser's tab strip is not ours to paint.** Four `icon.svg` files,
    one per route segment, same glyph in the page's hue — at 16px colour is the
    only difference a tab can carry, and an identical glyph is what still reads
    as one app. Titles are `"%s · Production board"` with the page's own name
    first, because four open tabs truncate from the right. `viewport.themeColor`
    is set per page but only shows in an installed app window.
- Auth.js v5 (`next-auth@beta`) with the Microsoft Entra ID provider, JWT
  sessions, no database.
- `output: "standalone"` — deploy by copying `.next/standalone`, `.next/static`
  and `public/` to the server and running `node server.js`.
- Only runtime dependency beyond React/Next is `xlsx` — on demand in the browser
  for the Excel export, and on the server to read the BC warehouse workbooks.

## Structure

- `src/lib/bc/` — **the only code that talks to BC.** Every file is
  `server-only`. `client.ts` holds the token and the OData fetch; `orders.ts`,
  `components.ts` and `routing.ts` map one table each.
- **Three data sources, in this order: live BC, then the warehouse workbooks
  (`workbook.ts`), then the bundled snapshot.** Live credentials always win, so
  no offline source can mask a broken connection. The workbook beats the
  snapshot because it is complete where the snapshot is capped at 1000 rows a
  table. All three go through the same mappers — the workbook columns are
  already in published-web-service form, because Power Query pulled them from
  the same web services.
- `src/lib/types.ts` — row shapes. Deliberately outside `bc/`: a client
  component importing a type from a `server-only` module would drag the server
  code into the browser bundle.
- `src/lib/board.ts`, `work-center.ts`, `schedule.ts`, `floor.ts`, `format.ts` —
  pure derivations, no BC access.
- `src/components/` — client components. `data-table.tsx` is the shared sortable
  and filterable table with Excel export; pass it `expand` and every row opens a
  detail panel underneath.
  - **Every column needs a `width`.** The outer table is `table-layout: fixed`,
    so the colgroup decides the columns and the browser never measures a cell.
    A column without one splits whatever is left, which is only predictable if
    at most one column does it.
  - That is a performance rule, not a style one. Under auto layout, opening a
    panel was slow enough to complain about: the detail row spans every column,
    and auto layout answers that by re-measuring the whole table — 703 rows of
    13 cells — then repositioning the sticky headers, on open and again on
    close. Fixed layout makes opening a row cost that row.
  - React memoisation was tried first and was not the problem. The rows are
    memoised anyway and it is worth keeping, but the cost was browser layout,
    which no amount of it touches. The diagnostic that settled it: filter the
    table down to a handful of rows and see whether opening is instant.
  - `expand` and `columns` must keep stable identities or the memo is dead. An
    inline arrow for `expand` undoes it silently — there is no symptom except
    the slowness returning.
- `src/app/api/*` — the same data as JSON, for Excel and Power BI.
- `src/auth.ts` + `src/middleware.ts` — who may look at the board. Entirely
  separate from how the app reads BC; see the note at the top of `auth.ts`.

## BC specifics

Nine published web services, all on the **Production** environment. The first
three drive the board; the rest fill in the chain around an order:

| Table | What | Service name |
|---|---|---|
| 5405 | Production Order headers | `Production_Order_List_Excel` |
| 5407 | Prod. Order Components | `prod_order_comp_with_pick` |
| 5409 | Prod. Order Routing Lines | `Prod_Order_Routing_Excel` |
| 50403 | Shop-floor button presses | `Prod_Order_Data_Entry_Excel` |
| 5517495 | Lot-level stock | `Inventory_Summary_Excel` |
| 39 | Purchase order lines | `Purchase_Order_Line_Excel` |
| 36 | Sales orders | `sale_order_list_custom_ab` |
| 37 | Sales lines | `Sales_Lines_Excel` |
| 27 | Item master | `Item_Card_Excel` |
| 23 | Vendor cards | (workbook only, see below) |

Over 200 services are published in total, so almost anything else the business
wants is already reachable without publishing something new.

**More than one page is published over the same table**, with different field
sets — 5409 has both `Prod_Order_Routing_Excel` and `Prod_Order_Routing_Lines_Excel`,
5407 has `prod_order_comp_with_pick`, `Prod_Order_Comp_Lines_Excel` and
`prod_comp_with_picked_qty`. They are not interchangeable: a `$select` naming a
field the chosen page does not carry fails the whole request with a bare 400
that never says which field. Check with `?$top=1` and no `$select` first.

- **Routing lines are table 5409, not 5410.** 5410 is "Prod. Order Capacity
  Need". The earlier Power Apps prototype's AL page commented it as 5410 and got
  away with it because AL resolves `SourceTable` by name.
- `Status` option: 0 Simulated, 1 Planned, 2 Firm Planned, 3 Released,
  4 Finished. Released is what the shop floor works to.

### What is in scope (`src/lib/scope.ts`)

Three rules decide which rows exist at all. They are applied in the **data
layer**, so the tables, the schedule and the JSON feeds cannot disagree.

- **Released only, everywhere.** Simulated, Planned and Firm Planned are not
  real work yet; Finished is over. Released is what the shop floor works to.
  - This used to be a **`Released only` toggle on each of the three tables**,
    defaulted on. Three components owned one rule between them, which is how
    they come to disagree, and the JSON feeds had no copy of it at all — so
    Excel and Power BI saw a wider board than the screen did.
  - Removing the buttons changed nothing on screen. All 982 order headers are
    already Released, because the feed is the `Released_Production_Order_Excel`
    sheet, so the toggle was a no-op on two of the three tables. On components
    it dropped 4 lines, all on `OLCRELPROD303`. The JSON feed for components
    went 1,961 → 1,957 to match.
  - **Routing lines are deliberately not filtered.** 360 of 1,340 read
    Finished, but 358 of those belong to orders that are not on the board at
    all, so they join to nothing. The remaining 2 are the only routing lines
    their orders have — filtering would strip `OLCRELPROD303` and
    `OLCRELPROD856` of a work centre to hide nothing.
- **Orders: `Location Code = PRODUCTION` only.** The other location, TRADE, is
  bought-in and labelling work — real orders, but not this board, and they
  outnumber production roughly fifteen to one.
- **Components: manually flushed only** (`Flushing Method = Manual`, option 0).
  Forward and backward flushed lines are consumed by BC automatically, so nobody
  works from them. In the current data this removes 54% of released component
  lines and keeps 46% — 1,957 of 4,259. (An earlier note had those the wrong way
  round.)

Both rules accept the option index or the caption, and an unreadable flushing
method is treated as Manual — hiding a line because we could not parse it would
remove real work from the board.
- **Work centre comes from the routing line, not the order.** Table 5405 has no
  work centre. `PRINTING` is excluded from the derived value — it runs on nearly
  every order, so including it would collapse the schedule into one column.
- **Nothing on this board is a trade work centre.** Ten centres exist —
  `PROD-1` to `PROD-7`, `PROD-SHORTFILL`, `UNPLANNED`, `OUTSIDE-LINE` — and all
  982 orders sit at Location Code PRODUCTION, because `scope.ts` already
  excluded the TRADE location upstream. The work-centre production/trade split
  was a second, weaker implementation of a distinction the scope rule had
  already made. `categorise` now treats every centre as production unless it is
  named in `TRADE_CENTERS`, which is empty.
  - The old rule was `startsWith("PROD")`, a naming convention rather than a
    fact. It filed `UNPLANNED` (236 orders) and `OUTSIDE-LINE` (176) under
    Trade — 42% of the board — where nobody filtering to Production would see
    them. Defaulting the other way matters: an unrecognised centre now appears
    with the production work where someone will notice it.
  - That left the Production / Trade buttons dead — one showing everything, the
    other an empty board — so **they were replaced with a work-centre dropdown**:
    a checklist, one row per centre with its order count. It answers the real
    questions the two buttons could not: hide UNPLANNED and OUTSIDE-LINE, or
    look at PROD-1 alone. `categorise` survives only to order the columns, which
    is now "assigned, then no work centre".
  - Not a native `<select multiple>`: that needs ctrl-click to deselect, which
    nobody discovers, and cannot carry the per-centre count. The count is what
    makes hiding a centre a decision rather than a guess.
  - It stores which centres are **switched off**, not which are on, so a centre
    appearing in BC tomorrow shows up by default rather than being silently
    absent. The list is built from all the orders, not one day's, so the control
    does not rearrange itself as you page through days. An order spanning two
    centres survives one being hidden — it genuinely needs both.
- **So does the routing number**, for a different reason: 5405 *does* carry one,
  and it is wrong. The header reads `ERROR_ROUTE` on 669 of 982 released orders
  where the lines for those same orders read it on 26. `buildRoutingNoMap` in
  `work-center.ts` takes the line's value and falls back to the header only for
  the 2 orders that have no routing line. PRINTING is **not** excluded there —
  it distorts "where does this run", but not "which routing is this on".
- **The whole board runs on planned dates, not due dates.** A production board
  answers "what runs when"; the due date answers "what is owed when". On all 982
  open orders the due date is simply the planned end plus a day (962 of them
  exactly one day, the rest carried over a weekend), so judging lateness on it
  would call a late order on time for a day.
  - The schedule groups on the routing line's `Starting Date`; the card shows
    the planned end, flagged red once it has passed.
  - **It opens on today, not on day 1.** Two different questions get confused
    here: what is *visible* and what you *land on*. The "from" filter stays off,
    because defaulting it to today would hide the 394 orders whose planned start
    has already passed — a schedule that silently omits every late order looks
    reassuringly empty. But the landing day is today (or the next day with
    work), because the earliest day in the data is a single stalled April order:
    day 1 of 57, fifty clicks from the day anyone came to look at. Previous
    still walks back through the whole backlog. `initialDayIndex` in
    `schedule.ts`.
  - The Production orders table leads with **Planned start** and **Planned end**
    and sorts on planned start. "Behind plan" means past the planned end and not
    finished. The due date is still a column, well to the right — it is a real
    commitment, it just does not drive anything.
  - The component "Due Date" (5407) is not a promise either: it is the parent
    order's planned start on 1,923 of 1,957 manually-flushed released lines, so
    the column is labelled **Needed**. Nearly always, not always — 34 differ.
- **Components by vendor pages through weeks, a vendor per row** (`/vendors`).
  Same 1,957 component lines the Component list groups by order, grouped
  instead by who supplies the item and the week the work runs. Two questions,
  one dataset: "can this order run" and "what do I owe this supplier, and when".
  - **The week is a pager, not a column.** It started as a Week column in the
    table, which made every row repeat the same date and asked the reader to
    filter their way to one week. The question is asked one week at a time, so
    the week moved into a bar above the table — the schedule's day bar, one
    unit up, reusing `.day-bar` because it is the same object with a different
    unit. Previous still walks back through the whole backlog.
  - **It opens on the week you are standing in**, not the earliest. A week
    counts as current until its *Sunday* has gone, so mid-week you land on the
    week you are in rather than being pushed into the next one — the
    distinction that a naive "first Monday >= today" gets wrong six days out of
    seven. `initialWeekIndex` in `weeks.ts`, mirroring `initialDayIndex`.
  - The **week list is built from all the lines, not the filtered ones**, so
    switching on "Short only" cannot remove weeks from under the pager and move
    you somewhere else. Same reasoning as the schedule's work-centre list.
  - The Excel export is **that week**, because the week is the filter. Every
    week at once is `/api/vendor-weeks`, which is not paged.
  - **The date box sits in the week bar and decides which weeks exist**;
    Previous and Next then walk what is left. A week matches when ANY of its
    days does, not when its Monday does — typing `300826`, a Sunday, has to
    find the week you are in rather than nothing. `cm` therefore returns the
    six weeks that *touch* August, including the two that straddle its ends,
    and the bar reports the span in **whole weeks** (27 Jul – 6 Sep) because
    that is what is on screen; naming the month would describe a narrower
    period than the pager covers.
  - **The panel is two levels: items, then the orders behind each item.** A
    buyer is about to raise a purchase order, and a purchase order has one line
    per item, not one per production order. Four orders needing 143 KG of the
    same liquid is one line of 572 KG to the vendor.
    - **This is also the only correct place to compute a shortage.** Stock is
      the *item's*, and every line of that item carries the same figure — so
      line by line, all four of those orders see the same 150 KG and each
      decides it is covered, while the week is 422 KG down. Summing `available`
      across lines would report 600 KG on a shelf holding 150.
      `groupLinesByItem` compares total demand against one pool.
    - Short items lead, then the biggest quantity, then item number — the first
      two are what needs acting on, the last keeps related codes together once
      nothing is urgent.
  - **Remaining carries its unit in brackets, and a mixed week is split rather
    than summed.** 82 of 83 vendor-weeks use a single unit and read
    `12,681.926 (KG)`. The one that does not is 94,500 EACH plus 1,047 KG,
    which a plain total reported as 95,547 of nothing in particular. Every item
    uses exactly one unit, so the mixing only ever happens at vendor level.
  - **The vendor row's quantity is shortened; nothing else is.** A column of
    six-digit numbers is not comparable at a glance, so the summary reads
    `794k (EACH)` and `14.04 t`. That is safe *only there*: a vendor's weekly
    total is a magnitude, and nobody orders 621,073 of something in one line.
    The item quantities in the panel are what gets transcribed onto a purchase
    order and stay exact, as do `cell()` — which is what the Excel export and
    the column filter read — and the JSON feed. So nothing acted on or
    reconciled against BC is ever a rounded figure, and the exact value is on
    the cell's `title` either way. Kilos become tonnes because that is how a
    tonne is talked about; counts keep their unit and take k/M, because there
    is no larger unit of bottle. `compactQuantity` in `format.ts`.
  - **The supplier comes from `Vendor No.` on the item card (table 27).** It is
    the only place BC records who supplies a material, and it is well
    maintained: 7,396 of 10,354 items carry one, 8,261 of which are
    Replenishment System = Purchase. On the board it resolves **1,796 of 1,957
    component lines — 92%** — to **26 vendors**.
  - **An early sample said 0 of 1,000 items had a vendor, and that was the
    ordering trap, not the truth.** Table reads come back in item-number order,
    and the first thousand items alphabetically are almost all manufactured
    (Replenishment System = Prod. Order), which correctly have no vendor.
    Anything that looks universally empty should be re-counted server-side with
    `aggregate_bc_table` before being written off. This is the second field to
    survive that check after `Finished Quantity` failed it.
  - The 8% with no vendor get **their own row labelled "No vendor set"**, plus a
    toolbar button that isolates them. A component nobody is recorded as
    supplying is a purchasing problem, and hiding it is the one thing this page
    must not do.
  - **The week is the parent order's planned start, not the component's Due
    Date.** The two agree on 1,923 of 1,957 lines, but the schedule groups on
    planned start, and a purchasing page that disagreed with the schedule about
    which week a job runs in would be worse than no page. `buildScheduledStartMap`
    is the same map the schedule uses. An order with no routing line falls back
    to the Due Date rather than dropping off a page whose axis is weeks.
  - Weeks are **Monday to Sunday with ISO 8601 numbering** (`src/lib/weeks.ts`),
    matching the `cw`/`lw` terms in the date language and the week the floor
    works to. ISO numbering is what puts late December in w01 and is what a
    paper wall planner shows.
  - Within a week, **the biggest commitment leads**. A buyer opens the page to
    see what to chase, not who sorts first alphabetically.
  - **Vendor names come from `Vendor card.xlsx`** in the `raw files` folder
    beside BC-FEED, found by `dirname` on `BC_WORKBOOK_FILE` so it needs no
    setting; `BC_VENDOR_WORKBOOK_FILE` overrides. It is the one feed the board
    can do without — a missing vendor list costs names, not rows, because the
    code stands in for the name.
  - `Vendor_No` and `Replenishment_System` had to be **added to the
    `Items_card_excel` Power Query's `$select`**. The published page carries
    only eleven fields and a `$select` naming one it does not have fails the
    whole request with a bare 400, so each addition is checked, not assumed.
- **The component list is one row per order, not one per line.** 1,957 lines
  collapse to 703 orders, median 2 lines each. Nobody picks "a component line" —
  they pick an order, and the question in front of them is whether it can run.
  The lines sit behind the row, in the same `expand` panel the orders page uses;
  `component-groups.ts` does the grouping and is pure,
  `order-components-panel.tsx` draws it.
  - **The filters narrow the lines, and only then are they grouped.** The other
    way round would count lines the filter had already excluded, so a row would
    disagree with its own panel about how many lines it has.
  - Prod. Order No. leads and is the default sort. The old first column was
    Location, which reads `PRODUCTION` on every row.
  - Order-level "Fully picked" is true only when every line is, and sorts on the
    proportion, so part-picked orders sit between untouched and finished rather
    than alphabetically among them.
  - `Next Delivery` comes from the **short** lines only. A covered line has an
    incoming PO too, and showing its date would read as waiting on a delivery
    when nothing is being waited on.
  - The Excel export follows what is on screen, so it is now one row per order.
    The line-level data is still whole at `/api/prod-order-components`.
  - It expands in place rather than opening over the top. A modal was tried and
    was wrong for this: the whole page is a list of orders, and reading down it
    means opening several in turn, which a modal makes you dismiss between.
- **`NETVAPS Earliest Start Date` and `NETVAPS EMAD` are empty** on all 980
  routing lines sampled — same trap as `Finished Quantity`. The VAPS output that
  *is* populated: `Starting Date`, `Ending Date`, and `NETVAPS Scheduled`
  (true on 752 of 980).
- OData renames fields when a page is published: `"Sales Order No."` arrives as
  `Sales_Order_No`. The mappers try several spellings rather than hard-coding
  one and rendering a column of blanks.
- **`Finished Quantity` on the 5405 HEADER read 0 on every row sampled.** Treat
  it as unpopulated, not as evidence nothing is finished. "Outstanding" is
  derived from `status`, never from this field.
  - **This is a header fact, not a table fact.** Real output does exist:
    `Posted Output Quantity` on the 5409 routing line is populated on 403 of
    1,340 lines and totals 795,468 for Released and 3,053,350 for Finished —
    reconciling to the unit with `Finished Quantity` on the 5406 order *line*.
    So the board can show genuine progress (8.4% of released volume made), not
    just a status label. Same for routing: `Routing No.` on the header reads
    `ERROR_ROUTE` on 669 of 982 orders, but on the routing line it is
    `ERROR_ROUTE` on only 26 — a real issue a consultant is chasing, not a
    two-thirds-of-the-board one. **When a field exists on both the header and
    the line, trust the line.**
- `NETVAPS Scheduled` exists on tables 5405, 5406 and 5409, but is **not exposed
  by any of the pages currently published** over them, so it arrives false. VAPS
  is the scheduling add-on.
- **Floor status comes from the button presses, not a field.** BC has no "is
  this running" flag. Table 50403 (`Prod_Order_Data_Entry_Excel`) logs every
  press — Start, Pause, Restart, Complete, QA Book — and the order's state is
  the LAST one, ties broken on entry number. The rules are in
  `src/lib/floor.ts` and match the shop floor's own picking control board on
  979 of 982 orders; the three that differ have a blank timestamp in that
  board's export.
- **How the floor actually uses the buttons** (from Abhishek, 2026-08-30 —
  none of this is derivable from the data):
  - **Output posts at the QA Book, not at the Complete.** That is why
    `Posted Output Quantity` on the 5409 routing line moves when it does.
  - **BC finishes the order at a QA Book once posted output passes 96% of the
    order quantity**, after posting that output. So an order still Released
    with QA Book as its last press either did not clear 96% or has more to run.
  - A Complete is usually the end of production. On a large order the floor
    completes and QA-books several times over, so the same order reads
    Complete, then QA booked, then Running again across its life.
- **`Complete` is its own state, not Running.** Five states, not four:
  Running, Complete, Paused, QA booked, Not started.
  - Folding Complete into Running was hiding most of that tile. Of the 41
    orders reading Running, **33 had Complete as their last press** and only 8
    had been started or restarted. The Completes were a median of **four days**
    old (max 13, only 3 within a day); the Starts, two.
  - 32 of those 33 have never been QA booked at all — that is the queue the
    state exists to show.
  - Teal, between Running's green and QA booked's blue, because that is where
    it sits in the process. `isOnTheLine` still counts it as touched, so the
    pick flag stays off it.
- **A started order has no picking problem, so the pick flag comes off it.**
  The floor cannot press Start until the components are picked, and picking
  moves that stock out of inventory — so the availability maths reads "no
  components available" and says the opposite of the truth. The schedule card
  drops the pick pill and the "N lines short" count once floor status is
  anything but Not started. Paused counts as started: it is only reachable
  through a Start. Applied in `src/app/schedule/page.tsx`, where the flag is
  never computed rather than computed and then hidden.
  - The data bears it out. Across the 94 orders the floor has touched, 90% of
    component lines have `Qty. Picked` above zero and 80% read `Completely
    Picked`. Across the 888 it has not touched, both are 5%.
  - **`Completely Picked` on the 5405 header is another header to distrust.**
    It reads false on all 94 started orders, while those same orders' own
    component lines read true on 80% of themselves. Third instance of the
    rule: when a field exists on the header and the line, trust the line.
  - **So the started order gets the other half of the question.** The stock
    maths answers "can this be picked" and is switched off above; BC's own
    `Completely Picked` on the LINE answers "is it picked yet", survives the
    stock having moved, and works after a Start. `pickProgressFor` in
    `chain.ts` counts lines with something left to consume that are not
    completely picked, and the card reads "3 lines still to pick" under the
    Running pill. On the current board that is **51 lines across 31 orders**.
    The two never both apply to one order - untouched orders get the pick
    state, started ones get this.
- **The red "Not started" pill is untouched AND past its planned start.** The
  state alone is true of 888 of the 982 orders on the board, so a red pill on
  nine cards in ten was decoration: nothing is learned by seeing it. Narrowed to
  orders whose planned start has already gone it marks **310**, and means
  "should have begun by now".
  - **The label does not change, only the emphasis** - it still reads what the
    floor's own picking control board calls it. Grey pill by default,
    `.fl-overdue` adds the red.
  - **No third function for it.** `isOnTheLine` in `floor.ts` is the floor half
    and `isLateToStart` in `board.ts` is the plan half; the callers compose the
    two. A named helper would have been a differently-named copy of a rule that
    already existed twice, and the name was already taken.
  - The five tiles still count every order, so they add up to the board. The
    "Not started" tile's note carries the narrower number.
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
- **`PARK: <thing>` means write it down, do not start it.** It goes to
  `BACKLOG.md` and the current task carries on. `PARK!:` puts it at the top.
  `BACKLOG` lists what is parked; `WORK THE BACKLOG` works through it top-down.
  `TODO:`, `AWAITING:` and `FUTURE:` record work that cannot be done yet, and are
  never started unasked. This exists because context gets summarised between sessions and
  loose "we could also..." offers do not survive it.

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

**The standalone server does not read the project's `.env.local`.** It runs with
its own working directory, so `.env.local` has to be copied into
`.next/standalone` alongside `.next/static` and `public/`. Without it the app
silently falls back to the bundled snapshot — which looks like working software
serving 543 component lines instead of 1,957.

**Stop the standalone server before building.** It runs out of
`.next/standalone`, which `next build` rewrites, and Windows will not let a
build replace a file the running server holds open. The build does not fail --
it compiles fine, prints nothing further and hangs at the end indefinitely,
which reads like a slow build rather than a blocked one. Killing the wrapper is
not enough either: stopping an `npm run build` kills npm, leaving the `next
build` child alive and still holding `.next`, so the next attempt hangs too and
two builds are now writing the same folder. Check nothing is left (`Get-Process
node`) before starting another. With the port free, a build here takes about
30 seconds.

**`dev` and `build` share `.next`.** Running one while the other is up leaves
development and production artifacts mixed in that folder, and the symptom is
not an error: pages serve correctly for a while, then start returning 404 —
which reads exactly like a routing bug you just introduced. Stop the dev server,
`rm -rf .next`, then build; clear it again before going back to dev.
