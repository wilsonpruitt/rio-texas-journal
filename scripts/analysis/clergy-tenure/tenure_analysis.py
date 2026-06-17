#!/usr/bin/env python3.11
"""
Comprehensive clergy-tenure analysis (Rio Texas, 2025 journal). Supersedes
active_church_clergy.py — classifies ALL clergy into categories rather than
only keeping the active church-serving ones, and adds district + cohort cuts.

Sources:
  journals/2025-clergy-record.pdf   full career APPTS history per clergyperson
  journals/2025.pdf  (E/F section)  2025 Appointments, grouped by district
                                     -> clergy -> district (by name, no church
                                        reconciliation needed)

Categories (current relationship):
  active_church   currently appointed to a local church
  extension       currently in extension ministry / agency / chaplaincy / DS
  retired         retired (RE/RD/RL/RA or current "Retired")
  leave_other     on leave / in school / unappointed / honorable location

Cuts produced (printed + CSV):
  - category comparison: lifetime churches served, career length, tenure
  - entry-decade cohort  (active church-serving)
  - district             (active church-serving)
  - tenure-by-appointment: distribution of COMPLETED church-stint lengths

Outputs: clergy-tenure-all.csv, appointment-stints.csv, unmatched-district.txt
NOTE: gender/race intentionally absent — not recorded in the journal.
"""
from __future__ import annotations
import re, subprocess, csv, statistics
from pathlib import Path
from collections import Counter, defaultdict

HERE = Path(__file__).resolve().parent
JDIR = Path.home() / "rio-texas-journal" / "journals"
REC_PDF = JDIR / "2025-clergy-record.pdf"
APPT_PDF = JDIR / "2025.pdf"
CURRENT_YEAR = 2025

RETIRED  = {"RE", "RD", "RL", "RA", "RP"}
INACTIVE = {"HL", "HN", "AL", "VL", "LA", "TO", "WD", "SU", "DM", "DA", "HR"}
ACTIVE   = {"FE", "FD", "PE", "PD", "FL", "PL", "AM", "SY", "OE", "OD", "OF", "OP", "OR", "PM", "FM", "AF"}

ORDERS = ["Elder", "Deacon", "Local pastor", "Other"]
def order_of(code):
    """Map a status code to ministry order. Local pastors (licensed, often
    part-time, later-entry) serve very differently from itinerant elders, so
    we keep them separate."""
    if not code:
        return "Other"
    if code in ("FE", "PE", "OE", "RE"): return "Elder"
    if code in ("FD", "PD", "OD", "RD"): return "Deacon"
    if code in ("FL", "PL", "RL", "SY"): return "Local pastor"   # licensed / supply
    return "Other"  # AM, PM, FM, AF, OF, OR — associate / provisional-generic / other-denom

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
LEAVE_RE = re.compile(r"Leave|In School|Attend|Sabbatical|Disability|Incapacity|Honorable Location|"
                      r"Unappointed|No record|Eligible But|Suspend|Withdrawn|Surrender|Maternity", re.I)
ROLE_PREFIX_RE = re.compile(
    r"^(Assoc(\.|iate)? Pastor|Co-?Pastor|Sr\.? Pastor|Senior Pastor|Pastor|"
    r"Deacon|Minister of [^,]+|Interim Pastor|Interim|Lead Pastor|Church Planter)\s*,?\s*", re.I)
RG_PREFIX_RE  = re.compile(r"^Rio Grande Appt\.?,?\s*", re.I)
TBS_PREFIX_RE = re.compile(r"^(TBS|To Be Supplied)\s*,?\s*", re.I)
BRACKET_RE    = re.compile(r"\s*\[[A-Z]{1,4}\]\s*$")

def clean_appt(raw: str) -> str:
    s = BRACKET_RE.sub("", raw).strip()
    s = RG_PREFIX_RE.sub("", s).strip()
    s = TBS_PREFIX_RE.sub("", s).strip()
    s = ROLE_PREFIX_RE.sub("", s).strip()
    return s

