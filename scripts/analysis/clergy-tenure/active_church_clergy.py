#!/usr/bin/env python3.11
"""
Active church-serving clergy tenure analysis (Rio Texas, 2025 journal).

Source: journals/2025-clergy-record.pdf  (Section I, Clergy Records).
Each record carries the clergyperson's FULL career APPTS history, so the
single most-recent journal is enough to measure "how many churches served
over how many years" for everyone currently active.

Scope (per request): ACTIVE clergy CURRENTLY serving a local church —
NOT retired, NOT extension ministry (chaplain, director, professor, DS,
agency), NOT on leave / in school. Demographic splits (gender, race) are
deliberately OUT: the journal records neither.

Outputs:
  - active-church-clergy.csv      one row per included clergyperson
  - unclassified-appts.txt        APPTS entries the classifier wasn't sure about
  - prints summary distributions to stdout
"""
from __future__ import annotations
import re, subprocess, csv, sys, statistics
from pathlib import Path
from collections import Counter

HERE = Path(__file__).resolve().parent
PDF = Path.home() / "rio-texas-journal" / "journals" / "2025-clergy-record.pdf"
CURRENT_YEAR = 2025

# ---- status codes -----------------------------------------------------------
# Latest code in the "PM: 1977; FE: 1981; ... RE: 2014" timeline tells us the
# person's current conference relationship.
RETIRED   = {"RE", "RD", "RL", "RA", "RP"}            # retired elder/deacon/local/assoc/provisional
INACTIVE  = {"HL", "HN", "AL", "VL", "FL_LEAVE", "LA", "TO", "WD", "SU", "DM", "DA", "HR"}
# active credential classes we DO count (elders, deacons, local pastors, etc.)
ACTIVE    = {"FE", "FD", "PE", "PD", "FL", "PL", "AM", "SY", "OE", "OD", "OF", "OP", "OR", "PM", "FM", "AF"}

# ---- non-church appointment markers -----------------------------------------
# After stripping role prefixes + bracket tags, an entry matching any of these
# is NOT a local-church appointment and is excluded from "churches served".
NON_CHURCH = [
    r"^In School", r"Attend(ing)? School", r"\bSchool\b.*Conf", r"^Student\b.*(School|Conf)",
    r"Leave of Absence", r"Family Leave", r"Medical Leave", r"Maternity", r"Sabbatical",
    r"Disability", r"Incapacity", r"Personal Leave", r"Voluntary Leave", r"Transitional Leave",
    r"Honorable Location", r"Administrative Location", r"^Retired", r"Deceased", r"Withdrawn",
    r"Surrender", r"Suspend", r"No Salary Paying Unit", r"Discontinu",
    r"District Superintendent", r"\bDirector\b", r"Exec\.? Dir", r"Executive", r"Coordinator",
    r"\bChaplain\b", r"Professor", r"Faculty", r"\bDean\b", r"President", r"Campus Min",
    r"Conference Council", r"Conference Staff", r"\bFoundation\b", r"Endors", r"Missionar",
    r"\bAgency\b", r"\bCPE\b", r"Counsel(or|ing)", r"Hospital(?!ity)", r"Military", r"\bArmy\b",
    r"\bNavy\b", r"Air Force", r"Bishop", r"General Board", r"GBHEM", r"Annual Conference$",
    r"Other Valid", r"Appointment Beyond", r"Beyond the Local Church",
    r"Unappointed", r"No record of App", r"Eligible But Unappointed", r"No Record of Appt",
    r"\bDir\.?\s*,", r"Office Of", r"\bDevelopment\b",
]
NON_CHURCH_RE = re.compile("|".join(NON_CHURCH), re.I)

