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
  { href: "/vitality", label: "Vitality" },
];

export function SiteHeader() {
  const path = usePathname();
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

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
            {NAV.map((n) => (
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
          </nav>
        </div>
      </div>
    </header>
  );
}
