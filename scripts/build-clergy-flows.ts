/**
 * Build a per-year clergy EXIT series from the Business of the Annual Conference
 * (BAC) disciplinary questions, 2015–2025. The BAC enumerates each kind of exit
 * separately, so this separates retirements (the demographic baseline) from
 * transfers-out, withdrawals, and deaths — and isolates the 2022–23
 * disaffiliation surge that shows up as a spike in withdrawals/terminations.
 *
 * Two journal eras:
 *   A (2015–2022): full standard disciplinary-question wording. We auto-detect
 *     the question number per category by matching the wording (numbers drift).
 *   B (2023–2025): abbreviated per-topic format. We use the known § map.
 *
 * Counts are of "this year" events only. Retirement questions carry a cumulative
 * "Previously" roster we deliberately exclude.
 *
 *   node --experimental-strip-types scripts/build-clergy-flows.ts [out.json]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const PDFTOTEXT = "/usr/local/bin/pdftotext";
const DIR = "/Users/wilsonpruitt/rio-texas-journal/journals";

type Cat = "retired" | "transferredOut" | "withdrawn" | "died";

const extract = (file: string) =>
  execFileSync(PDFTOTEXT, ["-layout", file, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

/** Era-A category detectors — match the standard disciplinary-question wording.
 *  Each may match several questions (e.g. retirements split by order). */
const ERA_A: Record<Cat, RegExp[]> = {
  retired: [
    // Wording drifts: "...have been retired" (2015–22) vs "...who have retired" (2026).
    /members in full connection\b[^.\n]{0,25}retired/i,
    /associate members\b[^.\n]{0,25}retired/i,
    /recognized as retired local pastors/i,
    /provisional members\b[^.\n]{0,30}retired/i,
  ],
  transferredOut: [
    /transferred out to other annual conferences/i,
    /transferred out as diaconal ministers/i,
  ],
  withdrawn: [
    /conference membership terminated/i,
    /withdrawn? (from|to)/i,
    /surrender(ed)? (of |their )?(the )?(ordained )?ministerial office/i,
  ],
  died: [/^Deceased\b/i, /have died during the year/i, /ministers? .*have died/i],
};

/** Entrant categories — new clergy coming in. Wording is stable across BOTH
 *  eras (only the exit questions were reformatted), so we auto-detect by text
 *  for every year. "Courtesy" ordinations (for other conferences) are excluded. */
type ECat = "commissioned" | "ordainedDeacon" | "ordainedElder" | "receivedTransfer" | "receivedDenom";
const ENTRANTS: Record<ECat, RegExp[]> = {
  commissioned: [/elected as provisional members/i, /commissioned as provisional/i],
  ordainedDeacon: [/ordained as deacons/i, /persons ordained as deacons/i],
  ordainedElder: [/ordained as elders/i],
  receivedTransfer: [/received by transfer from other annual conferences/i],
  receivedDenom: [/received from other Christian denominations/i],
};

/** Era-B (2023–2025) question numbers, from import-bac.ts. */
const ERA_B: Record<number, { retired: number[]; transferredOut: number; withdrawn: number; died: number }> = {
  2023: { transferredOut: 37, withdrawn: 42, died: 44, retired: [49, 50, 51] },
  2024: { transferredOut: 37, withdrawn: 42, died: 44, retired: [49, 50, 51] },
  2025: { transferredOut: 37, withdrawn: 39, died: 41, retired: [46, 47, 48] },
};

const SKIP =
  /^Name\b|^Last Name\b|Clergy Status$|Date Effective|Date of Death|Date of Birth|^Active:|^Retired:|^Effective:|^Other:|Rio Texas Conference Journal|Business of the Annual Conference|^E\s*-\s*\d+|^\d+\s*$|^March\s+\d{4}|List alphabetically|^None\b|^\(?\d+\)|^[a-z]\)\s|^Deacons$|^Elders$|^Local Pastors$|^Full Members$|^Associate Members$|^Provisional/i;

/** Does this trimmed line look like one person entry?
 *  Handles both "Last, First  date  status" (comma form) and the era-A
 *  "Full Name        Date" form where the second column is a DATE, not a name. */
