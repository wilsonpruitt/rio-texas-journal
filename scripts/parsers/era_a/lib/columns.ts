/**
 * Era A (2015–2024) column detection.
 *
 * Wide-landscape layout: one row per church carrying every GCFA field
 * inline. The data row format is:
 *
 *   <seq>  <church name>           <pastor name>           v1  v2a  v2b ...
 *
 * Field-code lines look like "1   2a   2b.   2c.   2d. ...   4" — the codes
 * are sometimes printed with a trailing period that we strip.
 */

export type Column = {
  code: string;
  start: number;
  end: number;
};

export type SubTable = {
  columns: Column[];
  /**
   * Boundary between the leftmost name field (sequence + church + pastor)
   * and the first data column.
   */
  nameBoundary: number;
  rowsStart: number;
  rowsEnd: number;
};

const RAW_CODE_RE = /^[1-9]\d?\.?[a-z]?\.?$/;

function normalizeCode(token: string): string {
  return token.replace(/\./g, '');
}

/** Locate every field-code line on a page. */
export function findFieldCodeLineIndices(lines: string[]): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const tokens = Array.from(lines[i].matchAll(/\S+/g));
    if (tokens.length < 3) continue;
    if (!tokens.every((t) => RAW_CODE_RE.test(t[0]))) continue;
    idxs.push(i);
  }
  return idxs;
}

function buildSubTable(
  lines: string[],
  headerIdx: number,
  rowsEnd: number,
): SubTable {
  const headerLine = lines[headerIdx];
  const tokens = Array.from(headerLine.matchAll(/\S+/g)).map((m) => ({
    token: normalizeCode(m[0]),
    raw: m[0],
    start: m.index!,
    end: m.index! + m[0].length - 1,
  }));

  // Sample data rows after the header to find the leftmost numeric token.
  // "Numeric" here also includes "-" (the journal's empty-cell marker).
  let leftmostNumericStart = Infinity;
  for (let li = headerIdx + 1; li < Math.min(headerIdx + 30, rowsEnd); li++) {
    const dataLine = lines[li];
    if (!dataLine.trim()) continue;
    const numTokens = Array.from(dataLine.matchAll(/\S+/g)).filter((m) =>
      /^([\d$,.\-]+|-)$/.test(m[0]),
    );
    if (numTokens.length < 3) continue;
    // Find the column position closest to the first code's column position.
    const firstCodePos = tokens[0].start;
    const candidates = numTokens.filter((t) => Math.abs(t.index! - firstCodePos) < 8);
    if (candidates.length === 0) continue;
    const first = candidates[0];
    if (first.index! > 30 && first.index! < leftmostNumericStart) {
      leftmostNumericStart = first.index!;
    }
  }
  const nameBoundary =
    leftmostNumericStart === Infinity
      ? Math.max(0, tokens[0].start - 4)
      : Math.max(0, leftmostNumericStart - 1);

  const codePositions = tokens.map((t) => t.end);
  const columns: Column[] = tokens.map((t, idx) => {
    const prevEnd = idx === 0 ? nameBoundary : codePositions[idx - 1];
    const nextEnd =
      idx === tokens.length - 1
        ? headerLine.length + 200
        : Math.floor((codePositions[idx] + codePositions[idx + 1]) / 2);
    return {
      code: t.token,
      start: idx === 0 ? nameBoundary : Math.floor((prevEnd + codePositions[idx]) / 2),
      end: nextEnd,
    };
  });

  return { columns, nameBoundary, rowsStart: headerIdx + 1, rowsEnd };
}

export function findSubTables(pageText: string): SubTable[] {
  const lines = pageText.split('\n');
  const headers = findFieldCodeLineIndices(lines);
  if (headers.length === 0) return [];
  return headers.map((h, i) =>
    buildSubTable(lines, h, i + 1 < headers.length ? headers[i + 1] : lines.length),
  );
}

export type SlicedRow = {
  seq: string;
  church: string;
  pastor: string;
  values: Record<string, string>;
};

/**
 * Slice a row line. The leading region is "<seq> <church> <pastor>" where
 * seq is a numeric sequence number, church is a left-aligned name padded
 * to ~30 chars, and pastor is the next padded name field.
 */
export function sliceRow(line: string, sub: SubTable): SlicedRow | null {
  const head = line.slice(0, sub.nameBoundary);
  const tail = line.slice(sub.nameBoundary);
  const headTrim = head.trim();
  if (!headTrim) return null;

  const values: Record<string, string> = {};
  for (let i = 0; i < sub.columns.length; i++) {
    const col = sub.columns[i];
    const next = sub.columns[i + 1];
    const lineRel = sub.nameBoundary;
    const sliceStart = col.start - lineRel;
    const sliceEnd = next ? next.start - lineRel : tail.length;
    values[col.code] = tail.slice(Math.max(0, sliceStart), Math.max(0, sliceEnd)).trim();
  }

  // Split head into "seq church pastor" using whitespace + position. Heuristic:
  // first token is digits (seq); then split remaining at the largest run of
  // 2+ spaces (church / pastor boundary).
  const m = head.match(/^\s*(\d+)\s+(.*)$/);
  let seq = '';
  let rest = headTrim;
  if (m) { seq = m[1]; rest = m[2]; }

  // Split church / pastor on the LAST gap of >=2 spaces that still has
  // non-whitespace content after it. (Trailing whitespace before the value
  // columns can match too, which would leave pastor empty.)
  const restTrimmed = rest.replace(/\s+$/, '');
  let church = restTrimmed;
  let pastor = '';
  const gaps: { idx: number; len: number }[] = [];
  for (const g of restTrimmed.matchAll(/ {2,}/g)) {
    gaps.push({ idx: g.index!, len: g[0].length });
  }
  if (gaps.length > 0) {
    const best = gaps[gaps.length - 1];
    church = restTrimmed.slice(0, best.idx).trim();
    pastor = restTrimmed.slice(best.idx + best.len).trim();
  }

  return { seq, church, pastor, values };
}

export function parseNumeric(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
