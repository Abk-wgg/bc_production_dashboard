// Shapes shared by the server data layer and the client components.
//
// These live outside src/lib/bc/ on purpose. Everything under bc/ is marked
// `server-only`, so a client component that imported a type from there would
// drag a server module into the browser bundle. Types here are erased at
// compile time and safe to import from anywhere.

/** Production Order header - BC table 5405. */
export type ProductionOrder = {
  no: string;
  status: number;
  description: string;
  /** "Source No." on 5405 - the item being made. */
  itemNo: string;
  routingNo: string;
  quantity: number;
  /** Unreliable in this tenant - see the note in bc/orders.ts. */
  finishedQuantity: number;
  dueDate: string | null;
  startingDate: string | null;
  endingDate: string | null;
  finishedDate: string | null;
  locationCode: string;
  assignedUserId: string;
  brand: string;
  salesOrderNo: string;
  /** NETVAPS Scheduled - VAPS is the production scheduling add-on. */
  scheduled: boolean;
  completelyPicked: boolean;
  /** Published on the order feed and specific to this business. */
  flavour: string;
  strength: string;
  cartoned: string;
};

/** Prod. Order Component - BC table 5407. */
export type ProdOrderComponent = {
  prodOrderNo: string;
  prodOrderLineNo: number;
  /** BC line numbers step in 10000s; divide by 10000 to show 1, 2, 3. */
  lineNo: number;
  status: number;
  itemNo: string;
  description: string;
  unitOfMeasureCode: string;
  quantityPer: number;
  /**
   * No `quantity` here on purpose. Table 5407 carries one and it reads 0 on all
   * 1,961 rows, so a field of that name would be a loaded gun: the obvious one
   * to reach for, and silently zero. `expectedQuantity` is the populated figure
   * and is what the board uses; `remainingQuantity` is what is left to consume.
   *
   * Third field in this tenant to fail that check, after `Finished Quantity`
   * and the header's `Routing No.` - which is why it is written down rather
   * than just deleted.
   */
  remainingQuantity: number;
  expectedQuantity: number;
  locationCode: string;
  binCode: string;
  variantCode: string;
  dueDate: string | null;
  /** BC "Flushing Method" option - see src/lib/scope.ts. */
  flushingMethod: number;
  /** Warehouse pick state - the reason prod_order_comp_with_pick exists. */
  qtyPicked: number;
  completelyPicked: boolean;
  /** Earliest Material Availability Date, from VAPS. */
  emad: string | null;
};

/** Prod. Order Routing Line - BC table 5409 (NOT 5410, see bc/routing.ts). */
export type ProdOrderRoutingLine = {
  prodOrderNo: string;
  status: number;
  routingNo: string;
  operationNo: string;
  nextOperationNo: string;
  type: string;
  /** The centre this operation runs on - the code the shop floor recognises. */
  no: string;
  workCenterNo: string;
  workCenterGroupCode: string;
  description: string;
  setupTime: number;
  runTime: number;
  expectedCapacityNeed: number;
  routingStatus: string;
  startingDate: string | null;
  endingDate: string | null;
  locationCode: string;
  scheduled: boolean;
  earliestStartDate: string | null;
  emad: string | null;
  notFullyPromised: boolean;
};

/**
 * How a fetch turned out.
 *
 * - `business-central` - read live, the real thing.
 * - `snapshot` - real BC rows captured to a file, for demonstrating the board
 *   before the Entra app registration exists. Frozen, and labelled as such on
 *   every page so nobody mistakes it for live.
 * - `not-configured` - a normal state, not an error: no credentials and no
 *   snapshot, so the page explains itself rather than throwing.
 */
export type Source = "business-central" | "workbook" | "snapshot" | "not-configured";

export type Fetched<T> = {
  source: Source;
  /** Which env var is missing, when source is "not-configured". */
  missing?: string;
  /** When the request was served. */
  fetchedAt: string;
  /**
   * When the data itself was taken from BC: the snapshot's capture time, or the
   * warehouse workbook's last refresh. Always older than `fetchedAt`, and the
   * figure that actually says how stale the board is.
   */
  takenAt?: string;
  /**
   * True when this feed is known to be incomplete - a snapshot capped at 1000
   * rows. Absence of a row then means "not pulled", not "does not exist", so
   * any rule that reads absence as zero has to be suppressed.
   */
  partial?: boolean;
  rows: T[];
};

