/**
 * Build the frozen baseline for the Río Texas Strategic Priorities Scorecard.
 *
 * Primary source: scripts/data/gcfa/church_stats.jsonl — the full GCFA
 * statistical panel (field-coded), filtered to the "Río Texas" era (2015+,
 * first full reporting year after the 2014 merger). Supplements: the conference
 * audit (conference-finance.json), the clergy roster (exports/final-2.csv), and
 * Atlas's church-status panel for closures/disaffiliations + committee rosters.
 *
 * Per the scorecard methodology: "Set a baseline and freeze it." This writes the
 * frozen JSON the standalone scorecard site reads; recompute only to re-baseline.
 *
 *   node --experimental-strip-types scripts/build-scorecard-baseline.ts [out.json]
 */
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const GCFA = new URL("./data/gcfa/church_stats.jsonl", import.meta.url).pathname;
const FINANCE = new URL("./data/conference-finance.json", import.meta.url).pathname;
const ROSTER = new URL("../exports/final-2.csv", import.meta.url).pathname;
const COMMITTEES = "/Users/wilsonpruitt/atlas/data/committee-demographics.csv";
const ERA = "Río Texas"; // conference label in the panel is "Rio Texas"
const ERA_LABEL = "Rio Texas";
const ERA_START = 2015;

/* ── 1. Stream the GCFA panel once ──────────────────────────────────────── */
// Sum codes per year; collect per-church positive values for medians.
const SUM_CODES = new Set([
  "MEMBTOT", "AVATTWOR", "ONLNWOR", "RECPROF", "NUMBAPT", "CFTOTAL",
  "TOTAPP", "APPPAID", "RECUMC", "RECOTH",
  "MEMBH", "MEMBW", "MEMBAAB", "MEMBA", "MEMBN", "MEMBFEM", "MEMBMALE",
]);
const MEDIAN_CODES = new Set(["RECPROF", "AVATTWOR"]);

type YMap = Map<number, Map<string, number>>; // year -> code -> sum
const sums: YMap = new Map();
// year -> code -> gcfa -> value (last seen positive)
const perChurch = new Map<number, Map<string, Map<string, number>>>();

function bump(y: number, code: string, v: number) {
  let m = sums.get(y);
  if (!m) sums.set(y, (m = new Map()));
  m.set(code, (m.get(code) ?? 0) + v);
}

await new Promise<void>((resolve) => {
  const rl = createInterface({ input: createReadStream(GCFA), crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line) return;
    let o: any;
    try { o = JSON.parse(line); } catch { return; }
    if (o.conference !== ERA_LABEL) return;
    if (o.value_numeric == null) return;
    const code = o.field_code as string;
    const y = o.data_year as number;
    if (y < ERA_START) return;
    if (SUM_CODES.has(code)) {
      if (code === "MEMBTOT" && o.value_numeric === 0) return; // exit artifact
      bump(y, code, o.value_numeric);
    }
    if (MEDIAN_CODES.has(code) && o.value_numeric > 0) {
      let ym = perChurch.get(y);
      if (!ym) perChurch.set(y, (ym = new Map()));
      let cm = ym.get(code);
      if (!cm) ym.set(code, (cm = new Map()));
      cm.set(o.gcfa_number, o.value_numeric);
    }
  });
  rl.on("close", () => resolve());
});

const years = [...sums.keys()].sort((a, b) => a - b);
const get = (y: number, code: string) => sums.get(y)?.get(code) ?? 0;
function series(code: string, opts: { from?: number } = {}) {
  return years
    .filter((y) => y >= (opts.from ?? ERA_START) && (sums.get(y)?.has(code) ?? false))
    .map((y) => ({ year: y, value: Math.round(get(y, code)) }));
}
function medianSeries(code: string) {
  return years
    .filter((y) => (perChurch.get(y)?.get(code)?.size ?? 0) > 0)
    .map((y) => {
      const vals = [...perChurch.get(y)!.get(code)!.values()].sort((a, b) => a - b);
      return { year: y, value: vals[Math.floor(vals.length / 2)], n: vals.length };
    });
}
function change(s: { year: number; value: number }[]) {
  if (s.length < 2) return null;
  const a = s[0], b = s[s.length - 1];
  return {
    fromYear: a.year, toYear: b.year, from: a.value, to: b.value,
    change: a.value ? (b.value - a.value) / a.value : null,
    direction: b.value > a.value ? "up" : b.value < a.value ? "down" : "flat",
  };
}
const latest = (code: string) => {
  const s = series(code);
  return s.length ? s[s.length - 1].value : 0;
};
const BASELINE_YEAR = years[years.length - 1];

