#!/usr/bin/env python3.11
"""
Render the active church-serving clergy tenure analysis to a standalone SVG
(no dependencies). Reads active-church-clergy.csv (produced by
active_church_clergy.py) and writes churches-over-years.svg.

Two panels:
  A. Scatter — career length (x) vs. distinct churches served (y), colored by
     current credential class. Answers "how many churches over how many years."
  B. Mobility rate — churches served per decade of service, by credential class
     (pooled: total churches / total career-years * 10). The length-adjusted
     view of "how it varies."
"""
from __future__ import annotations
import csv, html
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).resolve().parent
rows = list(csv.DictReader(open(HERE / "active-church-clergy.csv")))
for r in rows:
    r["career_years"] = int(r["career_years"])
    r["distinct_churches"] = int(r["distinct_churches"])

# class grouping + palette (Rio Texas-ish earthy tones)
CLASS_LABEL = {
    "FE": "Full elder", "FD": "Full deacon", "FL": "Local pastor (FT)",
    "PL": "Local pastor (PT)", "PE": "Provisional elder", "PD": "Provisional deacon",
    "SY": "Supply", "AM": "Associate member", "OE": "Other-conf elder",
    "OD": "Other-conf deacon", "OP": "Other-conf provisional", "OF": "Full mem., other denom",
    "OR": "Ordained, other denom", "AF": "Affiliate member", "PM": "Provisional member",
}
PALETTE = {
    "FE": "#b1471f", "FL": "#2f6b4f", "PL": "#6a8a3a", "FD": "#7a5197",
    "PE": "#c98a2b", "PD": "#a8852f", "SY": "#8a8a8a", "AM": "#3a6e8f", "OE": "#9a9a9a",
}
def color(c): return PALETTE.get(c, "#9a9a9a")
def label(c): return CLASS_LABEL.get(c, c)

W, H = 940, 1140
out = []
def e(s): out.append(s)

e(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
  f'viewBox="0 0 {W} {H}" font-family="Georgia, \'Times New Roman\', serif">')
e(f'<rect width="{W}" height="{H}" fill="#fcfaf5"/>')
e(f'<text x="{W/2}" y="44" text-anchor="middle" font-size="26" fill="#2b2b2b" '
  f'font-weight="bold">Active Rio Texas clergy: churches served over a career</text>')
e(f'<text x="{W/2}" y="70" text-anchor="middle" font-size="14" fill="#666">'
  f'{len(rows)} clergy currently serving a local church (extension ministry, leave, and retired excluded) '
  f'· 2025 Journal clergy records</text>')

