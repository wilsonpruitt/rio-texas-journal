/**
 * Normalize church names from Section J of the 2025 journal.
 *
 * Section J uses city-prefix abbreviations (SAng, SAnt) and drops the
 * "UMC" suffix on most entries. We canonicalize to expanded city names.
 */

const CITY_PREFIX_EXPANSIONS: Record<string, string> = {
  'SAng:': 'San Angelo:',
  'SAnt:': 'San Antonio:',
  'CC:': 'Corpus Christi:',
  'NB:': 'New Braunfels:',
};

export function expandCityPrefix(name: string): string {
  for (const [abbr, full] of Object.entries(CITY_PREFIX_EXPANSIONS)) {
    if (name.startsWith(abbr)) {
      return full + name.slice(abbr.length);
    }
  }
  return name;
}

/** Best-guess city extraction from a "City: Name" or "City" pattern. */
export function extractCity(name: string): string | null {
  const colonIdx = name.indexOf(':');
  if (colonIdx > 0) return name.slice(0, colonIdx).trim();
  // For one-word names like "Boerne", "Floresville", treat the whole thing as the city.
  return name.trim() || null;
}

/** Normalize "St " (no period) to "St. " — different sub-tables within a single
 * journal year inconsistently abbreviate "Saint" (e.g. "Austin: St John's" vs
 * "Austin: St. John's" both refer to the same church).
 */
function normalizeSaint(name: string): string {
  return name.replace(/\bSt(?=\s)/g, 'St.');
}

/** Expand trailing words truncated to fit narrower columns in some sub-tables. */
function expandColumnTruncations(name: string): string {
  return name
    .replace(/\bChap$/i, 'Chapel')
    .replace(/\bUnite$/i, 'United')
    // "San Juan: Los Wesleyan" appears in some sub-tables; "Wesleyanos" is the full Spanish.
    .replace(/\bLos Wesleyan$/i, 'Los Wesleyanos');
}

export function canonicalize(rawName: string): string {
  return expandColumnTruncations(normalizeSaint(expandCityPrefix(rawName.trim())));
}