/* ── 2. Apportionment payout rate (TOTAPP vs APPPAID) ───────────────────── */
const apptSeries = years
  .filter((y) => get(y, "TOTAPP") > 0)
  .map((y) => ({
    year: y,
    asked: Math.round(get(y, "TOTAPP")),
    paid: Math.round(get(y, "APPPAID")),
    rate: get(y, "APPPAID") / get(y, "TOTAPP"),
  }));
const apptLatest = apptSeries[apptSeries.length - 1];
const apptPeak = apptSeries.reduce((m, a) => (a.rate > m.rate ? a : m), apptSeries[0]);

/* ── 3. Conference net assets (audit) ───────────────────────────────────── */
const finance: any[] = JSON.parse(readFileSync(FINANCE, "utf8"));
const netAssetsSeries = finance
  .filter((r) => r.net_assets_eoy != null)
  .map((r) => ({ year: r.data_year, value: r.net_assets_eoy, source: r.source }))
  .sort((a, b) => a.year - b.year);
const netAssetsLatest = netAssetsSeries[netAssetsSeries.length - 1];

/* ── 4. Clergy roster snapshot (attrition baseline) ─────────────────────── */
function parseCSV(text: string): Record<string, string>[] {
  const recs: string[][] = [];
  let f = "", row: string[] = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(f); f = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some((c) => c.length)) recs.push(row); row = []; }
    else f += ch;
  }
  if (f.length || row.length) { row.push(f); if (row.some((c) => c.length)) recs.push(row); }
  const h = recs.shift() || [];
  return recs.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}
