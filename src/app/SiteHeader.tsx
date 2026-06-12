"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/churches", label: "Churches" },
  { href: "/districts", label: "Districts" },
  { href: "/conference", label: "Finance" },
  { href: "/signals", label: "Signals" },
  { href: "/map", label: "Map" },
  { href: "/vitality", label: "Vitality", gated: true },
];

export function SiteHeader({ unlocked = false }: { unlocked?: boolean }) {
  const path = usePathname();
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);
  const nav = NAV.filter((n) => !n.gated || unlocked);

  return (
    <header className="sticky top-0 z-40 bg-parchment/85 backdrop-blur-sm border-b border-rule">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex items-baseline justify-between gap-4 py-3">
          <Link href="/" className="group flex items-baseline gap-3">
            <span className="font-display text-xl sm:text-2xl text-ink leading-none">
              Rio Texas <span className="italic text-oxblood">Atlas</span>
            </span>
            <span className="hidden sm:inline eyebrow translate-y-[-1px]">
              2000—2024
            </span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2 text-sm">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={[
                  "px-2.5 py-1 rounded-sm transition-colors",
                  isActive(n.href)
                    ? "text-ink bg-teal-soft ring-1 ring-teal/20"
                    : "text-ink-mute hover:text-ink hover:bg-bone",
                ].join(" ")}
              >
                {n.label}
              </Link>
            ))}
            {!unlocked && (
              <Link
                href="/unlock"
                aria-label="Enter access code"
                title="Enter access code"
                className="ml-1 px-2 py-1 rounded-sm text-faint hover:text-ink hover:bg-bone transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </Link>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
