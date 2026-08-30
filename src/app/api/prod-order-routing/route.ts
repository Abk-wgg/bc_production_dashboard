// JSON feed of prod. order routing lines (BC table 5409) - the operations, and
// the source of every work centre the board shows.

import { NextResponse } from "next/server";
import { getProdOrderRoutingLines } from "@/lib/bc/routing";

export const dynamic = "force-dynamic";

export async function GET() {
  const routing = await getProdOrderRoutingLines();

  return NextResponse.json({
    source: routing.source,
    fetchedAt: routing.fetchedAt,
    // When the data itself was taken from BC, if it is not live. A consumer
    // charting these rows needs to know they are an hour old, not seconds.
    takenAt: routing.takenAt,
    count: routing.rows.length,
    routingLines: routing.rows,
  });
}