def is_church(raw: str) -> bool:
    return not NON_CHURCH_RE.search(clean_appt(raw))

# ---- (first-name, surname) key for roster<->record matching -----------------
# Robust to middle names and to the two sources' different name orders.
SUFFIX = {"jr", "sr", "ii", "iii", "iv", "iv."}
def _toks(s):
    return [t for t in re.findall(r"[A-Za-z][A-Za-z'’\-]+", s.lower())
            if len(t) > 1 and t not in SUFFIX]

def record_key(name: str):
    """'Surname Parts, First Middle' -> (first, last)."""
    name = re.sub(r"\([A-Z]{2,4}\)", " ", name)
    if "," in name:
        sur, given = name.split(",", 1)
    else:
        sur, given = name, ""
    st, gt = _toks(sur), _toks(given)
    if not gt and st:  # no comma: assume 'First ... Last'
        return (st[0], st[-1]) if len(st) > 1 else None
    if st and gt:
        return (gt[0], st[-1])
    return None

def roster_key(name: str):
    """'First Middle Last' -> (first, last)."""
    t = _toks(re.sub(r"\([A-Z]{2,4}\)", " ", name))
    return (t[0], t[-1]) if len(t) > 1 else None

def pdftext(pdf, layout=True):
    args = ["/usr/local/bin/pdftotext"] + (["-layout"] if layout else []) + [str(pdf), "-"]
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout

# ---- parse clergy records ---------------------------------------------------
NAME_RE   = re.compile(r"^([A-Z][A-Za-z'’.\- ]+),\s+([A-Z][A-Za-z'’.\-]+.*)$")
STATUS_RE = re.compile(r"\b([A-Z]{2,4})\s*:\s*(\d{4})")
APPT_RE   = re.compile(r"(\d{4})\s+(.+?)(?=;\s*\d{4}\s|\Z)", re.S)
NOISE_LINE = re.compile(r"Rio Texas Conference Journal|Clergy Records|^I-\d+$|^\d+$", re.I)

def parse_records():
    text = pdftext(REC_PDF)
    lines = text.split("\n")
    blocks, cur = [], None
    for ln in lines:
        if not ln.strip() or NOISE_LINE.search(ln.strip()):
            continue
        if not ln.startswith(" ") and "," in ln[:40]:
            m = NAME_RE.match(ln.strip())
            if m and not re.match(r"^(District|Director|Pastor|Chaplain|Assoc|Co-Pastor|"
                                  r"Conference|School|Board|Office|Center)\b", m.group(1)):
                if cur: blocks.append(cur)
                cur = {"name": f"{m.group(1).strip()}, {m.group(2).split('  ')[0].strip()}", "raw": ln + "\n"}
                continue
        if cur is not None:
            cur["raw"] += ln + "\n"
    if cur: blocks.append(cur)

    recs = []
    for b in blocks:
        raw = b["raw"]
        name = re.sub(r"\s*\([A-Z]{2,4}\)\s*$", "", b["name"]).strip()
        status = [(c, int(y)) for c, y in STATUS_RE.findall(raw)]
        appts = []
        am = re.search(r"APPTS:\s*(.+)", raw, re.S)
        if am:
            body = re.sub(r"\s+", " ", am.group(1)).strip()
            for ym in APPT_RE.finditer(body):
                appts.append((int(ym.group(1)), ym.group(2).strip().rstrip(";").strip()))
        recs.append({"name": name, "status": status, "appts": appts})
    return recs