/**
 * A production order with the parts that only its routing lines know:
 * which work centre it runs on, and when it is scheduled to start.
 */
export type OrderWithWorkCenter = ProductionOrder & {
  workCenter: string;
  /**
   * Earliest Starting Date across the order's routing lines - when the work is
   * planned to run, as opposed to `dueDate`, which is when it is owed. Null if
   * the order has no usable routing line.
   */
  scheduledStart: string | null;
};

/** A component with the work centre of its parent order attached. */
export type ComponentWithWorkCenter = ProdOrderComponent & { workCenter: string };

/**
 * One shop-floor button press - BC table 50403 "SFDC Prod. Order Data Entry".
 *
 * An event log, not a summary. `eventType` says what the press recorded:
 * Output, Consumption or Scrap; Start / Pause / Restart presses carry none.
 *
 * Quantities can be NEGATIVE - a reversal posts a matching negative row rather
 * than deleting the original. Always sum; never take an absolute value, or
 * corrections get counted as production.
 */
export type OutputEvent = {
  entryNo: number;
  prodOrderNo: string;
  /** The item being made. */
  sourceNo: string;
  /** Start | Pause | Restart | Complete */
  buttonEvent: string;
  /** Output | Consumption | Scrap, or "" for start/pause/restart. */
  eventType: string;
  /** Full ISO timestamp - these land milliseconds apart. */
  at: string;
  /**
   * The operator who pressed it - "Line Leader" on the table.
   *
   * Absent from the snapshot on purpose: it is an employee name, and the
   * snapshot is a file that leaves the server. Live, the feed carries it.
   */
  lineLeader: string;
  qtyOutput: number;
  qtyScrapped: number;
  booked: boolean;
  lotNo: string;
};

/**
 * What the shop floor is doing with an order, derived from the last button
 * press. The rules live in src/lib/floor.ts; the shape is here because both the
 * server and the client components handle it.
 */
export type FloorStatus =
  | "running"
  | "complete"
  | "paused"
  | "qa-booked"
  | "not-started";

export type FloorState = {
  status: FloorStatus;
  /** Who pressed the button. "" when the feed does not carry Line Leader. */
  operator: string;
  /** Full ISO timestamp of that press, or null when nothing has happened. */
  at: string | null;
};

/** A lot of stock - BC table 5517495 "PB365 Inventory Summary". */
export type StockLot = {
  itemNo: string;
  variantCode: string;
  lotNo: string;
  description: string;
  itemCategoryCode: string;
  locationCode: string;
  binCode: string;
  quantity: number;
  availableQuantity: number;
  unitOfMeasureCode: string;
  available: boolean;
  /** Only the lot-tracked items (liquids) carry these. */
  expiryDate: string | null;
  productionDate: string | null;
  lotStatus: string;
};

/**
 * An open purchase order line - BC table 39.
 *
 * `Prod. Order No.` exists on this table but is EMPTY on every row sampled, so
 * incoming stock is matched to demand by ITEM, not by production order.
 */
export type PurchaseLine = {
  documentNo: string;
  lineNo: number;
  vendorNo: string;
  itemNo: string;
  description: string;
  locationCode: string;
  quantity: number;
  outstandingQuantity: number;
  quantityReceived: number;
  expectedReceiptDate: string | null;
  promisedReceiptDate: string | null;
  orderDate: string | null;
  unitOfMeasureCode: string;
  completelyReceived: boolean;
};

/** A sales order header - BC table 36, document type Order. */
export type SalesOrder = {
  no: string;
  customerNo: string;
  customerName: string;
  billToName: string;
  externalDocumentNo: string;
  yourReference: string;
  locationCode: string;
  salespersonCode: string;
  documentDate: string | null;
  requestedDeliveryDate: string | null;
  shipmentDate: string | null;
  dueDate: string | null;
  status: number;
  completelyShipped: boolean;
  currencyCode: string;
  amount: number;
  amountIncludingVat: number;
};