// appointment-stints.csv: one row per clergy×church stint with start/end years,
// parsed across the 2014–2025 clergy records. "Active" in year Y = holding an
// appointment to a Río-family church (not an out-of-conference one) that spans Y.
const STINTS = new URL("./analysis/clergy-tenure/appointment-stints.csv", import.meta.url).pathname;
let clergy: any = { measurable: "Public", kind: "outcome", blank: true, reason: "appointment-stints.csv not found." };
let clergyPipeline: any = null;
try {
  const stints = parseCSV(readFileSync(STINTS, "utf8"));
  const ooc = /^[A-Z]{2,4} Conf -/; // out-of-conference churches
  const local = stints.filter((r) => r.church && !ooc.test(r.church));
  const Y0 = 2014, Y1 = 2025;
  const activeBy: Record<number, Set<string>> = {};
  for (let y = Y0; y <= Y1; y++) {
    const set = new Set<string>();
    for (const r of local) {
      const s = +r.start, e = +r.end;
      if (s && e && s <= y && y <= e) set.add(r.name);
    }
    activeBy[y] = set;
  }
  const activeSeries: { year: number; value: number }[] = [];
  const churn: { year: number; exits: number; entrants: number }[] = [];
  for (let y = Y0; y <= Y1; y++) {
    activeSeries.push({ year: y, value: activeBy[y].size });
    if (y < Y1) {
      let exits = 0, entrants = 0;
      for (const x of activeBy[y]) if (!activeBy[y + 1].has(x)) exits++;
      for (const x of activeBy[y + 1]) if (!activeBy[y].has(x)) entrants++;
      churn.push({ year: y, exits, entrants });
    }
  }
  // BAC flow breakdown (build-clergy-flows.ts) — exits split into ordinary
  // attrition vs. the disaffiliation withdrawal spike, plus entrants (net flow)
  // and the certified-candidate pipeline.
  let bacExits: any = null;
  let bacEntrants: any = null;
  try {
    const flows = JSON.parse(readFileSync(new URL("./clergy-flows.json", import.meta.url).pathname, "utf8"));
    bacExits = flows.rows.map((r: any) => ({
      year: r.year,
      retired: r.retired,
      transferredOut: r.transferredOut,
      withdrawn: r.withdrawn, // disaffiliation-driven from 2023
      ordinary: r.retired + r.transferredOut,
      totalExit: r.retired + r.transferredOut + r.withdrawn,
    }));
    bacEntrants = flows.rows.map((r: any) => {
      const e = r.entrants;
      const total = e.commissioned + e.ordainedDeacon + e.ordainedElder + e.receivedTransfer + e.receivedDenom;
      return {
        year: r.year,
        commissioned: e.commissioned,
        ordained: e.ordainedDeacon + e.ordainedElder,
        received: e.receivedTransfer + e.receivedDenom,
        total,
        net: total - (r.retired + r.transferredOut + r.withdrawn),
      };
    });
    // Certified-candidate pipeline (¶310). Parses cleanly 2016–2025 across all
    // three BAC layouts (comma table, era-B columns). 2015 is excluded: the
    // first-merged-year journal uses an older "First Last, YYYY" form.
    const candSeries = flows.rows
      .filter((r: any) => r.candidates && r.year >= 2016)
      .map((r: any) => ({
        year: r.year,
        total: r.candidates.total,
        newly: r.candidates.newly,
        discontinued: r.candidates.discontinued,
      }));
    const peak = candSeries.reduce((m: any, c: any) => (c.total > m.total ? c : m), candSeries[0]);
    const troughC = candSeries.reduce((m: any, c: any) => (c.total < m.total ? c : m), candSeries[0]);
    const latestC = candSeries[candSeries.length - 1];
    const rebound = latestC.year > troughC.year && latestC.total > troughC.total;
    clergyPipeline = {
      measurable: "Public", kind: "process", partial: true,
      total: latestC?.total ?? 0,
      throughYear: latestC?.year,
      peak: { year: peak.year, total: peak.total },
      trough: { year: troughC.year, total: troughC.total },
      series: candSeries,
      totalChange: change(candSeries.map((c: any) => ({ year: c.year, value: c.total }))),
      note: "Certified candidates for licensed or ordained ministry (¶310) — the conference's clergy pipeline, from the Business of the Annual Conference, 2016–" + latestC.year + ". It fell from a peak of " + peak.total + " (" + peak.year + ") to a low of " + troughC.total + " (" + troughC.year + ")" + (rebound ? ", then rebounded to " + latestC.total + " in " + latestC.year : "") + ". The pipeline is a leading indicator of clergy supply — today's candidates are tomorrow's pastors — so the " + latestC.year + " uptick is an early sign of recovery. Total and discontinuations read directly; “newly certified” is inferred from the certification date, so read it as indicative. 2015 is omitted (older journal format).",
    };
  } catch { /* optional */ }

  clergy = {
    measurable: "Public", kind: "outcome", partial: true,
    total: activeBy[Y1].size,
    series: activeSeries,
    churn,
    totalChange: change(activeSeries),
    bacExits,
    bacEntrants,
    note: "Three readings. The line is clergy holding an active Río-family appointment (a supply proxy: 289→257). The bars are the Business of the Annual Conference exit questions, separating ordinary attrition (retirements + transfers out, steady ~20–35/yr) from withdrawals — near-zero until the disaffiliation exodus drove 37 in 2023. Entrants (commissioned, ordained, received by transfer) net against exits to show the flow. Deaths are omitted: the BAC necrology can't be cleanly limited to a single year.",
  };
} catch (e) {
  clergy = { measurable: "Public", kind: "outcome", blank: true, reason: "Could not read appointment stints: " + String(e) };
}

/* ── 5. Membership demographics (denominator for representation gap) ─────── */
const dy = BASELINE_YEAR;
const memTot = get(dy, "MEMBTOT");
const membershipComposition = {
  year: dy,
  total: Math.round(memTot),
  reportedByRace: Math.round(get(dy, "MEMBH") + get(dy, "MEMBW") + get(dy, "MEMBAAB") + get(dy, "MEMBA") + get(dy, "MEMBN")),
  hispanic: Math.round(get(dy, "MEMBH")),
  white: Math.round(get(dy, "MEMBW")),
  black: Math.round(get(dy, "MEMBAAB")),
  asian: Math.round(get(dy, "MEMBA")),
  nativeAmerican: Math.round(get(dy, "MEMBN")),
  female: Math.round(get(dy, "MEMBFEM")),
  male: Math.round(get(dy, "MEMBMALE")),
  note: "Self-reported member demographics from GCFA tables. Race columns are under-reported (not every church codes them), so treat shares as directional. This is the denominator a leadership-representation audit is measured against.",
};

/* ── 6. Committee roster (leadership numerator — mostly uncoded) ─────────── */
const crows = parseCSV(readFileSync(COMMITTEES, "utf8"));
const seats = crows.filter((r) => (r["Member Name"] || "").trim());
const committees = new Set(seats.map((r) => r["Committee"]));
const f = (r: Record<string, string>, k: string) => (r[k] || "").trim().length > 0;
const codedClergyLay = seats.filter((r) => f(r, "Clergy/Lay")).length;
const vacant = seats.filter((r) => /vacant/i.test(r["Member Name"] || "")).length;