# ---- parse 2025 appointments roster -> name_key -> district -----------------
ROSTER_NAME_RE = re.compile(r"^(?:Assoc\.? Pastor,\s*)?(.+?)\s+\((\d+)\)\s+([A-Z]{2})\b")
def parse_district_roster():
    text = pdftext(APPT_PDF)
    # isolate the "2025 APPOINTMENTS" ... section
    start = text.find("2025 APPOINTMENTS")
    body = text[start:] if start >= 0 else text
    out = {}            # name_key -> district
    yrs = {}            # name_key -> years at current appt
    district = None
    for ln in body.split("\n"):
        h = ln.strip().upper()
        m = re.match(r"^(CENTRAL|NORTH|SOUTH)\s+DISTRICT$", h)
        if m:
            district = m.group(1).title()
            continue
        if district is None:
            continue
        for cell in re.split(r"\s{2,}", ln.strip()):
            cm = ROSTER_NAME_RE.match(cell.strip())
            if cm:
                k = roster_key(cm.group(1))
                if k:
                    out[k] = district
                    yrs[k] = int(cm.group(2))
    return out, yrs

# ---- classify + measure -----------------------------------------------------
def categorize(code, cur_raw):
    if code in RETIRED or re.match(r"^Retired", clean_appt(cur_raw), re.I):
        return "retired"
    if LEAVE_RE.search(clean_appt(cur_raw)) or code in INACTIVE:
        return "leave_other"
    if not is_church(cur_raw):
        return "extension"
    return "active_church"

def career_end(appts, category):
    # year active service ends: retirement year for retired, else 2025
    if category == "retired":
        for yr, raw in reversed(appts):
            if re.search(r"Retired", raw, re.I):
                return yr
        return appts[-1][0]
    return CURRENT_YEAR

def church_stints(appts, end_year):
    stints = []   # (church, start, end)
    for i, (yr, raw) in enumerate(appts):
        if not is_church(raw):
            continue
        nxt = appts[i + 1][0] if i + 1 < len(appts) else end_year
        end = min(nxt, end_year) if end_year else nxt
        nm = clean_appt(raw)
        if stints and stints[-1][0] == nm and stints[-1][2] == yr:
            stints[-1] = (nm, stints[-1][1], end)
        else:
            stints.append((nm, yr, max(end, yr)))
    return stints

