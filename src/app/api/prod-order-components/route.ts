// JSON feed of prod. order components, including warehouse pick state.

import { NextResponse } from "next/server";
import { getProdOrderComponents } from "@/lib/bc/components";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const components = await getProdOrderComponents();

  // ?order=OLCRELPROD100 narrows the feed to one order.
  const order = new URL(request.url).searchParams.get("order")?.trim().toLowerCase();
  const rows = order
    ? components.rows.filter((c) => c.prodOrderNo.toLowerCase() === order)
    : components.rows;

  return NextResponse.json({
    source: components.source,
    fetchedAt: components.fetchedAt,
    count: rows.length,
    components: rows,
  });
}
