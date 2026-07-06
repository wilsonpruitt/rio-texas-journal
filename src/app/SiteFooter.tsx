import Link from "next/link";
import config from "@/lib/conference";

const titleWords = config.branding.siteTitle.split(" ");
const titleAccent = titleWords[titleWords.length - 1];
const titleMain = titleWords.slice(0, -1).join(" ");

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-rule bg-bone/60">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 grid gap-8 sm:grid-cols-3 text-sm">
        <div className="sm:col-span-1">
          <div className="font-display text-lg text-ink">
            {titleMain} <span className="italic text-oxblood">{titleAccent}</span>
          </div>
          <p className="mt-2 text-ink-mute leading-relaxed max-w-xs">
            A statistical portrait of the Rio Texas Annual Conference and its
            predecessor conferences, drawn from GCFA local-church reports,
            2000–2024.
          </p>
        </div>
        <nav className="flex flex-col gap-1.5">
          <span className="eyebrow mb-1">Sections</span>
          <Link href="/" className="text-ink-mute hover:text-ink w-fit">Overview</Link>
          {config.modules.atlas && <Link href="/churches" className="text-ink-mute hover:text-ink w-fit">Churches</Link>}
          {config.modules.map && <Link href="/map" className="text-ink-mute hover:text-ink w-fit">Map</Link>}
          {config.modules.vitality && <Link href="/vitality" className="text-ink-mute hover:text-ink w-fit">Vitality &amp; risk</Link>}
        </nav>
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow mb-1">Sources</span>
          <span className="text-ink-mute">GCFA local-church statistical tables</span>
          <span className="text-ink-mute">U.S. Census ACS 5-year (neighborhood)</span>
          <span className="text-faint mt-2 text-xs">
            Predecessor conferences: Rio Grande &amp; Southwest Texas, merged 2015.
          </span>
        </div>
      </div>
    </footer>
  );
}