def main():
    recs = parse_records()
    district_map, yrs_map = parse_district_roster()
    print(f"Parsed {len(recs)} clergy records; {len(district_map)} clergy in district roster.\n")

    clergy_rows, stint_rows, unmatched = [], [], []
    for r in recs:
        appts = r["appts"]
        if not appts:
            continue
        code = r["status"][-1][0] if r["status"] else None
        cur_year, cur_raw = appts[-1]
        cat = categorize(code, cur_raw)
        end = career_end(appts, cat)
        stints = church_stints(appts, end)
        first_year = appts[0][0]
        n_churches = len({s[0] for s in stints})
        career_years = max(end - first_year, 0)
        church_years = sum(e - s for _, s, e in stints)

        k = record_key(r["name"])
        district = district_map.get(k, "")
        if cat == "active_church" and not district:
            unmatched.append(r["name"])

        ordr = order_of(code)
        clergy_rows.append({
            "name": r["name"], "category": cat, "order": ordr, "district": district,
            "current_status_code": code or "", "current_appt": clean_appt(cur_raw),
            "first_appt_year": first_year, "career_years": career_years,
            "distinct_churches": n_churches, "church_appointments": len(stints),
            "church_years": church_years,
            "avg_years_per_church": round(church_years / len(stints), 1) if stints else 0,
        })
        # per-stint rows; mark the final open stint of still-active careers
        for idx, (nm, s, e_) in enumerate(stints):
            is_open = (cat in ("active_church", "extension") and idx == len(stints) - 1
                       and s == cur_year)
            stint_rows.append({"name": r["name"], "category": cat, "order": ordr, "church": nm,
                               "start": s, "end": e_, "years": e_ - s, "is_open": int(is_open)})

    # ---- write CSVs ----
    with open(HERE / "clergy-tenure-all.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(clergy_rows[0].keys())); w.writeheader(); w.writerows(clergy_rows)
    with open(HERE / "appointment-stints.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(stint_rows[0].keys())); w.writeheader(); w.writerows(stint_rows)
    (HERE / "unmatched-district.txt").write_text("\n".join(sorted(unmatched)))

    import json
    def block(rows):
        if not rows: return None
        ch = [r["distinct_churches"] for r in rows]; cy = [r["career_years"] for r in rows]
        return {"n": len(rows),
                "churches_mean": round(statistics.mean(ch), 1), "churches_median": statistics.median(ch),
                "career_mean": round(statistics.mean(cy), 1), "career_median": statistics.median(cy)}

    def tenure_block(rows):
        durs = [s["years"] for s in rows if not s["is_open"] and 0 < s["years"] <= 40]
        if not durs: return None
        d = Counter(durs)
        return {"n": len(durs), "mean": round(statistics.mean(durs), 1),
                "median": statistics.median(durs), "mode": statistics.mode(durs),
                "short_appt_share": round(sum(1 for x in durs if x <= 2) / len(durs), 2),
                "histogram": {str(i): d.get(i, 0) for i in range(1, 13)},
                "13_plus": sum(1 for x in durs if x >= 13)}

    def decade_block(rows):
        bydec = defaultdict(list)
        for r in rows:
            bydec[(r["first_appt_year"] // 10) * 10].append(r)
        return {f"{dec}s": {"n": len(bydec[dec]),
                            "churches_mean": round(statistics.mean([r["distinct_churches"] for r in bydec[dec]]), 1),
                            "career_mean": round(statistics.mean([r["career_years"] for r in bydec[dec]]), 1),
                            "churches_per_decade": round(sum(r["distinct_churches"] for r in bydec[dec])
                                                         / max(sum(r["career_years"] for r in bydec[dec]), 1) * 10, 1)}
                for dec in sorted(bydec)}

    # ---- PER-ORDER breakdown (the key split: local pastors vs elders vs deacons) ----
    print("=== PER-ORDER ===")
    orders_out = {}
    for o in ORDERS:
        crows = [r for r in clergy_rows if r["order"] == o]
        if not crows: continue
        active = [r for r in crows if r["category"] == "active_church"]
        retired = [r for r in crows if r["category"] == "retired"]
        srows = [s for s in stint_rows if s["order"] == o]
        ten = tenure_block(srows)
        ab, rb = block(active), block(retired)
        orders_out[o] = {
            "n_total": len(crows),
            "active": ab, "retired": rb,
            "extension_n": sum(1 for r in crows if r["category"] == "extension"),
            "leave_n": sum(1 for r in crows if r["category"] == "leave_other"),
            "tenure_per_appointment": ten,
            "entry_decade": decade_block(active) if active else {},
        }
        print(f"\n  {o.upper()}  (n={len(crows)}; active {len(active)}, retired {len(retired)})")
        if ab: print(f"    active: churches median {ab['churches_median']} (mean {ab['churches_mean']}), "
                     f"career median {ab['career_median']}y")
        if rb: print(f"    retired (full career): churches median {rb['churches_median']}, career median {rb['career_median']}y")
        if ten: print(f"    appt tenure: median {ten['median']}y, mode {ten['mode']}y, "
                      f"{int(ten['short_appt_share']*100)}% are 1-2yr (n={ten['n']})")

    # ---- district (active, all orders) ----
    active_all = [r for r in clergy_rows if r["category"] == "active_church"]
    matched = sum(1 for r in active_all if r["district"])
    bydist = defaultdict(list)
    for r in active_all:
        if r["district"]: bydist[r["district"]].append(r)

    summary = {
        "conference": "Rio Texas", "journal_year": CURRENT_YEAR, "n_records": len(recs),
        "orders": orders_out,
        "districts": {d: block(bydist[d]) for d in sorted(bydist)},
        "district_match_rate": round(matched / len(active_all), 2),
    }
    (HERE / "clergy-career-summary.json").write_text(json.dumps(summary, indent=2))
    print(f"\nWrote clergy-tenure-all.csv ({len(clergy_rows)}), appointment-stints.csv "
          f"({len(stint_rows)}), unmatched-district.txt, clergy-career-summary.json")


if __name__ == "__main__":
    main()
