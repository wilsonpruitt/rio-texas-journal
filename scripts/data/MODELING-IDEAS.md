# Rio Texas Atlas — modeling ideas & data wishlist

Written 2026-06-12 while building the `/conference` finance scenario tool. Captures
analyses worth building next and data that would unlock new modeling. The headline:
**we have far more loaded than we're showing.** The GCFA import carries ~218 fields
per church (2000–2024) — property value, debt, clergy compensation, program/operating
expense, membership inflows/outflows, professions, baptisms — and we currently surface
a handful. Most ideas below need no new data, just new queries.

## A. Analyses buildable with data ALREADY loaded

1. **Disaffiliation financial impact (quantified).** Sum the last-reported `APPPAID`/`TOTAPP`
   of the 118 disaffiliated churches → "their departure removed ~$X/yr from the apportionment
   base." Pair with the `/conference` reserves model: drop that revenue and re-run the projection.
   *High value, low effort — one query.*

2. **Does paying apportionments predict survival?** Per-church payout ratio (`APPPAID/TOTAPP`)
   over time vs outcome (active/closed). Are faithful-paying churches more likely to endure?
   Correlation only, but a striking story either way.

3. **The engagement gap.** Worship/membership ratio per church and conference-wide over 25 yrs.
   A falling ratio is an earlier warning than membership itself. Already have both fields; add a
   ratio trend + flag churches whose ratio is sliding fastest.

4. **Asset-rich, member-poor watch.** GCFA fields 24–27 (land/building value, liquid assets, debt)
   are loaded. Cross property value against size/trajectory to surface churches sitting on valuable
   real estate while declining — the closure-and-asset-disposition question the conference will face.

5. **Cohort survival curves (Kaplan–Meier).** Of churches in size band X / ethnicity Y / district Z
   in 2005, what fraction survive to 2024? Survival curves by segment. We have the full 25-yr panel.

6. **Discipleship productivity.** Professions of faith and baptisms per 100 members, by church and
   context. Who actually makes new disciples efficiently — and what do they have in common?

7. **Apportionment burden vs capacity (FairShare crossover).** Apportionment as % of operating
   expense / grand total per church. Who is over- or under-assessed relative to capacity? Feeds the
   FairShare product and a district-equity view.

8. **Merger/consolidation candidates.** Using lat/lng + size + trajectory: clusters of small,
   declining, geographically-close churches that could combine. A map layer + ranked list.

9. **Neighborhood-context model.** We already enrich ACS demographics by ZIP. Merge median income,
   age, race, population change against church growth → "given this church's community, expected
   trajectory," and residuals = churches over/under-performing their context (the real bright spots).

10. **Expected years-to-closure.** Extend the closure-risk score into a time estimate for at-risk
    churches (survival regression on the historical closure record).

## B. Scenario-tool extensions (building on /conference)

- **Disaffiliation/closure levers.** "Close the bottom N at-risk churches" or "lose another wave of
  disaffiliations" → impact on apportionment base and reserves.
- **Per-district scenarios.** Run the what-if per 2025 district, not just conference-wide.
- **Church-level what-if.** On a church page: "if worship grows X%/yr, here's the risk-score change."
- **Uncertainty bands.** Monte-Carlo the projection (sample growth rates from historical variance)
  for a fan chart instead of a single line.

## C. Data that would unlock more

| Want | Why | Source |
|---|---|---|
| **Conference budget by fund** (the 6-fund $ schedule) | We have the $5.55M total + category names, not the per-fund split → enables budget-vs-actual by ministry | Journal budget exhibit (Wilson to locate) |
| **Pre-2016 audited finance** (FY2014–2015) | Extend the finance series; the 3-col audit format is fixable | journals/2015–2016.pdf (already local) |
| **Pastoral appointment / tenure** | Does turnover frequency predict decline? We HAVE this data (pivoted away) — just relink | already loaded (clergy tables) |
| **Disaffiliation settlement $** | What each church paid to leave; the cost of the split | conference discernment records |
| **2025/2026 actuals** | Keep models current as new journals drop | future journals |
| **Other-conference benchmarks** | How Rio Texas compares nationally | GCFA national datasets (data.gcfa.org) |
| **Worship-service counts / multisite flags** | Distinguish multisite growth from single-site | GCFA fields / journal |

## D. Quick wins (do these first)
- A1 disaffiliation $ impact (one query + a `/conference` lever)
- A3 engagement-gap flag on church pages (data in hand)
- A4 asset-rich/member-poor list (fields already loaded)
- B1 closure/disaffiliation lever in the scenario tool
