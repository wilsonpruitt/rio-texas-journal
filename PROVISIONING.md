# Provisioning a new conference instance

See `~/wroot-labs/notes/conference-atlas-architecture.md` §2 for the rationale
(one repo, N instances; one Vercel project + one Supabase project per
conference; per-instance isolation is the pitch). This doc is the concrete
runbook. New conference = ~1 hour of mechanics + however long ingestion takes.

## 1. Supabase

1. Create a new Supabase project (region near the conference office). See
   `reference_supabase-registry` (Wilson's memory) for which login owns which
   projects before creating — keep the account map current.
2. Apply every migration in `supabase/migrations/*.sql`, in filename order
   (`0001_init.sql` → the latest), via the Supabase session pooler — this
   repo's existing practice, not a new tool.
3. No seed data beyond what the migrations themselves seed (stat-field
   vocabularies, etc.) — church/stats data comes from ingestion (step 4 below).

## 2. Vercel

1. Create a new Vercel project from this same repo (a new project, not a new
   repo — one repo, N deployed instances).
2. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` — from the Supabase project created in step 1.
   - `CONFERENCE_SLUG=<slug>` — must match the directory name under
     `conferences/<slug>/` (step 3).
   - `RTJ_UNLOCK_CODE=<a real, per-instance code>` — never ship the
     `rio2026` default to a customer instance (see `src/lib/unlock.ts`; it's a
     curtain, not a security boundary, but each instance needs its own).
3. Enable Vercel Web Analytics (Hobby-tier toggle, free) — see
   `reference_vercel-hobby-analytics` (Wilson's memory) for the snippet
   pattern; already wired into `layout.tsx`, just flip the dashboard toggle.
4. Commit-author gate: confirm which email/account this new instance's git
   remote and Vercel team expect (see `feedback_vercel-commit-author-gate` /
   `reference_account-mappings` in Wilson's memory) — customer instances are a
   commercial product, decide the Vercel team and billing at first pilot; it's
   not a code question.

## 3. Scaffold `conferences/<slug>/`

Create the directory with:

```
conferences/<slug>/
  config.ts              # copy conferences/rio-texas/config.ts as a template;
                          # fill in slug, name, years, districts.assignment,
                          # ingest.adapters, modules (a pilot conference may
                          # start atlas-only — see INGEST.md's Phase-1 corollary),
                          # branding, access.staff.mode
  districts.json          # { byCounty: {...}, roster: {...} } — whatever the
                          # conference publishes (a county table or a roster;
                          # only one may exist yet, that's fine, assignment
                          # order in config.ts controls fallback)
  hand-maps/
    appointment-churches.json   # start empty: {}
    district-roster.json       # start empty: {}
    disaffiliation.json        # start empty: {}
```

Also add one line to each slug-keyed registry (small, mechanical, same pattern
each time):
- `src/lib/conference.ts` — `CONFERENCES` map
- `src/lib/districts.ts` — nothing to add here; it reads
  `conferences/${config.slug}/districts.json` directly by path
- `scripts/data/extract_gcfa.py` — `DEFAULT_WORKBOOKS` dict (optional; the
  script also accepts an explicit path argument)

## 4. Ingest

See `INGEST.md` for the full adapter contract. Phase-1 path:

1. File (or have the conference file) the same kind of GCFA service-ticket
   request Wilson filed for Rio Texas.
2. `CONFERENCE_SLUG=<slug> /usr/local/bin/python3.11 scripts/data/extract_gcfa.py [path-to-xlsx]`
   → writes `scripts/data/gcfa/*` (gitignored, regenerate don't commit).
3. `node --env-file=.env.local --experimental-strip-types scripts/import-gcfa.ts`
   (after migrations are applied) → loads `stat_field`, `church`,
   `church_stat` into the new Supabase project.
4. Run the build scripts that only need adapter 1 + a district map + census
   (no appointment parsing required): `build-insights.ts`,
   `build-scorecard-baseline.ts`, `build-viability.ts`. PAR
   (`build-par-baseline.ts`, `build-par.ts`) and clergy-lifecycle modules wait
   for appointment data (adapter 2 or bespoke journal-PDF parsing) — see
   INGEST.md's Phase-1 corollary.
5. `npm run build` locally once to confirm `scripts/guard-shells.ts` passes
   before the first deploy (it also runs automatically on every build).

## 5. Contract artifacts

Not a code step — governance doctrine, red lines, and an export-on-demand
clause (per-instance isolation is the pitch: "your data never commingles, and
you can export any time"). Engagement-letter template is a separate queue
item (see Wilson's `NOW.md` / `conference-atlas-product.md`), not built yet.

## Success criterion (per the extraction plan)

A second conference onboards by: filing their own GCFA service ticket →
scaffolding `conferences/<slug>/` (config + districts.json + empty hand-maps)
→ provisioning a Supabase/Vercel pair → running the extractor and build
scripts. **Zero engine files edited.** Where reality falls short of that
during the first real pilot, the shortfall itself is the finding worth
writing down.