# role prefixes to strip so "Assoc. Pastor, CC: St. John's" -> "CC: St. John's"
ROLE_PREFIX_RE = re.compile(
    r"^(Assoc(\.|iate)? Pastor|Co-?Pastor|Sr\.? Pastor|Senior Pastor|Pastor|"
    r"Deacon|Minister of [^,]+|Interim Pastor|Interim|Lead Pastor|Church Planter)\s*,?\s*",
    re.I,
)
RG_PREFIX_RE   = re.compile(r"^Rio Grande Appt\.?,?\s*", re.I)
TBS_PREFIX_RE  = re.compile(r"^(TBS|To Be Supplied)\s*,?\s*", re.I)   # to-be-supplied slot
BRACKET_RE     = re.compile(r"\s*\[[A-Z]{1,4}\]\s*$")          # trailing [RG] [OTH] [HIS]
LOWER_DROP_RE  = re.compile(r"\s*\(.*?\)\s*$")                 # trailing parenthetical


def extract_text() -> str:
    return subprocess.run(
        ["/usr/local/bin/pdftotext", "-layout", str(PDF), "-"],
        capture_output=True, text=True, check=True,
    ).stdout


NAME_RE   = re.compile(r"^([A-Z][A-Za-z'’.\- ]+),\s+([A-Z][A-Za-z'’.\-]+.*)$")
STATUS_RE = re.compile(r"\b([A-Z]{2,4})\s*:\s*(\d{4})")
APPT_RE   = re.compile(r"(\d{4})\s+(.+?)(?=;\s*\d{4}\s|\Z)", re.S)
NOISE_LINE = re.compile(r"Rio Texas Conference Journal|Clergy Records|^I-\d+$|^\d+$", re.I)


def parse_records(text: str):
    """Yield dicts: name, status_codes[(code,year)], appts[(year, raw)]."""
    lines = text.split("\n")
    blocks, cur = [], None
    for ln in lines:
        if not ln.strip() or NOISE_LINE.search(ln.strip()):
            continue
        # record start: non-indented "Surname, First ..." line
        if not ln.startswith(" ") and "," in ln[:40]:
            m = NAME_RE.match(ln.strip())
            if m and not re.match(r"^(District|Director|Pastor|Chaplain|Assoc|Co-Pastor|"
                                  r"Conference|School|Board|Office|Center)\b", m.group(1)):
                if cur:
                    blocks.append(cur)
                cur = {"name": f"{m.group(1).strip()}, {m.group(2).split('  ')[0].strip()}",
                       "raw": ln + "\n"}
                continue
        if cur is not None:
            cur["raw"] += ln + "\n"
    if cur:
        blocks.append(cur)

    out = []
    for b in blocks:
        raw = b["raw"]
        # strip a trailing "(RE)" style code off the name
        name = re.sub(r"\s*\([A-Z]{2,4}\)\s*$", "", b["name"]).strip()
        status = [(c, int(y)) for c, y in STATUS_RE.findall(raw)]
        # APPTS block: everything after "APPTS:"
        appts = []
        am = re.search(r"APPTS:\s*(.+)", raw, re.S)
        if am:
            body = re.sub(r"\s+", " ", am.group(1)).strip()
            for ym in APPT_RE.finditer(body):
                appts.append((int(ym.group(1)), ym.group(2).strip().rstrip(";").strip()))
        out.append({"name": name, "status": status, "appts": appts})
    return out


def clean_appt(raw: str) -> str:
    s = BRACKET_RE.sub("", raw).strip()
    s = RG_PREFIX_RE.sub("", s).strip()
    s = TBS_PREFIX_RE.sub("", s).strip()
    s = ROLE_PREFIX_RE.sub("", s).strip()
    return s


def is_church(raw: str) -> bool:
    return not NON_CHURCH_RE.search(clean_appt(raw))


def latest_status(status):
    return status[-1][0] if status else None