/* ── 7. Closures + disaffiliation (Atlas GCFA status panel) ──────────────── */
const exits = {
  measurable: "Public", kind: "outcome",
  closures: 27, disaffiliations: 84,
  annualBaseLost: 1605558, membersLost: null as number | null,
  source: "Atlas GCFA church-status panel (Río Texas)",
  note: "Closures + disaffiliations since the merger. 84 disaffiliations cost ≈$1.6M/yr in recurring apportionment base. Target: trending toward zero.",
};

/* ── Assemble ───────────────────────────────────────────────────────────── */
const pofSeries = series("RECPROF");
const baptSeries = series("NUMBAPT").filter((p) => p.value > 0); // 2017+ reported
const attSeries = series("AVATTWOR");
const cfSeries = series("CFTOTAL");
const memSeries = series("MEMBTOT");
const transfersLatest = Math.round(get(dy, "RECUMC") + get(dy, "RECOTH"));

const baseline = {
  meta: {
    conference: "Río Texas Annual Conference",
    baselineYear: BASELINE_YEAR,
    eraStart: ERA_START,
    frozen: true,
    primarySource: "GCFA statistical tables (per-church panel, field-coded), parsed from conference journals — Río Texas era " + ERA_START + "–" + BASELINE_YEAR,
    supplements: [
      "Río Texas audited financials (2025 audit → 2024 figures)",
      "Conference clergy roster (parsed journals)",
      "Atlas GCFA church-status panel (closures/disaffiliations, committee rosters)",
    ],
    note: "[Public] markers are populated from the public record. [Conference] and [Survey] markers are intentionally blank — and a blank is itself a finding.",
  },

  trust: {
    apportionmentPayoutRate: {
      measurable: "Public", kind: "outcome",
      baseline: apptLatest.rate, baselineYear: apptLatest.year,
      peak: { year: apptPeak.year, rate: apptPeak.rate },
      series: apptSeries,
      note: "Conference-wide apportionment paid ÷ asked — the cleanest trust proxy. Watch for recovery from the 2023–24 collapse.",
    },
    churchExits: exits,
    conferenceNetAssets: {
      measurable: "Public", kind: "context",
      baseline: netAssetsLatest.value, baselineYear: netAssetsLatest.year,
      series: netAssetsSeries,
      source: netAssetsLatest.source,
      note: "Conference net assets, end of year, from the audit. Context for the reserves-vs-need question: reserves dwarf the annual apportionment gap.",
    },
    clergyAttrition: clergy,
    ...(clergyPipeline ? { clergyPipeline } : {}),
    trustIndex: {
      measurable: "Survey", kind: "outcome", blank: true,
      reason: "Anonymous annual clergy + lay survey, identical questions each year. Blank until the instrument runs — see the survey page.",
    },
  },

  discipleship: {
    professionsOfFaith: {
      measurable: "Public", kind: "outcome",
      total: latest("RECPROF"),
      median: medianSeries("RECPROF").slice(-1)[0]?.value ?? 0,
      totalSeries: pofSeries, medianSeries: medianSeries("RECPROF"),
      totalChange: change(pofSeries),
      note: "New believers received on profession of faith. Median matters more than total — it shows whether discipleship is broadening or concentrating in a few large churches.",
    },
    baptisms: {
      measurable: "Public", kind: "outcome",
      total: baptSeries.slice(-1)[0]?.value ?? 0,
      totalSeries: baptSeries, totalChange: change(baptSeries),
      note: "Persons baptized (reported 2017 onward).",
    },
    worshipAttendance: {
      measurable: "Public", kind: "outcome",
      total: latest("AVATTWOR"),
      median: medianSeries("AVATTWOR").slice(-1)[0]?.value ?? 0,
      totalSeries: attSeries, medianSeries: medianSeries("AVATTWOR"),
      totalChange: change(attSeries),
      note: "Average weekly worship attendance. Progress = bending the decline curve, not reversing it overnight.",
    },
    christianFormation: {
      measurable: "Public", kind: "outcome",
      total: latest("CFTOTAL"),
      totalSeries: cfSeries, totalChange: change(cfSeries),
      note: "Total enrolled in Christian-formation groups (church school + small groups).",
    },
    discipleshipBudgetLine: {
      measurable: "Public", kind: "process", blank: true,
      reason: "Is there a named, funded discipleship/formation line in the conference budget, growing as a share of spend? Requires the budget broken out — not derivable from the statistical panel.",
    },
    intentionalPathwayShare: {
      measurable: "Conference", kind: "process", blank: true,
      reason: "Share of churches reporting an intentional discipleship pathway (not just programs). Requires charge-conference reporting or a survey item.",
    },
  },

  belonging: {
    membershipComposition: { measurable: "Public", kind: "context", ...membershipComposition },
    representationAudit: {
      measurable: "Public", kind: "outcome",
      committees: committees.size, seats: seats.length, vacant,
      codedClergyLay,
      codingComplete: codedClergyLay >= seats.length * 0.5,
      note: "Leadership composition of boards/agencies vs. the membership composition above. The roster is captured (" + committees.size + " committees, " + seats.length + " seats); the demographic coding is largely unfilled — and that incompleteness is the finding.",
      reason: codedClergyLay < seats.length * 0.5
        ? "Crowdsource the demographic coding (per the committee-demographics instructions) to compute the representation gap against membership."
        : null,
    },
    voiceChannels: {
      measurable: "Conference", kind: "process", blank: true,
      reason: "Structured channels for lay / youth / young-adult / small-church voice that feed real decisions. Requires governance review.",
    },
    belongingSurvey: {
      measurable: "Survey", kind: "outcome", blank: true,
      reason: "“I feel I belong / my voice is heard,” segmented by demographic. The segmentation is the point — never a single number.",
    },
  },

  bridges: {
    newBelievers: {
      measurable: "Public", kind: "outcome",
      total: latest("RECPROF"), transfersIn: transfersLatest,
      totalSeries: pofSeries, totalChange: change(pofSeries),
      note: "Professions of faith (" + latest("RECPROF") + ") isolated from transfers in (" + transfersLatest + " from other churches/denominations). New people crossing the bridge — not members shuffling between churches.",
    },
    netMembership: {
      measurable: "Public", kind: "context",
      total: latest("MEMBTOT"),
      totalSeries: memSeries, totalChange: change(memSeries),
      note: "Total professing members. Context, not the test — a church can grow membership entirely by absorbing a closed church's roll.",
    },
    communityPartnershipShare: {
      measurable: "Conference", kind: "process", blank: true,
      reason: "Share of churches reporting an active community partnership (food, schools, immigration, neighborhood orgs). Requires charge-conference or survey reporting.",
    },
    newFaithCommunities: {
      measurable: "Conference", kind: "outcome", blank: true,
      reason: "New faith communities started — and still alive 2–3 years on. Requires the conference's new-church/new-place records.",
    },
  },
};

