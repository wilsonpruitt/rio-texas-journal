#!/usr/bin/env python3
"""
PAR — COSROW equity cut. LOCAL ONLY (reads the gitignored pastor CSV).

Question: when women are appointed, what kind of charge do they receive
(arrival membership, expected professions, community favorability) compared
to men — and how do they perform against those baselines (PAR/yr)?

Gender is inferred from first names (US/Spanish common-name lists). Unknowns
are reported, not guessed. Aggregates only — no names in output.

  python3 scripts/analysis/par_gender.py
"""
import csv, json, statistics, os

HERE = os.path.dirname(__file__)
CSV = os.path.join(HERE, "..", "data", "par", "pastor-par.csv")
BASELINE = os.path.join(HERE, "..", "data", "par", "baseline.json")
OUT = os.path.join(HERE, "..", "data", "par", "gender-aggregates.json")

FEMALE = set("""mary patricia linda barbara elizabeth jennifer maria susan margaret dorothy lisa nancy karen betty helen
sandra donna carol ruth sharon michelle laura sarah kimberly deborah jessica shirley cynthia angela melissa brenda amy anna
rebecca virginia kathleen pamela martha debra amanda stephanie carolyn christine marie janet catherine frances ann joyce diane
alice julie heather teresa doris gloria evelyn jean cheryl mildred katherine joan ashley judith rose janice kelly nicole judy
christina kathy theresa beverly denise tammy irene jane lori rachel marilyn andrea kathryn louise sara anne jacqueline wanda
bonnie julia ruby lois tina phyllis norma paula diana annie lillian emily robin peggy crystal gladys rita dawn connie florence
tracy edna tiffany carmen rosa cindy grace wendy victoria edith kim sherry sylvia josephine thelma shannon sheila ethel ellen
elaine marjorie carrie charlotte monica esther pauline emma juanita anita rhonda hazel amber eva debbie april leslie clara
lucille jamie joanne eleanor valerie danielle megan alicia suzanne michele gail bertha darlene veronica jill erin geraldine
lauren cathy joann lorraine lynn sally regina erica beatrice dolores bernice audrey yvonne annette marion dana stacy ana renee
ida vivian roberta holly brittany melanie loretta yolanda jeanette laurie katie kristen vanessa alma sue elsie beth jeanne
vicki carla tara rosemary eileen terri gertrude lucy tonya ella stacey wilma gina kristin jessie natalie agnes vera willie
charlene bessie delores melinda pearl arlene maureen colleen allison tamara joy georgia constance lillie claudia jackie
marcia tanya nellie minnie marlene heidi glenda lydia viola courtney marian stella caroline dora jo vickie mattie terry
maxine irma mabel marsha myrtle lena christy deanna patsy hilda gwendolyn jennie nora margie nina cassandra leah penny kay
priscilla naomi carole brandy olga billie dianne tracey leona jenny felicia sonia miriam velma becky bobbie violet kristina
toni misty mae shelly daisy ramona sherri erika katrina claire guadalupe lupe rosario esperanza soledad dolores concepcion
adriana alejandra beatriz blanca cecilia claudia cristina daniela elena gabriela graciela isabel josefina leticia lourdes
luz magdalena margarita marisol mercedes monica norma olivia patricia raquel rocio rosalinda ruth silvia sofia susana teresa
veronica yolanda adrienne dawn tiffany amy karen laura sarah rachel hannah abigail chloe sophia madison natasha kara
kathie cathie kerri keri sherry sheri lacy lacey shawna deb debby kris tricia trisha meredith whitney paige brooke jan
elisabeth lizbeth beth bethany"""
.split())

