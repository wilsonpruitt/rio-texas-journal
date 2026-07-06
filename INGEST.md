# Ingestion adapters

See `~/wroot-labs/notes/conference-atlas-architecture.md` §4 for the full rationale.
This doc is the concrete, in-repo version: what each adapter emits, and each
adapter's status.

## The interchange contract

Every adapter's job is to produce the same artifacts under `scripts/data/gcfa/`
(gitignored — regenerate, don't commit):

| File | Shape | Consumer |
|---|---|---|
| `codebook.json` | `{code, label, question, table, category}[]` — canonical stat fields | `import-gcfa.ts` (upserts `stat_field`) |
| `fields.json` | same fields, keyed for FK coverage | `import-gcfa.ts` |
| `churches.json` | one record per GCFA number (latest-known identity + history span) | `import-gcfa.ts` (upserts `church`), `scripts/lib/par-model.ts` (`buildContext`) |
| `church_stats.csv` | long format: `gcfa_number,data_year,conference,field_code,value_numeric,value_text` | human review / debugging |
| `church_stats.jsonl` | same rows, one JSON object per line | `import-gcfa.ts` (bulk-inserts `church_stat`), `scripts/lib/par-model.ts` (`loadStats`) |
| `qa_report.txt` | coverage / sanity summary | human review |

Everything downstream — `import-gcfa.ts`, the PAR/viability/insights build
scripts, the app — reads only these artifacts (or the Supabase rows they load
into) and the per-conference `conferences/<slug>/` payloads (districts, hand-maps,
config). None of it is adapter-specific. A new adapter for a new conference only
has to emit these same files; nothing downstream needs to change.

Load order into Supabase (`import-gcfa.ts`, after the schema migrations are
applied): `stat_field` ← `fields.json`, then `church` ← `churches.json`
(attaches to existing rows by normalized name where possible), then
`church_stat` ← `church_stats.jsonl` (batched, re-runnable).

## Adapters, in preference order

Declared per conference in `config.ingest.adapters` (see `conference-config.ts`).

### 1. `gcfa-extract` — Phase-1 onboarding path

`scripts/data/extract_gcfa.py <path-to-xlsx>`. Parses the GCFA local-church
statistical-table service-ticket workbook (one sheet per year) into the
interchange artifacts above. The workbook format is nationwide — this script is
already ~the universal adapter; only the default workbook path is
per-conference, looked up by `CONFERENCE_SLUG` in the script's
`DEFAULT_WORKBOOKS` dict (mirrors the same slug-keyed-registry pattern as
`src/lib/conference.ts`). Every conference can request the same service ticket
Wilson filed with GCFA. Status: **built, in production use** (Rio Texas).

### 2. `ezra-export` — Tier-B engagement

Appointment ledger with real dates/roles/fractions (would kill the ~22%
appointment-parsing loss this repo currently eats via journal-PDF fallback →
PAR v2), plus monthly remittances. Status: **not built** — no real EZRA export
file exists yet to write the adapter against. Do not guess the format in
advance; write it at the first Tier-B engagement.

### 3. `spreadsheet` — staff-maintained drops

Thin per-file mappers for things a conference office hands over directly:
rosters, finance series (`conference-finance.json`). Status: **ad hoc today**
(Rio Texas's `conference-finance.json` is hand-entered from audit reports, not
scripted) — formalize into a real mapper only if a second conference needs one.

### 4. `journal-pdf` — last-resort ingestion

`scripts/parsers/era_a/` (2015–~2022, wide landscape) and `scripts/parsers/era_b/`
(~2023–2025, narrow per-topic) are Rio Texas's own journal-PDF parsers. Status:
**reference implementations of last resort**, not the product — per-conference
PDF layouts are bespoke consulting work, priced into the engagement, and should
live under that conference's own `conferences/<slug>/` dir if a second
conference ever needs one (not moved there yet for Rio Texas — cosmetic,
deferred per the extraction plan).

## Phase-1 corollary

The descriptive atlas, viability, finance scenarios, and charge-scouting
modules need only adapter 1 (`gcfa-extract`) + a district map + census data —
no appointment parsing at all. That's the realistic "weeks, not months"
onboarding path for a new conference. The PAR and clergy-lifecycle modules
depend on appointment data and wait for adapter 2 or bespoke journal-PDF work,
by design — don't build them speculatively ahead of real appointment data.
