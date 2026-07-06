# PAR — Professions of Faith Above Replacement

*Methodology note, v1 (2026-07-05). Rio Texas Conference pilot, GCFA local-church
statistical tables 2000–2024 + conference journal appointment records 2015–2025.*

## The problem

Appointment-making runs on impressions. A pastor at a large, affluent, growing
charge posts big numbers and gets credit for the charge; a pastor who takes a
bleeding church to a plateau posts declining numbers and gets blamed for the
context. Raw statistics can't distinguish the two — but statistics *relative to
a context-adjusted expectation* can. Baseball solved this problem with WAR:
value above what a freely available replacement would produce in the same
lineup. PAR applies the same idea to the one statistic that most directly
measures the church's core calling: **professions of faith**.

## Two layers

**Layer 1 — the charge model (shareable).** For every charge and year, an
expected number of professions of faith *regardless of who is appointed there*:

```
expected(c, t) = exposure(c, t) × Y(t) × M(c, t)
```

- **exposure** — membership entering the year (last reported total before *t*).
- **Y(t)** — the conference-wide professions-per-member rate that year. This is
  the *year effect*: it absorbs the secular decline (1.69 per 100 members in
  2015 → ~0.5 in 2023) and the COVID collapse (0.35 in 2020), so a 2020 pastor
  is scored against 2020, not 2015.
- **G(z)** — a community-growth corrector: ZIP population growth across two ACS
  vintages (2018→2023), applied as a shrunk tercile multiplier estimated on the
  model's own residuals. Fast-growing ZIPs run slightly above a growth-blind
  expectation; the corrector prices that in (`fetch-zip-growth.ts`).
- **M(c, t)** — the charge's *propensity multiplier*: an empirical-Bayes blend
  of its own trailing 3-year professions record with its cohort's rate, where a
  cohort is size band × community favorability tercile (ACS income/poverty by
  ZIP) × ethnicity. Prior strength = 5 expected professions, so a small church
  sits near its cohort and a large church carries its own history. Cohorts are
  themselves shrunk toward the conference mean.

The model is count-based (Gamma-Poisson), so zeros are natural and every
quantity is a number of people, not a transformed index. Uncertainty band =
±√(φ·expected), φ = 4.8 (empirical overdispersion — professions are ~5× noisier
than a Poisson process, mostly confirmation-class lumpiness).

**Layer 2 — pastor PAR (restricted).** For each appointment stint, freeze the
charge *as received*: size and trailing professions record fixed at arrival, so
a plum assignment carries a high expectation and the pastor's own effect never
leaks into their own baseline. Only the conference climate Y(t) rolls forward.

```
PAR(year)  = actual professions − expected(charge-as-received, year)
PAR/yr     = Σ PAR / years scored          (shrunk: Σ PAR / (years + 2))
```

## Attribution rules (v1)

- UMC appointment years run July–June; GCFA data years are calendar. A data
  year is credited only under **full-year incumbency**; transition years are
  excluded, not split.
- Associate and co-pastor stints are never credited. Church-years where two or
  more pastors qualify are **dropped as ambiguous**, not guessed.
- Charges under 25 members at arrival are not scored (denominators are noise).
- Multi-point charges: each church scored separately against its own baseline;
  a pastor's stints sum.

## Validation (out of sample)

Cohorts trained on ≤2019, scored on 2022–2023 (n = 622 church-years):

| | model | size-only | naive (last value) |
|---|---|---|---|
| MAE | **1.82** | 2.03 | 1.83 |
| correlation with actual | **0.578** | 0.395 | 0.543 |

Decile calibration is near 1.0 through the deciles that carry the volume (d8
0.90, d9 1.04, d10 0.95); the model neither inflates nor deflates expectations
where the professions actually are. The model edges the naive forecast on MAE and beats it clearly on correlation —
the charge's own recent record *is* most of the signal, properly regularized — and, unlike the naive number, produces an
expectation that is *defined at a pastoral transition*, which is the entire
use case.

**Pastor-level signal.** 862 pastor-years scored across 307 stints / 256
pastors (2015–2024). Mean PAR/yr = 0.00 by construction. **Split-half
reliability: r = 0.52** across the two longest stints of the 22 pastors with
two or more scoreable appointments — a pastor's PAR meaningfully persists when
they move to a *different* charge, which is the test of whether PAR measures a
pastor rather than a place. (n = 22 is small; this number should be re-estimated
first with each new journal year, and against a second conference's data before
anyone leans on it.)

## Data pipeline

- GCFA tables: `RECPROF` (2000–2024, the consistent professions series;
  `RECCONF` exists only 2017+ and is excluded). Membership-flow family
  (`REMCHR/REMWITH/REMUMC/REMOTH` = non-natural removals, `REMDEATH`,
  `RECUMC/RECOTH/RECREST` = transfers/restorations) reported alongside PAR so
  professions are never read in isolation from "people leaving."
- Appointments: journal Section I career blocks + Section F (2025). 77.6% of
  local-church appointment stints resolve to a GCFA church number after
  token-set reconciliation (`reconcile-appointment-churches.ts`); extension
  ministries and conference/district posts are excluded from the denominator
  by design.
- 2024 is a partial reporting year (248 of ~330 churches); it is scored only
  where the church reported and excluded from training.

## Known limitations (v1)

1. **Community favorability is a 2023 snapshot** applied to all years. Population
   growth IS included (two ACS vintages) but as a coarse tercile corrector; a
   residual growth gradient remains at small-church level (r≈0.11).
2. **Long tenures** are scored against an as-received baseline that goes stale;
   past ~6 years the expectation says less.
3. **Appointment parsing** loses ~22% of local-church stints (glyph-mangled
   PDF text) and cannot yet distinguish senior from associate before 2025
   except by heuristic.
4. **Professions ≠ ministry.** PAR measures one output. It says nothing about
   faithfulness, pastoral care, justice ministry, or the pastor who held a
   grieving congregation together through a disaffiliation vote. It is one
   instrument on the panel, never the panel.

## Replicating in a second conference

Every number above was produced on the data the model was developed against.
Before any validation claim is made for a second conference, the analysis runs
under the **pre-registered protocol in `VALIDATION-PROTOCOL.md`** (same
directory): data-sufficiency and linkage gates, a year-effect shape check,
holdout calibration thresholds, split-half replication, and the ceiling-audit
secondary analysis — all with pass/fail criteria fixed before that
conference's data is seen, and all results disclosed whichever way they come
out.

## Use guardrails

- Never publish or circulate a pastor ranking without its uncertainty; a
  stint of 2–3 years is mostly noise (φ = 4.8).
- Pastor-level output is restricted to conference-level personnel use
  (cabinet, BOM, COSROW). The charge-level model is the shareable artifact.
- The equity use case is the point: PAR surfaces the pastor whose plateau was
  a bigger lift than another's growth, and prices the head start a plum
  assignment gives. Read it that direction — as a corrective to impression
  bias — not as a league table.
