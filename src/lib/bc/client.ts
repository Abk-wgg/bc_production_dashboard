// ---------------------------------------------------------------------------
// Business Central transport. The ONLY file that holds credentials or makes an
// outbound call. Pages, API routes and components never see either.
//
// Read-only by design: nothing here writes to BC.
//
// Route: a page published on BC's "Web Services" screen, read over OData v4.
// Publishing a page there is a configuration action - it does not need an AL
// extension deployment, which we do not have rights for in production.
//
// Auth: Entra client credentials. The app reads BC as itself, so one identity
// serves any number of viewers and nobody needs a per-user licence.
// ---------------------------------------------------------------------------

import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Fetched } from "../types";
import type { RawRow } from "./fields";

export type { RawRow } from "./fields";

export type { Fetched, Source } from "../types";

/** Which published web service a source reads from. */
export type ServiceKey =
  | "productionOrders"
  | "prodOrderComponents"
  | "prodOrderRouting"
  | "outputEvents"
  | "inventory"
  | "purchaseLines"
  | "salesOrders"
  | "salesLines"
  | "items";

const SERVICE_ENV: Record<ServiceKey, string> = {
  productionOrders: "BC_WS_PRODUCTION_ORDERS",
  prodOrderComponents: "BC_WS_PROD_ORDER_COMPONENTS",
  prodOrderRouting: "BC_WS_PROD_ORDER_ROUTING",
  outputEvents: "BC_WS_OUTPUT_EVENTS",
  inventory: "BC_WS_INVENTORY",
  purchaseLines: "BC_WS_PURCHASE_LINES",
  salesOrders: "BC_WS_SALES_ORDERS",
  salesLines: "BC_WS_SALES_LINES",
  items: "BC_WS_ITEMS",
};

// Services already published on the Production environment's Web Services
// screen. Defaulting to them means a filled-in .env.local only has to carry the
// credentials. Set the matching env var to override, e.g. to point a test run
// at a differently named service.
const SERVICE_DEFAULT: Record<ServiceKey, string> = {
  productionOrders: "Production_Order_List_Excel",
  prodOrderComponents: "prod_order_comp_with_pick",
  prodOrderRouting: "Prod_Order_Routing_Excel",
  outputEvents: "Prod_Order_Data_Entry_Excel",
  inventory: "Inventory_Summary_Excel",
  // `CS_PurchaseLine` is an alternative service over the same table 39. Both
  // work with the mapper; set BC_WS_PURCHASE_LINES to swap if one turns out to
  // expose fields the other does not.
  purchaseLines: "Purchase_Order_Line_Excel",
  salesOrders: "sale_order_list_custom_ab",
  salesLines: "Sales_Lines_Excel",
  items: "Item_Card_Excel",
};


/** Are the Entra credentials and company present? */
export function hasCredentials(): boolean {
  return Boolean(
    process.env.BC_TENANT_ID &&
      process.env.BC_CLIENT_ID &&
      process.env.BC_CLIENT_SECRET &&
      process.env.BC_COMPANY,
  );
}

/** The published service name for a source, or "" if there is none. */
export function serviceName(key: ServiceKey): string {
  return process.env[SERVICE_ENV[key]] || SERVICE_DEFAULT[key];
}

/** The env var a source needs, for "not configured yet" messages. */
export function serviceEnvVar(key: ServiceKey): string {
  return SERVICE_ENV[key];
}

export function isConfigured(key: ServiceKey): boolean {
  return hasCredentials() && serviceName(key).length > 0;
}

// --- snapshot ---------------------------------------------------------------
//
// Real BC rows captured to a file so the board can be demonstrated before the
// Entra app registration exists. Field names in it are already in published
// web-service form, so a snapshot goes through exactly the same mappers as live
// data - what you see in a demo is what you will see live.
//
// Live credentials always win. The snapshot is only consulted when there are
// none, so it can never silently mask a broken connection.

