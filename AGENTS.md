<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Rio Texas Journal

Public, read-only interactive archive of Rio Texas Annual Conference journals (2015–2025, plus 2014 predecessors).

## Stack
- Next.js 16 (App Router, TS, Tailwind, src/, Turbopack)
- Supabase (Postgres + Storage for PDFs)
- Vercel (personal `wilsonpruitt`)

## Key facts
- All data is public — no auth required for reads.
- Schema mirrors UMC nationwide GCFA reporting; tall stats absorb yearly field drift.
- Two parser eras: A (2015–~2022) wide landscape, B (~2023–2025) narrow per-topic. Boundary year TBD.
- `journal_year` ≠ `data_year` (stats reported one year in arrears).
- Church identity is name-based; reconciliation via `church_alias`.
- District reorg between eras: track via `district_history (church_id, data_year, district_code)`.

## Layout
- `supabase/migrations/` — SQL, applied via Supabase session pooler.
- `src/lib/supabase/` — server + browser clients (`@supabase/ssr`).
- Parsers (forthcoming) → `scripts/parsers/era_a/`, `scripts/parsers/era_b/`.

## Discovery doc
`~/wroot-labs/notes/rio-texas-journal-discovery.md` — full corpus map, schema rationale, TBDs.

## Sibling repos
- `rio-texas-conference` — standing rules
- `rio-texas-resolutions` — resolution pipeline (Prisma 7)
