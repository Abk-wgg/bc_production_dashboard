# The Business Central web services this app reads

All three are already published on the **Production** environment, company
**Own Label Ceations**. Nothing needs deploying to BC — publishing a page on the
**Web Services** screen is a setting, which is why this route was chosen.

## What is published

| BC table | What it holds | Service name |
|---|---|---|
| **5405** Production Order | Order headers — the job itself | `Production_Order_List_Excel` |
| **5407** Prod. Order Component | Materials each order consumes | `prod_order_comp_with_pick` |
| **5409** Prod. Order Routing Line | Operations, each on a work centre | `Prod_Order_Routing_Excel` |

The URL pattern, for checking one by hand in a browser:

```
https://api.businesscentral.dynamics.com/v2.0/{tenant}/Production
  /ODataV4/Company('Own%20Label%20Ceations')/{service name}
```

Note the company is addressed by **name in single quotes**. Standard API v2.0
entities use the company GUID instead — different route, different rules.

## Two things worth knowing

**Routing lines are table 5409, not 5410.** 5410 is "Prod. Order Capacity Need",
a different table with different fields. The earlier Power Apps prototype's AL
page carried a comment saying 5410 and still worked, because AL resolves
`SourceTable` by name and never looked at the number.

**Publishing renames the fields.** OData turns spaces into underscores and drops
full stops, so `Sales Order No.` arrives as `Sales_Order_No`. Exactly which
spelling you get varies with the page and the BC version, so every mapper in
`src/lib/bc/` tries the likely names rather than hard-coding one and silently
rendering a blank column. If a column comes back empty, that is the first place
to look — add the spelling BC actually sent to the `pick(...)` list.

## Which fields the app uses

It only reads what it displays. If a service stops exposing one of these, the
column goes blank rather than the page failing.

**5405 Production Order** — `No.`, `Status`, `Description`, `Source No.`,
`Routing No.`, `Quantity`, `Due Date`, `Starting Date`, `Ending Date`,
`Finished Date`, `Location Code`, `Assigned User ID`, `Brand`,
`Sales Order No.`, `NETVAPS Scheduled`, `Completely Picked`.

`Finished Quantity` is deliberately **not** used for anything. It read 0 on
every row sampled in this tenant, so a board built on it would report all work
as outstanding. Completion comes from `Status` instead.

**5407 Prod. Order Component** — `Prod. Order No.`, `Prod. Order Line No.`,
`Line No.`, `Status`, `Item No.`, `Description`, `Unit of Measure Code`,
`Quantity per`, `Quantity`, `Remaining Quantity`, `Expected Quantity`,
`Location Code`, `Bin Code`, `Variant Code`, `Due Date`, `Qty. Picked`,
`Completely Picked`.

The pick fields are the reason this particular service is the one to use — they
answer "are the materials actually on the floor?", which the standard component
page cannot.

**5409 Prod. Order Routing Line** — `Prod. Order No.`, `Status`, `Routing No.`,
`Operation No.`, `Next Operation No.`, `Type`, `No.`, `Work Center No.`,
`Work Center Group Code`, `Description`, `Setup Time`, `Run Time`,
`Expected Capacity Need`, `Routing Status`, `Starting Date`, `Ending Date`,
`Location Code`, and the VAPS fields `NETVAPS Scheduled`,
`NETVAPS Earliest Start Date`, `NETVAPS EMAD`, `NETVAPS Not Fully Promised`.

`No.` is the centre an operation actually runs on; `Work Center No.` is the work
centre a machine centre sits inside. The app checks both, because `PRINTING` has
to be excluded whichever of the two it appears as.

## Why PRINTING is excluded

Nearly every order passes through PRINTING. Including it would put almost the
whole board in one schedule column and tell nobody anything useful, so the
derived work centre skips it. An order whose *only* operation is PRINTING ends
up with no work centre, and the schedule flags those in red — they are the ones
worth asking about.

## If a service is renamed

Set the matching variable in `.env.local`; the code falls back to the names
above when it is unset.

```
BC_WS_PRODUCTION_ORDERS=
BC_WS_PROD_ORDER_COMPONENTS=
BC_WS_PROD_ORDER_ROUTING=
```