function isPersonRow(line: string): boolean {
  const t = line.trim();
  if (t.length < 4) return false;
  if (SKIP.test(t)) return false;
  if (!/^[A-ZÁÉÍÓÚÑ]/.test(t)) return false;
  const cols = t.split(/\s{2,}/).filter(Boolean);
  const hasDate = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(t);
  // "Last, First ..."
  if (/^[A-ZÁÉÍÓÚÑ][^,]*?,\s+[A-ZÁÉÍÓÚÑ]/.test(t)) return true;
  // "Full Name        Date" — name word(s) then a date column.
  if (cols.length >= 2 && /^[A-ZÁÉÍÓÚÑ][a-zñáéíóú.'’-]+(\s+\S+)*$/.test(cols[0]) && /\d{1,2}[\/\-]\d/.test(cols[1])) return true;
  // "Last   First ..." two capitalized columns.
  if (cols.length >= 2 && /^[A-ZÁÉÍÓÚÑ][a-zñáéíóú.'’-]+/.test(cols[0]) && /^[A-ZÁÉÍÓÚÑ]/.test(cols[1])) return true;
  // Name + date anywhere, at least two name-ish words.
  if (hasDate && /[A-Za-zÁÉÍÓÚñ]{2,}\s+[A-Za-zÁÉÍÓÚñ]{2,}/.test(t)) return true;
  return false;
}

function rangeFrom(lines: string[], headerIdx: number): [number, number] {
  const hm = lines[headerIdx].match(/^\s*(\d+)\.\s/);
  const q = hm ? Number(hm[1]) : Infinity;
  let end = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d+)\.\s+\S/);
    if (m && Number(m[1]) > q) { end = i; break; }
  }
  return [headerIdx + 1, end];
}

/** Count this-year person rows in a section. Retirement questions interleave
 *  several "a) This year / b) Previously" blocks (Deacons, Elders, Local
 *  Pastors); count rows only while inside a "This year" block, across all of
 *  them. Sections with no This/Previously markers are counted whole. */
function countSection(lines: string[], start: number, end: number, isRetire: boolean): number {
  let n = 0;
  if (isRetire) {
    const hasSplit = lines.slice(start, end).some((l) => /\bThis year\b|\bPreviously\b/i.test(l));
    if (hasSplit) {
      let on = false;
      for (let i = start; i < end; i++) {
        const t = lines[i].trim();
        if (/\bThis year\b/i.test(t)) { on = true; continue; }
        if (/\bPreviously\b/i.test(t)) { on = false; continue; }
        if (on && isPersonRow(lines[i])) n++;
      }
      return n;
    }
  }
  for (let i = start; i < end; i++) if (isPersonRow(lines[i])) n++;
  return n;
}

const CAND = [/certified candidates\s*\(¶/i, /the certified candidates/i, /all certified candidates/i];

/** Range of a lettered sub-question a)/b)/c) inside a question, by its wording. */
function subRange(lines: string[], s: number, e: number, re: RegExp): [number, number] {
  let start = -1;
  for (let i = s; i < e; i++) if (re.test(lines[i])) { start = i + 1; break; }
  if (start < 0) return [-1, -1];
  let end = e;
  // Subsection markers are "a)" (older) or "a." (2026) — stop at either.
  for (let i = start; i < e; i++) if (/^\s*[a-z][).]\s/.test(lines[i])) { end = i; break; }
  return [start, end];
}

function yearOf(line: string): number | null {
  const m = line.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-](\d{4})\b/) || line.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

/** Certified candidates (¶310): roster split into newly certified (Date
 *  Certified in the last year) vs. continued, plus the discontinued subsection. */