MALE = set("""james john robert michael william david richard charles joseph thomas christopher daniel paul mark donald george
kenneth steven edward brian ronald anthony kevin jason matthew gary timothy jose larry jeffrey frank scott eric stephen
andrew raymond gregory joshua jerry dennis walter patrick peter harold douglas henry carl arthur ryan roger joe juan jack
albert jonathan justin terry gerald keith samuel willie ralph lawrence nicholas roy benjamin bruce brandon adam harry fred
wayne billy steve louis jeremy aaron randy howard eugene carlos russell bobby victor martin ernest phillip todd jesse craig
alan shawn clarence sean philip chris johnny earl jimmy antonio danny bryan tony luis mike stanley leonard nathan dale manuel
rodney curtis norman allen marvin vincent glenn jeffery travis jeff chad jacob lee melvin alfred kyle francis bradley jesus
herbert frederick ray joel edwin don eddie ricky troy randall barry alexander bernard mario leroy francisco marcus micheal
theodore clifford miguel oscar jay jim tom calvin alex jon ronnie bill lloyd tommy leon derek warren darrell jerome floyd
leo alvin tim wesley gordon dean greg jorge dustin pedro derrick dan lewis zachary corey herman maurice vernon roberto clyde
glen hector shane ricardo sam rick lester brent ramon charlie tyler gilbert gene marc reginald ruben brett angel nathaniel
rafael leslie edgar milton raul ben chester cecil duane franklin andre elmer brad gabriel ron mitchell roland arnold harvey
jared adrian karl cory claude erik darryl jamie neil jessie christian javier fernando clinton ted mathew tyrone darren lonnie
lance cody julio kelly kurt allan nelson guy clayton hugh max dwayne dwight armando felix jimmie everett jordan ian wallace
ken bob jaime casey alfredo alberto dave ivan johnnie sidney byron julian isaac morris clifton willard daryl ross virgil
andy marshall salvador perry kirk sergio marion tracy seth kent terrance rene eduardo terrence enrique freddie wade austin
stuart fredrick arturo alejandro jackie joey nick luther wendell jeremiah evan julius dana donnie otis shannon trevor oliver
luke homer gerard doug kenny hubert angelo shaun lyle matt lynn alfonso orlando rex carlton ernesto cameron neal pablo lorenzo
omar wilbur blake grant horace roderick kerry abraham willis rickey jean ira andres cesar johnathan malcolm rudolph damon
kelvin rudy preston alton archie marco wm pete randolph garry geoffrey jonathon felipe bennie gerardo ed dominic robin loren
delbert colin guillermo earnest lucas benny noel spencer rodolfo myron edmund garrett salvatore cedric lowell gregg sherman
wilson devin sylvester kim roosevelt israel jermaine forrest wilbert leland simon guadalupe clark irving carroll bryant owen
rufus woodrow sammy kristopher mack levi marcos gustavo jake lionel marty taylor ellis dallas gilberto clint nicolas laurence
ismael orville drew jody ervin dewey al wilfred josh hugo ignacio caleb tomas sheldon erick frankie stewart doyle darrel rogelio
terence santiago alonzo elias bert elbert ramiro conrad pat noah grady phil cornelius lamar rolando clay percy dexter bradford
merle darin amos terrell moses irvin saul roman darnell randal tommie timmy darrin winston brendan toby van abel dominick boyd
courtney jan emilio elijah cary domingo santos aubrey emmett marlon emanuel jerald edmond emil dewayne will otto teddy reynaldo
bret morgan jess trent humberto emmanuel stephan louie vicente lamont stacy garland miles micah efrain billie logan heath rodger
harley demetrius ethan eldon rocky pierre junior freddy eli denis gale gordon wilson zachariah zane"""
.split())

def infer(name: str) -> str:
    # canonical names look like "Michael Paul Crocker", "Juan, Jr. Cantu", "Amy Katherine McClung"
    first = name.strip().split()[0].strip(",.").lower() if name.strip() else ""
    if first in FEMALE and first in MALE:
        return "unknown"  # ambiguous (e.g. kelly, tracy, kim appear in both)
    if first in FEMALE:
        return "F"
    if first in MALE:
        return "M"
    return "unknown"

with open(CSV) as f:
    rows = list(csv.DictReader(f))
baseline = json.load(open(BASELINE))
fav = {c["gcfa"]: c.get("favorability") for c in baseline["churches"]}

for r in rows:
    r["gender"] = infer(r["clergy"])
    r["fav"] = fav.get(r["gcfa"])

known = [r for r in rows if r["gender"] in ("M", "F")]
print(f"stints: {len(rows)} | gender inferred: {len(known)} ({100*len(known)/len(rows):.0f}%) | unknown: {len(rows)-len(known)}")
distinct = {}
for r in rows:
    distinct[r["clergy"]] = r["gender"]
by = {"M": 0, "F": 0, "unknown": 0}
for g in distinct.values():
    by[g] += 1
print(f"distinct pastors: {len(distinct)} -> M {by['M']} | F {by['F']} | unknown {by['unknown']}")

