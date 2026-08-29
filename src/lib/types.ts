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
  quantity: number;
  remainingQuantity: number;
  expectedQuantity: number;
  locationCode: string;
  binCode: string;
  variantCode: string;
  dueDate: string | null;
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
 * How a fetch turned out. `not-configured` is a normal state, not an error: a
 * web service that is not reachable yet leaves its page empty and explains
 * itself rather than throwing.
 */
export type Source = "business-central" | "not-configured";

export type Fetched<T> = {
  source: Source;
  /** Which env var is missing, when source is "not-configured". */
  missing?: string;
  fetchedAt: string;
  rows: T[];
};

/** A production order with its work centre resolved from the routing lines. */
export type OrderWithWorkCenter = ProductionOrder & { workCenter: string };

/** A component with the work centre of its parent order attached. */
export type ComponentWithWorkCenter = ProdOrderComponent & { workCenter: string };
