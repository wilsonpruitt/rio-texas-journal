// Client-safe constants + formatters. Server-only data fetchers live in atlas-server.ts.

export const fmtInt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US").format(Math.round(n));
export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, notation: n >= 1e6 ? "compact" : "standard" }).format(n);
export const fmtPct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${n.toFixed(digits)}%`;
export const fmtSigned = (n: number | null | undefined) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${new Intl.NumberFormat("en-US").format(Math.round(n))}`;

export const RISK = {
  low: { label: "Low", color: "var(--color-teal)", bg: "bg-teal-soft", text: "text-teal", ring: "ring-teal/25" },
  moderate: { label: "Moderate", color: "var(--color-amber)", bg: "bg-amber-soft", text: "text-amber", ring: "ring-amber/25" },
  elevated: { label: "Elevated", color: "#c2722e", bg: "bg-amber-soft", text: "text-ember", ring: "ring-ember/25" },
  high: { label: "High", color: "var(--color-ember)", bg: "bg-ember-soft", text: "text-ember", ring: "ring-ember/30" },
} as const;
export type RiskTier = keyof typeof RISK;

export const STATUS = {
  active: { label: "Active", text: "text-teal", dot: "var(--color-teal)" },
  closed: { label: "Closed", text: "text-ember", dot: "var(--color-ember)" },
  disaffiliated: { label: "Disaffiliated", text: "text-amber", dot: "var(--color-amber)" },
  merged: { label: "Merged", text: "text-ink-mute", dot: "var(--color-faint)" },
} as const;