const OUT = process.argv[2] || new URL("./scorecard-baseline.json", import.meta.url).pathname;
writeFileSync(OUT, JSON.stringify(baseline, null, 2));
console.log("Baseline year:", BASELINE_YEAR, "| era", ERA_START + "–" + BASELINE_YEAR, "(" + ERA + ")");
console.log("Apportionment:", (apptLatest.rate * 100).toFixed(1) + "% (peak " + (apptPeak.rate * 100).toFixed(1) + "% in " + apptPeak.year + ")");
console.log("PoF:", latest("RECPROF"), "(median", medianSeries("RECPROF").slice(-1)[0]?.value + ", from " + pofSeries[0].value + " in " + pofSeries[0].year + ")");
console.log("Baptisms:", baptSeries.slice(-1)[0]?.value, "| Worship:", latest("AVATTWOR"), "(median", medianSeries("AVATTWOR").slice(-1)[0]?.value + ")");
console.log("Christian formation:", latest("CFTOTAL"), "| Members:", latest("MEMBTOT").toLocaleString());
console.log("Net assets:", "$" + netAssetsLatest.value.toLocaleString(), "(" + netAssetsLatest.year + ", " + netAssetsLatest.source + ")");
console.log("New believers", latest("RECPROF"), "vs transfers in", transfersLatest);
console.log("Membership: H", membershipComposition.hispanic, "W", membershipComposition.white, "Blk", membershipComposition.black, "| F/M", membershipComposition.female + "/" + membershipComposition.male);
console.log("Clergy roster:", clergy.total ?? "—", "| Committees:", committees.size, "seats", seats.length, "coded", codedClergyLay);
console.log("Wrote", OUT);
