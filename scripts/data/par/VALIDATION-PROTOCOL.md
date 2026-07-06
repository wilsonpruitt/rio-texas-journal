# PAR — Conference #2 Validation Protocol (pre-registered)

*v1, 2026-07-06. Companion to `METHODOLOGY.md`. This document is written and
committed BEFORE any second conference's data has been received or examined.
The commit hash of this file, and of the model code it references
(`scripts/lib/par-model.ts`), timestamp the pre-registration.*

## Why this document exists

The Rio Texas results (holdout correlation 0.578, split-half r = 0.52) were
produced on the same data the model was developed against. Development and
confirmation on one dataset — however honest the holdout split — cannot rule
out that the modeling choices quietly fit that conference's quirks. The test
that counts is a second conference, and the test only counts if the analysis
plan and the pass/fail thresholds are fixed **before** anyone sees the data.
This document fixes them. Every threshold below was chosen with visibility
into Rio Texas results only; none may be revised after conference-2 data
arrives except through the deviations log (§7), which is published either way.

## 1. What transfers and what is re-estimated

This is a **replication of the method, not a transfer of the fitted model**.
No Rio Texas parameter estimate is applied to another conference's churches.

**Frozen (structural — identical code, identical constants):**

| Item | Value |
|---|---|
| Model form | expected = exposure × Y(t) × M(c,t) × G(z) |
| Count frame | Gamma-Poisson; uncertainty = ±√(φ·expected) |
| Membership gate | 25 members at arrival (`GATE_MEMBERS`) |
| Trailing window | 3 years (`TRAIL`) |
| Church prior strength | 5 expected professions (`STRENGTH_CHURCH`) |
| Cohort prior strength | 50 (`STRENGTH_COHORT`) |
| Growth-corrector shrinkage | 100 (`S` in `growthAdjust`) |
| Size bands | <50 / 50–99 / 100–249 / 250–499 / 500+ |
| Cohort dimensions | size band × favorability tercile × ethnicity (3-level) |
| Favorability | within-conference percentile of (income z − poverty z), ACS by ZIP |
| Exposure | last reported membership in [t−3, t−1] |
| Forecast Y | flat mean of last 3 observed full years (never extrapolated) |
| Attribution rules | full-year incumbency only; transition years excluded, not split; associates and co-pastors never credited; multi-pastor church-years dropped; PAR/yr shrunk by +2 years |

**Re-estimated per conference (by the same code, from that conference's data
only):** year effects Y(t); cohort tables; charge propensities; favorability
percentiles; ZIP-growth terciles and corrector; overdispersion φ; the
name-reconciliation hand map.

**One declared adaptation.** The 3-level ethnicity dimension is defined as:
*the two largest `church_ethnicity` categories by church count within the
conference, plus Other*. In Rio Texas this yields Hispanic/White/Other; in
another conference it may yield e.g. Black/White/Other. The rule — not the
Rio Texas categories — is what transfers. This is declared now so it cannot
be mistaken for a post-hoc choice.

## 2. Stage 0 — Data sufficiency (hard gate)

Run before any model code:

- **G0.1** GCFA-format statistical tables containing the professions series
  (`RECPROF`) and total membership (`MEMBTOT`) for **≥ 12 consecutive data
  years** ending no more than 2 years before the run.
- **G0.2** Appointment records (journal or cabinet) with arrival years,
  covering **≥ 8 appointment years**, distinguishing local-church charges
  from extension/conference posts.
- **G0.3** Church ZIP codes for ≥ 90% of active churches; an ethnicity field
  present.
- **G0.4** Partial reporting years identified by rule: a data year in which
  fewer than 90% of the trailing-3-year average number of churches reported
  is **partial** — excluded from training and from all holdout comparisons,
  scored only where the church reported. The list of partial years is fixed
  at Stage 0 and published.

Fail any of G0.1–G0.3 → stop. The engagement produces a data-inventory memo,
not model results.

## 3. Stage 1 — Linkage gate (hard gate)

Same reconciliation pipeline as Rio Texas (`reconcile-appointment-churches.ts`
token matcher + a conference-specific hand map; analysis-time mapping only, no
database mutation).

- **G1.1 (pass/fail):** ≥ **75%** of local-church appointment stints resolve
  to a GCFA church number. Extension ministries and conference/district posts
  are excluded from the denominator by design. (Rio Texas: 77.6%.)
- **G1.2 (bias check, reported):** median membership of unlinked churches vs
  linked. If they differ by more than 2×, the linkage is size-biased and every
  downstream result carries that caveat in its first sentence.

Fail G1.1 → stop. Publish the linkage rate and the failure modes; no model
results.

## 4. Stage 2 — Year-effect shape (pre-registered diagnostic)

Compute Y(t) = conference-wide professions per member per year. Before any
holdout scoring, check the series against three expectations that any UMC
conference's data should satisfy if it measures the same phenomenon:

- **E2.1 Secular decline:** mean Y over the 3 most recent full years < mean Y
  over 2015–2017.
- **E2.2 COVID trough:** Y(2020) is the minimum of the 2015–2023 series, or
  within 10% of the minimum.
- **E2.3 Magnitude:** every Y(t) lies in [0.1, 4.0] per 100 members.
  (Rio Texas ran 1.69 → 0.35 → ~0.5.)

These are not model quality tests — they are checks that the input data means
what it claims. An unexplained failure (especially E2.3, which indicates a
units or parsing error) stops the run until the provenance is resolved and
the resolution documented. An explained deviation (e.g., a conference that
genuinely lacked a COVID collapse) is logged and the run proceeds.

## 5. Stage 3 — Holdout calibration (primary model test)