function parseCandidates(lines: string[], bacYear: number) {
  const headers = findHeaders(lines, CAND);
  if (!headers.length) return null;
  const [s, e] = rangeFrom(lines, headers[0]);
  const [cs, ce] = subRange(lines, s, e, /currently certified as candidates/i);
  let total = 0, newly = 0, continued = 0;
  if (cs >= 0) {
    for (let i = cs; i < ce; i++) {
      if (!isPersonRow(lines[i])) continue;
      total++;
      const y = yearOf(lines[i]);
      if (y != null && y >= bacYear - 1) newly++; else continued++;
    }
  }
  const [ds, de] = subRange(lines, s, e, /discontinued as certified candidates/i);
  let discontinued = 0;
  if (ds >= 0) for (let i = ds; i < de; i++) if (isPersonRow(lines[i])) discontinued++;
  return { total, newly, continued, discontinued };
}

function findHeaders(lines: string[], res: RegExp[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\d+\.\s+(.*)/);
    const body = m ? m[1] : (/^\s*Deceased\b/i.test(lines[i]) ? lines[i].trim() : null);
    if (body == null) continue;
    if (res.some((r) => r.test(body))) out.push(i);
  }
  return out;
}

function parseYear(year: number, file: string) {
  const lines = extract(file).split("\n");
  const counts: Record<Cat, number> = { retired: 0, transferredOut: 0, withdrawn: 0, died: 0 };
  const eraB = ERA_B[year];
  if (eraB) {
    const sec = (q: number, isRetire: boolean) => {
      const idx = lines.findIndex((l) => new RegExp(`^\\s*${q}\\.\\s+\\S`).test(l));
      if (idx < 0) return 0;
      const [s, e] = rangeFrom(lines, idx);
      return countSection(lines, s, e, isRetire);
    };
    counts.transferredOut = sec(eraB.transferredOut, false);
    counts.withdrawn = sec(eraB.withdrawn, false);
    counts.died = sec(eraB.died, false);
    counts.retired = eraB.retired.reduce((a, q) => a + sec(q, true), 0);
  } else {
    for (const cat of Object.keys(ERA_A) as Cat[]) {
      const headers = findHeaders(lines, ERA_A[cat]);
      for (const h of headers) {
        const [s, e] = rangeFrom(lines, h);
        counts[cat] += countSection(lines, s, e, cat === "retired");
      }
    }
  }
  // Entrants — wording-detected for all years (whole section = this-year events).
  const entrants: Record<ECat, number> = {
    commissioned: 0, ordainedDeacon: 0, ordainedElder: 0, receivedTransfer: 0, receivedDenom: 0,
  };
  for (const cat of Object.keys(ENTRANTS) as ECat[]) {
    for (const h of findHeaders(lines, ENTRANTS[cat])) {
      const [s, e] = rangeFrom(lines, h);
      entrants[cat] += countSection(lines, s, e, false);
    }
  }
  const candidates = parseCandidates(lines, year);
  return { ...counts, entrants, candidates };
}

const YEARS = Array.from({ length: 12 }, (_, i) => 2015 + i);
const rows = YEARS.map((y) => ({ year: y, ...parseYear(y, `${DIR}/${y}-bac.pdf`) }));

console.log("year | EXITS retire/transOut/withdrawn | ENTRANTS comm/ordD/ordE/recvTfr/recvDenom | CANDS total(new/cont)/disc");
for (const r of rows) {
  const e = r.entrants;
  const c = r.candidates;
  const entTot = e.commissioned + e.ordainedDeacon + e.ordainedElder + e.receivedTransfer + e.receivedDenom;
  console.log(
    String(r.year).padEnd(5),
    `| ${String(r.retired).padStart(2)}/${String(r.transferredOut).padStart(2)}/${String(r.withdrawn).padStart(2)}`,
    `| ${e.commissioned}/${e.ordainedDeacon}/${e.ordainedElder}/${e.receivedTransfer}/${e.receivedDenom} (Σ${entTot})`,
    c ? `| ${c.total} (${c.newly}new/${c.continued}cont) ${c.discontinued}disc` : "| —"
  );
}

const OUT = process.argv[2] || new URL("./clergy-flows.json", import.meta.url).pathname;
writeFileSync(OUT, JSON.stringify({ source: "BAC disciplinary questions 2015–2025", rows }, null, 2));
console.log("\nWrote", OUT);