def analyze():
    text = extract_text()
    recs = parse_records(text)

    rows = []
    unclassified = []
    excluded_reason = Counter()

    for r in recs:
        code = latest_status(r["status"])
        appts = r["appts"]
        if not appts:
            excluded_reason["no appts parsed"] += 1
            continue
        # current appointment = most recent APPTS entry
        cur_year, cur_raw = appts[-1]
        # ---- inclusion gate -------------------------------------------------
        if code in RETIRED or re.match(r"^Retired", clean_appt(cur_raw), re.I):
            excluded_reason["retired"] += 1
            continue
        if code in INACTIVE:
            excluded_reason[f"inactive/{code}"] += 1
            continue
        if not is_church(cur_raw):
            excluded_reason["currently non-church (extension/leave/agency)"] += 1
            continue
        if code not in ACTIVE and code is not None:
            excluded_reason[f"other status/{code}"] += 1
            continue

        # ---- measures -------------------------------------------------------
        # distinct church stints: consecutive same-church merged
        church_stints = []   # (church_name, start_year, end_year)
        for i, (yr, raw) in enumerate(appts):
            if not is_church(raw):
                continue
            name = clean_appt(raw)
            end = appts[i + 1][0] if i + 1 < len(appts) else CURRENT_YEAR
            if church_stints and church_stints[-1][0] == name and church_stints[-1][2] == yr:
                # contiguous same-church continuation -> extend
                church_stints[-1] = (name, church_stints[-1][1], end)
            else:
                church_stints.append((name, yr, end))

        if not church_stints:
            excluded_reason["no church appts in history"] += 1
            continue

        # flag fuzzy classifications for review (entries that look part-church)
        for yr, raw in appts:
            c = clean_appt(raw)
            if is_church(raw) and not re.search(r"UMC|:|/|Church|Chapel|Iglesia|Memorial|First|Trinity|Wesley|Grace|St\.?|San |Santa ", c, re.I):
                unclassified.append(f"{r['name']}: {yr} {raw}  ->  '{c}'")

        distinct_churches = len({c[0] for c in church_stints})
        n_stints = len(church_stints)
        first_appt_year = appts[0][0]
        career_years = CURRENT_YEAR - first_appt_year
        church_years = sum(e - s for _, s, e in church_stints)
        avg_tenure = church_years / n_stints if n_stints else 0

        rows.append({
            "name": r["name"],
            "current_status_code": code or "",
            "current_appt": clean_appt(cur_raw),
            "first_appt_year": first_appt_year,
            "career_years": career_years,
            "distinct_churches": distinct_churches,
            "church_appointments": n_stints,
            "church_years": church_years,
            "avg_years_per_church": round(avg_tenure, 1),
        })

    # ---- write CSV ----------------------------------------------------------
    rows.sort(key=lambda x: (-x["church_appointments"], x["name"]))
    csv_path = HERE / "active-church-clergy.csv"
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    (HERE / "unclassified-appts.txt").write_text("\n".join(sorted(set(unclassified))))

    # ---- summary ------------------------------------------------------------
    n = len(rows)
    dc = [r["distinct_churches"] for r in rows]
    cy = [r["career_years"] for r in rows]
    at = [r["avg_years_per_church"] for r in rows]
    print(f"\nParsed {len(recs)} clergy records.")
    print("Excluded:")
    for k, v in excluded_reason.most_common():
        print(f"   {v:4d}  {k}")
    print(f"\n>>> INCLUDED (active, currently serving a church): {n}\n")
    print(f"Distinct churches served — mean {statistics.mean(dc):.1f}, "
          f"median {statistics.median(dc)}, max {max(dc)}")
    print(f"Career length (yrs)       — mean {statistics.mean(cy):.1f}, "
          f"median {statistics.median(cy)}, max {max(cy)}")
    print(f"Avg tenure per church     — mean {statistics.mean(at):.1f} yrs\n")
    print("Distribution of #distinct churches served:")
    for k in sorted(Counter(dc)):
        bar = "#" * Counter(dc)[k]
        print(f"   {k:2d} churches: {Counter(dc)[k]:3d}  {bar}")
    print("\nBy current credential class:")
    byclass = Counter(r["current_status_code"] for r in rows)
    for k, v in byclass.most_common():
        sub = [r["distinct_churches"] for r in rows if r["current_status_code"] == k]
        print(f"   {k or '?':3s}: {v:3d} clergy, mean {statistics.mean(sub):.1f} churches")
    print(f"\nWrote: {csv_path}")
    print(f"Wrote: {HERE/'unclassified-appts.txt'}  ({len(set(unclassified))} entries to eyeball)")


if __name__ == "__main__":
    analyze()