**Split rule (adaptive, fixed now):** let T = the latest full (non-partial)
data year. Train cohort tables and the growth corrector on years ≤ T−4.
Score years T−1 and T. (For Rio Texas this reproduces the published
train ≤2019 / test 2022–23 split with T = 2023.)

**Comparators**, computed on exactly the same church-years: (a) size-only
(exposure × Y(t)); (b) naive (last reported professions value carried
forward). Report n.

**Confirmatory sample size:** the holdout must contain **≥ 300 church-years**
for pass/fail language to apply (Rio Texas: 622). Below 300, the same numbers
are reported with intervals as descriptive estimates and no validation claim
is made either way.

**Pass criteria** (Rio Texas values in parentheses; margins are set at
roughly half the Rio Texas margin, because honest replications attenuate):

- **P3.1 (required):** corr(model, actual) ≥ corr(size-only, actual) + 0.08.
  (RT: 0.578 vs 0.395, margin +0.183.)
- **P3.2 (required):** MAE(model) ≤ 1.05 × MAE(naive).
  (RT: 1.816 vs 1.825, ratio 0.995.)
- **P3.3 (required):** decile calibration ratio (actual/expected) within
  [0.75, 1.30] for each of the three deciles carrying the most professions
  volume. (RT: 0.90 / 1.04 / 0.95.)
- **P3.4 (reported, not gating):** corr(model) ≥ corr(naive). (RT margin was
  +0.035 — real but slim; the claim that matters is P3.1, plus the structural
  fact that the naive forecast is undefined at a pastoral transition, which
  is the use case.)

**φ check (reported):** re-estimate overdispersion; expectation φ ∈ [2, 10]
(RT: 4.8). Outside that range is not a failure but is flagged and
investigated.

## 6. Stage 4 — Split-half replication (pastor-signal test)

Construction identical to Rio Texas: for every pastor with ≥ 2 scoreable
stints, correlate shrunk PAR/yr between the two longest stints.

- **Power gate:** ≥ **15 pastor pairs** required for confirmatory language.
  Below 15, the estimate is reported as descriptive only. (RT: n = 22.)
- **P4.1 Directional pass:** r ≥ 0.20.
- **P4.2 Confirmatory pass:** one-sided p < 0.05 for r > 0. (At n = 15 this
  requires r ≈ 0.44; at n = 30, r ≈ 0.31. RT's r = 0.52 at n = 22 clears it,
  p ≈ 0.006.)
- **P4.3 Pooled estimate (reported):** Fisher-z–weighted combination of the
  Rio Texas pairs and conference-2 pairs, with 95% CI. Any
  connection-level claim about pastor-signal persistence rides on this
  pooled number, not on either conference alone.

## 7. Stage 5 — Ceiling-audit replication (pre-registered secondary analysis)

This stage is **not a model gate**. Whether the appointment-ceiling finding
replicates says nothing about model validity; it is pre-registered so that
the substantive result is credible whichever way it comes out — and so that
a null result cannot be quietly shelved.

Method fixed: gender inferred from first names by the same procedure as
`scripts/analysis/par_gender.py`; coverage reported; **≥ 70% coverage
required to run the stage** (RT: 81%). All analyses on scored stints only.
Aggregates only are retained (no names), matching `gender-aggregates.json`.

Directional hypotheses (RT values in parentheses):

- **H5.1 Parity through the middle:** ratio of median arrival membership,
  F/M, within [0.8, 1.25]. (RT: 183/188.)
- **H5.2 Ceiling at the top:** share of male pastors' stints at arrivals
  ≥ 750 members ≥ 1.5 × the corresponding female share. (RT: 14% vs 7%, 2×.)
- **H5.3 Performance does not explain it:** female mean PAR/yr ≥ male mean
  PAR/yr − 0.2. (RT: −0.27 vs −0.57 — women slightly ahead.)

Small-cell rule: if fewer than 10 female stints exist at a threshold, report
raw counts, not proportions, and make no replication claim for that
hypothesis. "The ceiling replicates" may be said only if all three hold; all
three are published regardless.

## 8. Claim ladder

What may be said publicly after the run is bound to the results, in advance:

| Result | Permitted claim |
|---|---|
| Stage 0 or 1 fails | Data-quality memo only. No model results exist. |
| Gates pass; any of P3.1–P3.3 fails | "The model did not validate in this conference." Full numbers published; diagnosis offered; no expected-professions product claims for this conference. |
| P3.1–P3.3 pass | "The expected-professions model validates out of sample in a second conference." |
| + P4.2 passes | "Pastor PAR persists across appointments in a second conference." Otherwise only the pooled P4.3 estimate is quoted, labeled as pooled. |
| + H5.1–H5.3 hold | "The appointment-ceiling finding replicates." Otherwise: "the ceiling finding did not replicate here," stated with the numbers. |

No intermediate marketing language ("promising," "directionally consistent")
substitutes for a failed gate.

## 9. Disclosure and deviations

- The full stage-by-stage results — passes and failures — are delivered to
  the partner conference regardless of outcome.
- Any deviation from this protocol (a threshold touched, a stage reordered, a
  rule reinterpreted) is recorded in a **deviations log** appended to the
  results report, with the reason. A run with an empty deviations log is the
  goal; a run with an honest one is acceptable; a run with a silent one is
  worthless.
- The results report records the git commit hashes of this protocol and of
  the model code as run.
- Scope note: this protocol covers the PAR expected-professions model only.
  The viability and compensation-equity models (Conference Atlas Tier A)
  are separate instruments and will carry their own protocols before any
  second-conference claims are made for them.