type Snapshot = {
  takenAt: string;
  /** Names of the feeds the capture could not complete. */
  partial?: string[];
  productionOrders?: RawRow[];
  prodOrderComponents?: RawRow[];
  prodOrderRouting?: RawRow[];
  outputEvents?: RawRow[];
  inventory?: RawRow[];
  purchaseLines?: RawRow[];
  salesOrders?: RawRow[];
  salesLines?: RawRow[];
  items?: RawRow[];
};

// undefined = not looked yet, null = looked and there is none.
let snapshotCache: Snapshot | null | undefined;

function loadSnapshot(): Snapshot | null {
  if (snapshotCache !== undefined) return snapshotCache;

  const file =
    process.env.BC_SNAPSHOT_FILE ?? path.join(process.cwd(), "data-snapshot.json");

  try {
    snapshotCache = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Snapshot)
      : null;
  } catch (error) {
    // A corrupt snapshot should not take the board down - fall through to the
    // "not configured" state, which at least says something useful.
    console.error(`Could not read snapshot at ${file}:`, error);
    snapshotCache = null;
  }

  return snapshotCache;
}

// --- token ------------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Entra tokens last about an hour. Requesting one per page view wastes a
  // round-trip on every render and eventually gets throttled.
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.BC_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.BC_CLIENT_ID!,
        client_secret: process.env.BC_CLIENT_SECRET!,
        scope: "https://api.businesscentral.dynamics.com/.default",
      }),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    throw new Error(`Entra token request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };

  tokenCache = {
    token: json.access_token,
    // Expire a minute early so we never present a token that dies in flight.
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };

  return json.access_token;
}

// --- fetch ------------------------------------------------------------------

// Published web services are addressed by company NAME in single quotes -
// unlike API v2.0 entities, which use the company GUID.
function odataUrl(service: string, params: Record<string, string>): string {
  const tenant = process.env.BC_TENANT_ID!;
  const environment = process.env.BC_ENVIRONMENT || "Production";
  const company = process.env.BC_COMPANY!;

  const url = new URL(
    `https://api.businesscentral.dynamics.com/v2.0/${tenant}/${environment}` +
      `/ODataV4/Company('${encodeURIComponent(company)}')/${service}`,
  );
  url.searchParams.set("$top", process.env.BC_TOP || "5000");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// How long a BC response is reused before we ask again. The board is read-only
// and a dozen people may have it open, so this is the difference between one
// call a minute and one call per viewer per refresh.
function cacheTtlMs(): number {
  return Number(process.env.BC_CACHE_SECONDS || 60) * 1000;
}

const cache = new Map<string, { at: number; value: Fetched<RawRow> }>();

/**
 * Reads every row from one published web service, with the response cached per
 * service. Returns a `not-configured` result rather than throwing when the
 * service name has not been set - a page that is not published yet is a setup
 * step outstanding, not a failure.
 */
export async function fetchService(
  key: ServiceKey,
  params: Record<string, string> = {},
): Promise<Fetched<RawRow>> {
  const fetchedAt = new Date().toISOString();

  if (!isConfigured(key)) {
    const snapshot = loadSnapshot();
    const rows = snapshot?.[key];
    if (rows) {
      return {
        source: "snapshot",
        fetchedAt,
        takenAt: snapshot.takenAt,
        partial: snapshot.partial?.includes(key) ?? false,
        rows,
      };
    }

    return {
      source: "not-configured",
      missing: hasCredentials() ? serviceEnvVar(key) : "BC_CLIENT_ID / BC_CLIENT_SECRET",
      fetchedAt,
      rows: [],
    };
  }

  const service = serviceName(key);
  const cacheKey = `${service}?${new URLSearchParams(params).toString()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < cacheTtlMs()) {
    return hit.value;
  }

  const token = await getAccessToken();
  const res = await fetch(odataUrl(service, params), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Business Central request for "${service}" failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as { value: RawRow[] };
  const value: Fetched<RawRow> = {
    source: "business-central",
    fetchedAt,
    rows: json.value ?? [],
  };

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}
