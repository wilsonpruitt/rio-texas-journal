# Rio Texas — what we can build on the GCFA church dataset

**Dataset:** 25 years (2000–2024) of GCFA local-church statistical tables, 485 churches keyed by
stable GCFA number, ~1.08M stat cells, spanning the Rio Grande + Southwest Texas → Rio Texas
(2014) merger. Codebook = 225 canonical fields. See `gcfa/qa_report.txt`.

## The four the site is being built around
1. **Trend projection** — per-church forecasts of membership / attendance / giving from the 25-yr series.
2. **Closure / vitality risk** — risk score trained on churches that actually closed or disaffiliated in the data (we can *see* the churches that dropped out and when). Headline feature.
3. **Peer benchmarking** — "churches like yours" by size, district, ethnicity, community demographics.
4. **Growth-driver analysis** — which inputs (baptisms, professions, online worship, formation groups) precede later growth, conference-wide.

## 5–10 more, in rough priority order

5. **Apportionment lens (FairShare crossover) — strongest.** The Rio Texas formula is a 2-yr average
   of Table II operating-expense lines (L41–47) ÷ conference base. Those lines are in this dataset
   back to 2000, so we can (a) reconstruct each church's apportionment base over 25 yrs, (b) show
   how a church's "fair share" moved with its spending, (c) project next year's apportionment from the
   trend, and (d) flag churches whose apportionment base is rising while membership falls (stewardship
   stress). FairShare already owns the formula + the $101.3M conf base + locked-July LCR logic — this
   becomes a shared engine.

6. **The merger story (2014), quantified.** Two conferences become one. Show side-by-side
   Rio Grande vs Southwest Texas trajectories pre-2014, the combined Rio Texas after, and which
   legacy-conference churches fared better/worse post-merger. Nobody has visualized this.

7. **Disaffiliation / closure autopsy.** ~210 churches present in 2000 are gone by 2024. Map and
   timeline *when* and *where* churches left, against the 2019–2023 disaffiliation wave. Cross with
   the existing `import-disaffiliations.ts` data already in the repo.

8. **Ethnicity & the Hispanic-ministry through-line.** Rio Grande was historically the Hispanic-heritage
   conference. Track MEMBH and church_ethnicity over 25 yrs — where Hispanic ministry grew, held, or
   was lost through the merger. Distinctive to this conference; ties to Wilson's context.

9. **Engagement-ratio health metrics, not raw counts.** Derived ratios that survive size differences:
   attendance/member, baptisms/member, professions/loss, formation-participation/member, giving/member.
   These are the real vitality signals and feed both the risk model (#2) and benchmarking (#3).

10. **District & community fit (Census/Mapbox).** Geocode every church, pull ACS tract demographics,
    and show church trajectory vs *its neighborhood's* trajectory — churches declining in growing areas
    (missed opportunity) vs declining with their area (demographic headwind). Directly actionable for
    a DS / cabinet.

11. **"State of the Conference" auto-report.** One generated PDF/print piece per year (or per district)
    off the same data — totals, biggest movers, closures, projections. Echoes the Right Start / press-brief
    pattern and gives the cabinet something tangible for annual conference.

12. **Cohort survival curves.** Group churches by 2000 size band and plot survival + median membership
    over 25 yrs — "of churches under 50 members in 2000, X% still report in 2024." Classic, sobering, shareable.

## Notes
- 28 older benevolence/apportionment line-items (CSADULT, UMMPROJ, GENCHOFF, AOADULT…) appear in
  2000–2008 sheets but aren't in the 225-field codebook — captured under raw codes, currently unlabeled.
  Worth a small hand-built label map if the finance/apportionment angles (#5) go deep.
- City is sparse for long-closed churches (old layout stored it as "Location"); fine for geocoding
  active churches, will need address fallback for closed ones.
