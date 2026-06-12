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
 * Categories -> target status:
 *   a/b/c/e Disaffiliated (done)  -> disaffiliated
 *   d Lawsuit                     -> (configurable; default leave as-is, report only)
 *   f Vote pending                -> active
 */
import { adminClient } from "./parsers/era_b/lib/db.ts";
import { readFileSync, writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const CSV = "/Users/wilsonpruitt/Downloads/Rio TX UMC Disaffiliation.xlsx - Disaffiliated.csv";
const Q = String.fromCharCode(34);

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

  const rows: any[] = [];
  for (const r of csv) {
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

  // write review file: mismatches + unmatched
  const review = rows.map((r) =>
    [r.csv, r.category, r.match?.canonical_name ?? "*** NO MATCH ***", r.match?.gcfa_number ?? "", r.match?.status ?? "", r.score.toFixed(2)].join("\t"));
  writeFileSync(new URL("./data/disaffiliation-reconcile.tsv", import.meta.url).pathname,
    "csv_name\tcategory\tour_match\tgcfa\tour_status\tscore\n" + review.join("\n"));
  console.log("\nReview file: scripts/data/disaffiliation-reconcile.tsv");

  if (APPLY) {
    // target: disaffiliated -> 'disaffiliated'; pending -> leave active; lawsuit -> leave as-is (report only)
    let fixed = 0;
    for (const r of rows) {
      if (r.category === "disaffiliated" && r.match && r.match.status !== "disaffiliated") {
        await db.from("church").update({ status: "disaffiliated" }).eq("id", r.match.id);
        fixed++;
      }
    }
    console.log(`Applied: ${fixed} churches set to disaffiliated.`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