/** A sales order line - BC table 37. */
export type SalesLine = {
  documentNo: string;
  lineNo: number;
  itemNo: string;
  description: string;
  locationCode: string;
  variantCode: string;
  quantity: number;
  outstandingQuantity: number;
  quantityShipped: number;
  unitOfMeasureCode: string;
  shipmentDate: string | null;
  unitPrice: number;
  lineAmount: number;
};

/**
 * Item master - BC table 27, published as `Item_Card_Excel`.
 *
 * The other feeds carry item CODES; this is where the code becomes a name, a
 * category and a unit. Also the source of reorder point and safety stock, which
 * is what makes a shortage judgeable rather than just a number.
 */
export type Item = {
  no: string;
  description: string;
  searchDescription: string;
  baseUnitOfMeasure: string;
  itemCategoryCode: string;
  /** BC "Type": Inventory / Non-Inventory / Service. */
  type: string;
  /** FlowField - may be absent depending on the published page. */
  inventory: number;
  reorderPoint: number;
  safetyStockQuantity: number;
  vendorNo: string;
  /**
   * "Purchase" or "Prod. Order". What separates an item with no vendor because
   * nobody set one from an item with no vendor because we make it ourselves.
   */
  replenishmentSystem: string;
  blocked: boolean;
  unitCost: number;
};

/**
 * A vendor card - BC table 23.
 *
 * Only what a purchasing view needs. The card carries 140-odd fields; a page
 * that shows who to chase needs the code and the name, and taking more would
 * put bank details and payment terms into a browser bundle for no reason.
 */
export type Vendor = {
  no: string;
  name: string;
};

/**
 * A production order with everything the rest of the chain knows about it:
 * its work centre and scheduled start (routing), what has actually been made
 * (shop-floor events), and who it is for (sales order).
 */
export type BoardOrder = OrderWithWorkCenter & {
  /** Units booked as output, net of reversals. */
  made: number;
  scrapped: number;
  lastBookedAt: string | null;
  /** What the shop floor is doing with it - see src/lib/floor.ts. */
  floor: FloorState;
  customerName: string;
  /** When the sales order is due to ship. */
  salesShipmentDate: string | null;
};

/**
 * A component with stock and incoming supply attached, every field intact.
 * This is the JSON feed's shape, not the browser's - see BoardComponent.
 */
export type FeedComponent = ComponentWithWorkCenter & {
  /** Stock free to use, summed across lots. */
  available: number;
  /** Earliest expiry across the lots holding it, if lot-tracked. */
  earliestExpiry: string | null;
  /** Outstanding on purchase orders, and when the first of it lands. */
  onOrder: number;
  nextReceipt: string | null;
};

/**
 * The part of a component line the browser ever reads.
 *
 * This list IS the page payload: a server component serialises every field it
 * hands a client component into the HTML, once per line, and there are 1,957
 * lines. Spreading the BC row here instead shipped 213 KB of fields nothing
 * renders - `binCode`, `variantCode`, `emad`, `flushingMethod` (which does its
 * work in scope.ts, on the server) and a component `quantity` that reads 0 on
 * every row.
 *
 * Add a field only when something on screen uses it.
 */
export type ComponentLine = Pick<
  ProdOrderComponent,
  | "prodOrderNo"
  | "prodOrderLineNo"
  | "lineNo"
  | "status"
  | "itemNo"
  | "description"
  | "unitOfMeasureCode"
  | "remainingQuantity"
  | "expectedQuantity"
  | "locationCode"
  | "dueDate"
  | "qtyPicked"
  | "completelyPicked"
>;

/** A component line as a page hands it to a client component. */
export type BoardComponent = ComponentLine & {
  workCenter: string;
  /** Stock free to use, summed across lots. */
  available: number;
  /** Earliest expiry across the lots holding it, if lot-tracked. */
  earliestExpiry: string | null;
  /** When the first of anything on order lands. */
  nextReceipt: string | null;
};
