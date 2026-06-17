"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = { href: string; label: string; gated?: boolean; external?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Overview" },
  { href: "/churches", label: "Churches" },
  { href: "/districts", label: "Districts" },
  { href: "/conference", label: "Finance" },
  { href: "/careers", label: "Careers" },
  { href: "/finances", label: "Audit", external: true },
  { href: "/signals", label: "Signals" },
  { href: "/map", label: "Map" },
  { href: "/vitality", label: "Vitality", gated: true },
];

const UnlockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export function SiteHeader({ unlocked = false }: { unlocked?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);
  const nav = NAV.filter((n) => !n.gated || unlocked);

  const linkCls = (href: string) =>
    [
      "px-2.5 py-1 rounded-sm transition-colors",
      isActive(href)
        ? "text-ink bg-teal-soft ring-1 ring-teal/20"
        : "text-ink-mute hover:text-ink hover:bg-bone",
    ].join(" ");

  const renderLink = (n: NavItem, onClick?: () => void) =>
    n.external ? (
      <a key={n.href} href={n.href} className={linkCls(n.href)} onClick={onClick}>
        {n.label}
      </a>
    ) : (
      <Link key={n.href} href={n.href} className={linkCls(n.href)} onClick={onClick}>
        {n.label}
      </Link>
    );

  return (
    <header className="sticky top-0 z-40 bg-parchment/85 backdrop-blur-sm border-b border-rule">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex items-baseline justify-between gap-4 py-3">
          <Link href="/" className="group flex items-baseline gap-3" onClick={() => setOpen(false)}>
            <span className="font-display text-xl sm:text-2xl text-ink leading-none">
              Rio Texas <span className="italic text-oxblood">Atlas</span>
            </span>
            <span className="hidden sm:inline eyebrow translate-y-[-1px]">2000—2024</span>
          </Link>

          {/* desktop nav */}
          <nav className="hidden md:flex items-center gap-1 lg:gap-2 text-sm">
            {nav.map((n) => renderLink(n))}
            {!unlocked && (
              <Link
                href="/unlock"
                aria-label="Enter access code"
                title="Enter access code"
                className="ml-1 px-2 py-1 rounded-sm text-faint hover:text-ink hover:bg-bone transition-colors"
              >
                <UnlockIcon />
              </Link>
            )}
          </nav>

          {/* mobile toggle */}
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="md:hidden -my-1 self-center rounded-sm p-2 text-ink-mute hover:text-ink hover:bg-bone transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
            </svg>
          </button>
        </div>

        {/* mobile dropdown */}
        {open && (
          <nav className="md:hidden border-t border-rule py-2 text-[15px]">
            <div className="flex flex-col">
              {nav.map((n) => renderLink(n, () => setOpen(false)))}
              {!unlocked && (
                <Link
                  href="/unlock"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-sm text-faint hover:text-ink hover:bg-bone transition-colors"
                >
                  <UnlockIcon /> Access code
                </Link>
              )}
            </div>
          </nav>
        )}
      </div>
    </header>
  );
}
