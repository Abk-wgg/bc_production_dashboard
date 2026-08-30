// Shop-floor data capture - BC table 50403 "SFDC Prod. Order Data Entry",
// published as `Prod_Order_Data_Entry_Excel`.
//
// This is what actually got made. It is the answer to `Finished Quantity` on
// the order header reading 0 on every row: nobody populates that field, but the
// line does record every button press here.

import "server-only";
import { fetchService } from "./client";
import { toOutputEvent } from "./map";
import type { Fetched, OutputEvent } from "../types";

export async function getOutputEvents(): Promise<Fetched<OutputEvent>> {
  const result = await fetchService("outputEvents");
  return { ...result, rows: result.rows.map(toOutputEvent) };
}