# ---------- Panel A: scatter ----------
ax0, ay0, aw, ah = 90, 130, W - 150, 440   # plot box
xmax = max(r["career_years"] for r in rows); xmax = ((xmax // 10) + 1) * 10
ymax = max(r["distinct_churches"] for r in rows) + 1
def px(v): return ax0 + (v / xmax) * aw
def py(v): return ay0 + ah - (v / ymax) * ah

e(f'<text x="{ax0}" y="{ay0-12}" font-size="16" fill="#2b2b2b" font-weight="bold">'
  f'A &#183; Each dot is one clergyperson</text>')
# gridlines + axes
for gx in range(0, xmax + 1, 10):
    e(f'<line x1="{px(gx)}" y1="{ay0}" x2="{px(gx)}" y2="{ay0+ah}" stroke="#e6e0d4"/>')
    e(f'<text x="{px(gx)}" y="{ay0+ah+20}" text-anchor="middle" font-size="12" fill="#666">{gx}</text>')
for gy in range(0, ymax + 1, 2):
    e(f'<line x1="{ax0}" y1="{py(gy)}" x2="{ax0+aw}" y2="{py(gy)}" stroke="#e6e0d4"/>')
    e(f'<text x="{ax0-8}" y="{py(gy)+4}" text-anchor="end" font-size="12" fill="#666">{gy}</text>')
e(f'<text x="{ax0+aw/2}" y="{ay0+ah+44}" text-anchor="middle" font-size="14" fill="#444">'
  f'Years since first appointment</text>')
e(f'<text transform="translate({ax0-52},{ay0+ah/2}) rotate(-90)" text-anchor="middle" '
  f'font-size="14" fill="#444">Distinct churches served</text>')
# deterministic jitter to separate overlapping integer points
def jitter(i, span): return ((i * 2654435761) % 1000 / 1000 - 0.5) * span
for i, r in enumerate(rows):
    cx = px(r["career_years"]) + jitter(i, 6)
    cy = py(r["distinct_churches"]) + jitter(i * 7 + 3, 12)
    e(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="4" fill="{color(r["current_status_code"])}" '
      f'fill-opacity="0.62"/>')
# least-squares trend line: distinct_churches ~ a + b*career_years
n = len(rows)
sx = sum(r["career_years"] for r in rows); sy = sum(r["distinct_churches"] for r in rows)
sxx = sum(r["career_years"]**2 for r in rows)
sxy = sum(r["career_years"]*r["distinct_churches"] for r in rows)
b = (n*sxy - sx*sy) / (n*sxx - sx*sx); a = (sy - b*sx) / n
e(f'<line x1="{px(0):.1f}" y1="{py(a):.1f}" x2="{px(xmax):.1f}" y2="{py(a+b*xmax):.1f}" '
  f'stroke="#2b2b2b" stroke-width="2" stroke-dasharray="6 4" stroke-opacity="0.7"/>')
tlx = xmax * 0.30
e(f'<text x="{px(tlx):.1f}" y="{py(a+b*tlx)+20:.1f}" font-size="11.5" '
  f'fill="#2b2b2b">trend: ~1 new church every {1/b:.1f} yrs</text>')
# legend (classes present, by count)
present = sorted({r["current_status_code"] for r in rows},
                 key=lambda c: -sum(1 for r in rows if r["current_status_code"] == c))
lx, ly = ax0 + aw - 168, ay0 + 8
e(f'<rect x="{lx-10}" y="{ly-8}" width="178" height="{14*len(present)+14}" '
  f'fill="#ffffff" stroke="#ddd" rx="4" fill-opacity="0.9"/>')
for j, c in enumerate(present):
    yy = ly + j * 16 + 4
    e(f'<circle cx="{lx}" cy="{yy-4}" r="5" fill="{color(c)}"/>')
    e(f'<text x="{lx+12}" y="{yy}" font-size="11.5" fill="#444">{html.escape(label(c))}</text>')

# ---------- Panel B: mobility rate by class ----------
by = defaultdict(lambda: [0, 0, 0])   # class -> [n, sum_churches, sum_years]
for r in rows:
    c = r["current_status_code"]
    by[c][0] += 1; by[c][1] += r["distinct_churches"]; by[c][2] += r["career_years"]
bars = []
for c, (n, sc, sy) in by.items():
    if n < 3 or sy == 0:   # skip tiny classes (unstable rate)
        continue
    bars.append((c, n, sc / sy * 10))     # churches per decade (pooled)
bars.sort(key=lambda b: -b[2])

bx0, by0, bw, bh = 250, 660, W - 320, 340
e(f'<text x="90" y="{by0-22}" font-size="16" fill="#2b2b2b" font-weight="bold">'
  f'B &#183; Mobility: churches served per decade of service</text>')
e(f'<text x="90" y="{by0-4}" font-size="12" fill="#777">'
  f'pooled across each class (classes with at least 3 clergy)</text>')
rmax = max(b[2] for b in bars) * 1.15
rowh = bh / len(bars)
for k, (c, n, rate) in enumerate(bars):
    yy = by0 + k * rowh
    blen = (rate / rmax) * bw
    e(f'<rect x="{bx0}" y="{yy+6}" width="{blen:.1f}" height="{rowh-14:.0f}" '
      f'fill="{color(c)}" fill-opacity="0.85" rx="2"/>')
    e(f'<text x="{bx0-10}" y="{yy+rowh/2+4:.0f}" text-anchor="end" font-size="13" fill="#333">'
      f'{html.escape(label(c))} <tspan fill="#999">({n})</tspan></text>')
    e(f'<text x="{bx0+blen+8:.1f}" y="{yy+rowh/2+4:.0f}" font-size="13" fill="#333" '
      f'font-weight="bold">{rate:.1f}</text>')
e(f'<text x="{bx0+bw/2}" y="{by0+bh+24}" text-anchor="middle" font-size="13" fill="#444">'
  f'churches per 10 years</text>')

e(f'<text x="90" y="{H-22}" font-size="11" fill="#999">'
  f'Source: Rio Texas Annual Conference Journal 2025, Section I (Clergy Records). '
  f'Gender/race not shown — not recorded in the journal.</text>')
e('</svg>')

path = HERE / "churches-over-years.svg"
path.write_text("\n".join(out))
print(f"Wrote {path}  ({len(rows)} clergy, {len(bars)} classes charted)")
for c, n, rate in bars:
    print(f"   {label(c):20s} n={n:3d}  {rate:.1f} churches/decade")
