import { formatNumber } from "@/lib/format";

/**
 * The handful of numbers someone wants before they look at anything else.
 *
 * Taken from the Picking Control Board's tile row. A colour bar down the left
 * carries the judgement — grey means "a count", red means "somebody has to do
 * something" — so the row can be read from across the room without reading the
 * labels at all.
 */
export type Tile = {
  label: string;
  value: number;
  /** Small text after the number, e.g. "of 982". */
  suffix?: string;
  note?: string;
  tone?: "good" | "done" | "warn" | "crit";
};

export default function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="tiles">
      {tiles.map((tile) => (
        <div key={tile.label} className={tile.tone ? `tile t-${tile.tone}` : "tile"}>
          <div className="k">{tile.label}</div>
          <div className="v">
            {formatNumber(tile.value)}
            {tile.suffix && <small>{tile.suffix}</small>}
          </div>
          {tile.note && <div className="n">{tile.note}</div>}
        </div>
      ))}
    </div>
  );
}
