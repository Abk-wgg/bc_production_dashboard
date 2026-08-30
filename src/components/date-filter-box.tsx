"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  DATE_FILTER_HELP,
  DATE_FILTER_PLACEHOLDER,
  DATE_PRESETS,
} from "@/lib/date-filter";

/** The menu's width, for keeping it on screen near the right edge. */
const MENU_W = 218;

/**
 * A date filter box: the expression, and a caret that offers the common ones.
 *
 * The menu fills the box rather than filtering directly. That is the point of
 * it - you see the expression it wrote, so the second time you type
 * `cd..cd+14` yourself. A control that filtered silently would teach nothing
 * and would need a way to say "the box and I disagree".
 *
 * Whether the expression parses is decided by the caller, which already has to
 * compile it to filter with. Passing the answer in keeps one parse per
 * keystroke and makes it impossible for the colour and the filter to disagree.
 */
export default function DateFilterBox({
  value,
  onChange,
  state,
  ariaLabel,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Green when it parses, red when it does not, nothing when it is empty. */
  state?: "parsed" | "unparsed";
  ariaLabel: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Measured on open rather than positioned by CSS, because this box sits in a
  // sticky <th> inside a scroll box whose cells clip their overflow - an
  // absolutely positioned menu would be cut off twice over. The menu is
  // portalled to the body and pinned to the viewport instead.
  useLayoutEffect(() => {
    if (!open) return;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setAt({
      top: box.bottom + 4,
      left: Math.max(8, Math.min(box.left, window.innerWidth - MENU_W - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    // Pinned to the viewport means a scroll moves the box out from under the
    // menu. Closing is more honest than chasing it down the page.
    function onMove() {
      setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    // Capturing, so the table's own scroll box counts and not just the window.
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  function choose(expr: string) {
    onChange(expr);
    setOpen(false);
  }

  return (
    <>
      <span className="dfbox" ref={wrapRef} style={style}>
        <input
          type="text"
          className={["dfin", state].filter(Boolean).join(" ")}
          value={value}
          placeholder={DATE_FILTER_PLACEHOLDER}
          title={DATE_FILTER_HELP}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="dfcaret"
          onClick={() => setOpen((v) => !v)}
          aria-label={`${ariaLabel}: common dates`}
          aria-expanded={open}
          aria-haspopup="menu"
          title="Common date filters"
        >
          &#9662;
        </button>
      </span>

      {open &&
        at &&
        createPortal(
          <div
            className="dropdown-menu dfmenu"
            ref={menuRef}
            role="menu"
            style={{ top: at.top, left: at.left }}
          >
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.expr}
                type="button"
                role="menuitem"
                className="dropdown-item"
                onClick={() => choose(preset.expr)}
              >
                <span>{preset.label}</span>
                {/* The expression it will write, in the same monospace the
                    board uses for anything typed. This is the teaching half. */}
                <code className="dfexpr">{preset.expr}</code>
              </button>
            ))}
            {value !== "" && (
              <button
                type="button"
                role="menuitem"
                className="dropdown-item dfclear"
                onClick={() => choose("")}
              >
                Clear
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