def med(xs): return statistics.median(xs) if xs else None
def mean(xs): return sum(xs)/len(xs) if xs else None

agg = {}
for g in ("M", "F"):
    grp = [r for r in known if r["gender"] == g]
    arrival = [int(r["arrival_members"]) for r in grp if r["arrival_members"]]
    expyr = [float(r["expected_total"])/int(r["years_scored"]) for r in grp if int(r["years_scored"]) > 0]
    favs = [r["fav"] for r in grp if r["fav"] is not None]
    paryr = [float(r["par_per_yr"]) for r in grp]
    shrunk = [float(r["par_shrunk"]) for r in grp]
    agg[g] = {
        "stints": len(grp),
        "pastors": len({r["clergy"] for r in grp}),
        "medianArrivalMembers": med(arrival),
        "meanArrivalMembers": round(mean(arrival), 1),
        "medianExpectedPerYr": round(med(expyr), 2),
        "medianFavorability": med(favs),
        "meanParPerYr": round(mean(paryr), 2),
        "medianParPerYr": round(med(paryr), 2),
        "meanParShrunk": round(mean(shrunk), 2),
        "pctPositivePar": round(100*sum(1 for p in paryr if p > 0)/len(paryr)),
    }
    print(f"\n{g}: {agg[g]['stints']} stints / {agg[g]['pastors']} pastors")
    print(f"  arrival charge:   median {agg[g]['medianArrivalMembers']} members (mean {agg[g]['meanArrivalMembers']})")
    print(f"  expected prof/yr: median {agg[g]['medianExpectedPerYr']}")
    print(f"  community favorability: median {agg[g]['medianFavorability']} (0=hardest, 100=easiest)")
    print(f"  PAR/yr: mean {agg[g]['meanParPerYr']} | median {agg[g]['medianParPerYr']} | {agg[g]['pctPositivePar']}% positive")

# size-band distribution of arrival charges
bands = ["<50", "50-99", "100-249", "250-499", "500+"]
def band(m): m=int(m); return "<50" if m<50 else "50-99" if m<100 else "100-249" if m<250 else "250-499" if m<500 else "500+"
print("\narrival size-band mix (share of stints):")
banddist = {}
for g in ("M", "F"):
    grp = [r for r in known if r["gender"] == g and r["arrival_members"]]
    dist = {b: 0 for b in bands}
    for r in grp:
        dist[band(r["arrival_members"])] += 1
    n = len(grp)
    banddist[g] = {b: round(100*dist[b]/n) for b in bands}
    print(f"  {g}: " + " | ".join(f"{b} {banddist[g][b]}%" for b in bands))

# tall-steeple tail — where the actual gap lives (medians above are near-identical)
tail = {}
for cut in (500, 750, 1000):
    row = {}
    for g in ("M", "F"):
        grp = [r for r in known if r["gender"] == g and r["arrival_members"]]
        n = sum(1 for r in grp if int(r["arrival_members"]) >= cut)
        row[g] = {"n": n, "pct": round(100*n/len(grp))}
    tail[str(cut)] = row
    print(f"arrivals >= {cut} members: M {row['M']['n']} ({row['M']['pct']}%) | F {row['F']['n']} ({row['F']['pct']}%)")
big20 = sorted([r for r in known if r["arrival_members"]], key=lambda r: -int(r["arrival_members"]))[:20]
tail["top20"] = {"M": sum(1 for r in big20 if r["g" if "g" in r else "gender"] == "M"),
                 "F": sum(1 for r in big20 if r["gender"] == "F")}
for g in ("M", "F"):
    xs = [int(r["arrival_members"]) for r in known if r["gender"] == g and int(r["arrival_members"] or 0) >= 500]
    tail.setdefault("median500plus", {})[g] = med(xs)
print(f"top-20 largest arrivals: M {tail['top20']['M']} / F {tail['top20']['F']} | median size of 500+ arrivals: M {tail['median500plus']['M']} vs F {tail['median500plus']['F']}")

agg["bandMix"] = banddist
agg["tail"] = tail
agg["coverage"] = {"stints": len(rows), "inferred": len(known), "pastorsM": by["M"], "pastorsF": by["F"], "pastorsUnknown": by["unknown"]}
json.dump(agg, open(OUT, "w"), indent=2)
print(f"\nwrote {OUT} (aggregates only, no names)")
