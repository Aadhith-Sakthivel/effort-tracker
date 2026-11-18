import React from "react";

// Shared palette + formatting helpers (previously duplicated across pages).
export const COLORS = ["#0071e3", "#30a46c", "#e2920a", "#8e4ec6", "#e5484d", "#5e5ce6", "#12a5b0", "#d6409f"];

export const initials = (n) => (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// Backend timestamps are UTC; tag naive ones as UTC, render in US Eastern.
export function fmtET(ts) {
  if (!ts) return "";
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : ts + "Z";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET";
}

// Relative "2h ago" style, falling back to a short date.
export function relTime(ts) {
  if (!ts) return "";
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : ts + "Z";
  const d = new Date(iso), diff = (Date.now() - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Stacked initials avatars with a "+N" overflow.
export function Avatars({ people, max = 4, size = 28 }) {
  if (!people || !people.length) return <span className="muted">—</span>;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const st = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  return (
    <div className="avatars" title={people.map((p) => p.name).join(", ")}>
      {shown.map((p) => <span key={p.id} className="avatar" style={st}>{initials(p.name)}</span>)}
      {extra > 0 && <span className="avatar more" style={st}>+{extra}</span>}
    </div>
  );
}
