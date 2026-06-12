import Link from "next/link";

// Inline placeholder shown in place of a gated section when the visitor hasn't
// entered the access code. Links to /unlock and returns to the current page.
export function LockedTeaser({ title, blurb, next }: { title: string; blurb: string; next: string }) {
  return (
    <div className="panel rounded-lg p-8 text-center border-dashed">
      <div className="mx-auto w-9 h-9 rounded-full bg-bone ring-1 ring-rule flex items-center justify-center text-ink-mute">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h3 className="mt-3 font-display text-xl text-ink">{title}</h3>
      <p className="mt-2 text-sm text-ink-mute max-w-md mx-auto">{blurb}</p>
      <Link href={`/unlock?next=${encodeURIComponent(next)}`}
        className="mt-4 inline-block px-4 py-2 rounded-md bg-teal text-white text-sm font-medium hover:bg-teal/90 transition-colors">
        Enter access code
      </Link>
    </div>
  );
}
