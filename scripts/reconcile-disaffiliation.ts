/**
 * Reconcile our church.status against the conference's authoritative disaffiliation
 * spreadsheet (Rio TX UMC Disaffiliation.xlsx - Disaffiliated.csv).
 *
 * Token-set matching with abbreviation expansion (district codes, CC:/SA: city
 * prefixes, St->Saint, "Name-City" forms). Reports, per CSV church: our match,
 * our current status, and the target status implied by the CSV category.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/reconcile-disaffiliation.ts [--apply]
 *
 * Categories -> target status (Wilson's authoritative classification 2026-06-12):
 *   a/b/c/e Disaffiliated (done)  -> disaffiliated
 *   d Lawsuit                     -> disaffiliated (they left; lawsuit is over property)
 *   f Vote pending                -> active (still in the conference until the vote)
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const CSV = "/Users/wilsonpruitt/Downloads/Rio TX UMC Disaffiliation.xlsx - Disaffiliated.csv";
const Q = String.fromCharCode(34);

// Hand-map for rows the fuzzy matcher misses or mis-matches (verified against DB 2026-06-12).
// Keyed by exact CSV name -> authoritative GCFA church number.
const HAND_MAP: Record<string, string> = {
  "CC: St. Luke's (CB)": "750613",        // Saint Lukes Corpus Christi (active live record; 759624 is a closed dup)
  "Sant: Northwest Hills": "763956",      // Northwest Hills (San Antonio) — not 758083 (Austin)
  "Sant: St. Andrew's": "764164",         // Saint Andrews San Antonio
  "Harlandale": "764005",                 // Harlandale (San Antonio)
  "Sant: Resurrection": "758471",         // Resurrection (San Antonio)
  "Walnut": "761172",                     // Walnut (Buchanan Dam)
  "Oak Island-San Antonio (LM)": "763648",// Oak Island — fuzzy matcher wrongly grabbed Oak Meadow (764073)
  "New Fountain-Hondo (HC)": "761206",    // New Fountain — fuzzy matcher wrongly grabbed Hondo (760862)
};

// Target status per category.
const TARGET: Record<string, "disaffiliated" | "active"> = {
  disaffiliated: "disaffiliated",
  lawsuit: "disaffiliated",
  pending: "active",
};

const CITY: Record<string, string> = {
  CC: "Corpus Christi", SA: "San Antonio", SANT: "San Antonio", PA: "Port Arthur",
  RGV: "", FW: "",
};
const STOP = new Set(["UMC", "THE", "OF", "CHURCH", "FIRST", "NEW", "MEMORIAL", "CHAPEL"]);

function parseLine(l: string): string[] {
  const out: string[] = []; let c = "", q = false;
  for (const ch of l) { if (ch === Q) q = !q; else if (ch === "," && !q) { out.push(c); c = ""; } else c += ch; }
  out.push(c); return out;
}

// produce significant token set from a church name
function tokens(name: string): Set<string> {
  let s = name.toUpperCase();
  s = s.replace(/[—–-]+\s*(MAY|JUNE|JULY|OCT|DEC)[^,]*$/i, ""); // strip "—May 21" annotations
  s = s.replace(/\([A-Z ]{1,4}\)\s*$/g, "");                    // strip trailing (HC) district code
  // expand "XX:" city prefix
  const pre = s.match(/^([A-Z]{2,4}):\s*(.+)$/);
  if (pre && CITY[pre[1]] != null) s = (CITY[pre[1]] + " " + pre[2]);
  s = s.replace(/\bST\b\.?/g, "SAINT").replace(/\bMT\b\.?/g, "MOUNT");
  s = s.replace(/[^A-Z0-9 ]/g, " ");
  const toks = s.split(/\s+/).filter((t) => t && !STOP.has(t));
  return new Set(toks);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

async function main() {
  const db = adminClient();
  const lines = readFileSync(CSV, "utf8").split(/\r?\n/).filter(Boolean);
  const hdr = parseLine(lines[0]);
  const iName = hdr.indexOf("Name"), iReason = hdr.indexOf("REASON ON LIST"), iStatus = hdr.indexOf("Status");
  const csv = lines.slice(1).map(parseLine).map((c) => ({
    name: (c[iName] || "").trim(), reason: (c[iReason] || "").trim(), status: (c[iStatus] || "").trim(),
  })).filter((r) => r.name && !r.reason.startsWith("STAY") && r.reason);

  const cat = (reason: string): "disaffiliated" | "lawsuit" | "pending" | "other" =>
    /^[abce]-/i.test(reason) ? "disaffiliated" : reason.startsWith("d-") ? "lawsuit" : reason.startsWith("f-") ? "pending" : "other";

  // our churches with token sets
  const all: { canonical_name: string; status: string; city: string | null; id: string; gcfa_number: string }[] = [];
  for (let f = 0; ; f += 1000) {
    const { data } = await db.from("church").select("id, canonical_name, status, city, gcfa_number").not("gcfa_number", "is", null).range(f, f + 999);
    if (!data?.length) break; all.push(...(data as typeof all)); if (data.length < 1000) break;
  }
  const ours = all.map((c) => ({ ...c, tok: tokens(c.canonical_name + " " + (c.city ?? "")) }));
  const byGcfa = new Map(ours.map((o) => [o.gcfa_number, o]));

  const rows: any[] = [];
  for (const r of csv) {
    const hand = HAND_MAP[r.name];
    if (hand) {
      const o = byGcfa.get(hand) ?? null;
      rows.push({ csv: r.name, category: cat(r.reason), csvStatus: r.status, match: o, score: 1.0, hand: true });
      continue;
    }
    const ct = tokens(r.name);
    let best: typeof ours[0] | null = null, bestScore = 0;
    for (const o of ours) {
      const sc = jaccard(ct, o.tok);
      if (sc > bestScore) { bestScore = sc; best = o; }
    }
    rows.push({ csv: r.name, category: cat(r.reason), csvStatus: r.status, match: bestScore >= 0.5 ? best : null, score: bestScore });
  }

  // summary
  const summarize = (category: string) => {
    const rs = rows.filter((r) => r.category === category);
    const matched = rs.filter((r) => r.match);
    const byOur: Record<string, number> = {};
    matched.forEach((r) => (byOur[r.match.status] = (byOur[r.match.status] ?? 0) + 1));
    console.log(`\n${category}: ${rs.length} in CSV | matched ${matched.length} | our status: ${JSON.stringify(byOur)} | unmatched ${rs.length - matched.length}`);
  };
  ["disaffiliated", "lawsuit", "pending"].forEach(summarize);

  // write review file: every row with its target status + whether a change is needed
  const review = rows.map((r) => {
    const target = TARGET[r.category] ?? "";
    const change = r.match && target && r.match.status !== target ? `${r.match.status}->${target}` : "";
    return [r.csv, r.category, r.match?.canonical_name ?? "*** NO MATCH ***", r.match?.gcfa_number ?? "",
      r.match?.status ?? "", target, change, r.hand ? "hand" : r.score.toFixed(2)].join("\t");
  });
  writeFileSync(new URL("./data/disaffiliation-reconcile.tsv", import.meta.url).pathname,
    "csv_name\tcategory\tour_match\tgcfa\tour_status\ttarget\tchange\tscore\n" + review.join("\n"));
  console.log("\nReview file: scripts/data/disaffiliation-reconcile.tsv");

  // unmatched warning
  const unmatched = rows.filter((r) => !r.match);
  if (unmatched.length) console.log(`\n⚠ ${unmatched.length} STILL UNMATCHED:`, unmatched.map((r) => r.csv).join(", "));

  // planned changes (dry-run preview always shown)
  const changes = rows.filter((r) => r.match && TARGET[r.category] && r.match.status !== TARGET[r.category]);
  console.log(`\nPlanned status changes: ${changes.length}`);
  const tally: Record<string, number> = {};
  changes.forEach((r) => { const k = `${r.match.status}->${TARGET[r.category]}`; tally[k] = (tally[k] ?? 0) + 1; });
  console.log("  ", JSON.stringify(tally));

  if (APPLY) {
    let fixed = 0;
    for (const r of changes) {
      await db.from("church").update({ status: TARGET[r.category] }).eq("id", r.match.id);
      fixed++;
    }
    console.log(`\nApplied: ${fixed} church status updates.`);
  } else {
    console.log("\n(dry run — pass --apply to write)");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
