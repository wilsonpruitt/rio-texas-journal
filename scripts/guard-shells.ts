/**
 * Post-build shell guard (Conference Atlas access-shell discipline, §3 of
 * ~/wroot-labs/notes/conference-atlas-architecture.md). Runs after `next build`.
 *
 * Fails the build if:
 *   (a) any file under data/restricted/ is tracked by git — the directory-level
 *       gitignore should make this impossible, but a forced `git add` could
 *       still slip one in; catch it here too.
 *   (b) any JSON under data/public/, data/staff/, or the built .next/ output
 *       stamps `meta.shell: "restricted"`, or contains a person-name key
 *       ("pastor", "clergy_name", …) — the "Church C" rule as a build gate.
 *
 *   node --experimental-strip-types scripts/guard-shells.ts
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
// Quoted-key patterns only — NOT a bare-word scan. The app has legitimate public
// clergy/pastor content (a /clergy directory, PAR module, etc.), so matching the
// word "clergy" anywhere in bundled JS would flag nearly every chunk. What
// actually matters is a serialized JSON *field* carrying a person's name.
const PERSON_KEY_RE = /"(pastor_name|clergy_name|elder_name|supply_pastor)"\s*:/i;
const SHELL_MARKER_RE = /"shell"\s*:\s*"restricted"/;
let failures = 0;

function fail(msg: string) {
  console.error(`✗ guard-shells: ${msg}`);
  failures++;
}

// (a) nothing under data/restricted/ tracked by git.
try {
  const tracked = execFileSync("git", ["ls-files", "data/restricted"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (tracked) fail(`data/restricted/ has files tracked by git:\n${tracked}`);
} catch {
  // not a git repo / git unavailable — nothing to check, don't block the build over it
}

// (b) walk a directory for JSON files and flag person-name keys / shell markers.
// Restricted to .json (not .js/.html): the risk this guards against is a build
// script writing a person-keyed JSON artifact into the wrong tier, not arbitrary
// app source text — .next's own manifests are framework JSON, not page data.
function walkJson(dir: string, cb: (path: string, contents: string) => void) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // directory doesn't exist yet — fine
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walkJson(p, cb);
    } else if (extname(name) === ".json") {
      cb(p, readFileSync(p, "utf8"));
    }
  }
}

function checkPersonKeys(dir: string) {
  walkJson(dir, (path, contents) => {
    if (PERSON_KEY_RE.test(contents)) {
      fail(`person-name key found in ${path} (matches ${PERSON_KEY_RE})`);
    }
    if (SHELL_MARKER_RE.test(contents)) {
      fail(`meta.shell: "restricted" found outside data/restricted/ in ${path}`);
    }
  });
}

checkPersonKeys(join(ROOT, "data", "public"));
checkPersonKeys(join(ROOT, "data", "staff"));
checkPersonKeys(join(ROOT, ".next"));

if (failures > 0) {
  console.error(`\nguard-shells: ${failures} failure(s) — a restricted (person-keyed) artifact would ship.`);
  process.exit(1);
}
console.log("guard-shells: clean — no restricted-tier data found in public/staff/.next.");
