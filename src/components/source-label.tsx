import type { Fetched } from "@/lib/types";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB");
}

function dateOf(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The small "where this came from" line in the top right of every page. */
export function SourceStamp({ result }: { result: Fetched<unknown> }) {
  if (result.source === "business-central") {
    return <p className="stamp">Business Central · {timeOf(result.fetchedAt)}</p>;
  }
  if (result.source === "snapshot") {
    return <p className="stamp">Snapshot · not live</p>;
  }
  return <p className="stamp">Not connected</p>;
}

/**
 * Says the figures are frozen, and when they were taken.
 *
 * Shown on every page rather than once, because someone walking up to a screen
 * mid-demo has no way of knowing otherwise - and these are real order numbers
 * and real quantities, which is exactly what makes them convincing enough to be
 * mistaken for current.
 */
export function SnapshotNotice({ result }: { result: Fetched<unknown> }) {
  if (result.source !== "snapshot") return null;

  return (
    <div className="notice">
      <h2>Snapshot — not live data</h2>
      <p>
        Real released orders read from Business Central Production on{" "}
        <strong>{result.takenAt ? dateOf(result.takenAt) : "an earlier date"}</strong>, and
        frozen. Nothing here updates. The board switches to live automatically once the
        Entra app registration is in place — see <code>BC-SETUP.md</code>.
      </p>
    </div>
  );
}
