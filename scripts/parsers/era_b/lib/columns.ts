/** A single field column on a Section J table page. */
export type Column = {
  code: string;
  start: number;
  end: number;
};

/** A sub-table on a page: column layout + the line range to read rows from. */
export type SubTable = {
  columns: Column[];
  nameBoundary: number;
  /** Inclusive start line index for data rows (1 past the field-code line). */
  rowsStart: number;
  /** Exclusive end line index for data rows. */
  rowsEnd: number;
};

const CODE_RE = /^[1-9]\d?[a-z]?$/;

/** Locate every field-code line on a page. */
function findFieldCodeLineIndices(lines: string[]): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const tokens = Array.from(lines[i].matchAll(/\S+/g));
    if (tokens.length < 3) continue;
    if (!tokens.every((t) => CODE_RE.test(t[0]))) continue;
    idxs.push(i);
  }
  return idxs;
}

/** Build a SubTable from a field-code line + the line range that follows it. */
function buildSubTable(
  lines: string[],
  headerIdx: number,
  rowsEnd: number,
): SubTable {
  const headerLine = lines[headerIdx];
  const tokens = Array.from(headerLine.matchAll(/\S+/g)).map((m) => ({
    token: m[0],
    start: m.index!,
    end: m.index! + m[0].length - 1,
  }));

  // Sample data rows after the header to find the leftmost numeric token.
  let leftmostNumericStart = Infinity;
  for (let li = headerIdx + 1; li < Math.min(headerIdx + 30, rowsEnd); li++) {
    const dataLine = lines[li];
    if (!dataLine.trim()) continue;
    const numTokens = Array.from(dataLine.matchAll(/\S+/g)).filter((m) =>
      /^[\d$,.\-]+$/.test(m[0]),
    );
    if (numTokens.length === 0) continue;
    const first = numTokens[0];
    if (first.index! > 30 && first.index! < leftmostNumericStart) {
      leftmostNumericStart = first.index!;
    }
  }
  const nameBoundary =
    leftmostNumericStart === Infinity
      ? Math.max(0, tokens[0].start - 8)
      : Math.max(0, leftmostNumericStart - 1);

  const codePositions = tokens.map((t) => t.end);
  const columns: Column[] = tokens.map((t, idx) => {
    const prevEnd = idx === 0 ? nameBoundary : codePositions[idx - 1];
    const nextEnd =
      idx === tokens.length - 1
        ? headerLine.length
        : Math.floor((codePositions[idx] + codePositions[idx + 1]) / 2);
    return {
      code: t.token,
      start: idx === 0 ? nameBoundary : Math.floor((prevEnd + codePositions[idx]) / 2),
      end: nextEnd,
    };
  });

  return { columns, nameBoundary, rowsStart: headerIdx + 1, rowsEnd };
}

/** Find every sub-table on a page and the line range each owns. */
export function findSubTables(pageText: string): SubTable[] {
  const lines = pageText.split('\n');
  const headers = findFieldCodeLineIndices(lines);
  if (headers.length === 0) return [];
  return headers.map((h, i) =>
    buildSubTable(lines, h, i + 1 < headers.length ? headers[i + 1] : lines.length),
  );
}

/** Slice a row line using a sub-table's column layout. */
export function sliceRow(
  line: string,
  sub: SubTable,
): { name: string; values: Record<string, string> } {
  const name = line.slice(0, sub.nameBoundary).trim();
  const values: Record<string, string> = {};
  for (let i = 0; i < sub.columns.length; i++) {
    const col = sub.columns[i];
    const next = sub.columns[i + 1];
    const sliceStart = col.start;
    const sliceEnd = next ? next.start : line.length;
    values[col.code] = line.slice(sliceStart, sliceEnd).trim();
  }
  return { name, values };
}

export function parseNumeric(raw: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const cleaned = raw.replace(/[$,]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
