#!/usr/bin/env python3
import sys
sys.path.insert(0, "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad")
import dvapi

# 54 ARNG states/territories: 50 states + DC, PR, GU, VI
STATES = [
    ("Alabama","AL"),("Alaska","AK"),("Arizona","AZ"),("Arkansas","AR"),("California","CA"),
    ("Colorado","CO"),("Connecticut","CT"),("Delaware","DE"),("Florida","FL"),("Georgia","GA"),
    ("Hawaii","HI"),("Idaho","ID"),("Illinois","IL"),("Indiana","IN"),("Iowa","IA"),
    ("Kansas","KS"),("Kentucky","KY"),("Louisiana","LA"),("Maine","ME"),("Maryland","MD"),
    ("Massachusetts","MA"),("Michigan","MI"),("Minnesota","MN"),("Mississippi","MS"),("Missouri","MO"),
    ("Montana","MT"),("Nebraska","NE"),("Nevada","NV"),("New Hampshire","NH"),("New Jersey","NJ"),
    ("New Mexico","NM"),("New York","NY"),("North Carolina","NC"),("North Dakota","ND"),("Ohio","OH"),
    ("Oklahoma","OK"),("Oregon","OR"),("Pennsylvania","PA"),("Rhode Island","RI"),("South Carolina","SC"),
    ("South Dakota","SD"),("Tennessee","TN"),("Texas","TX"),("Utah","UT"),("Vermont","VT"),
    ("Virginia","VA"),("Washington","WA"),("West Virginia","WV"),("Wisconsin","WI"),("Wyoming","WY"),
    ("District of Columbia","DC"),("Puerto Rico","PR"),("Guam","GU"),("Virgin Islands","VI"),
]
PGS  = [str(n) for n in range(10010, 10091, 10)]   # 10010..10090
OPRS = [f"G{n}" for n in range(1, 10)]             # G1..G9

n = 0
for name, abbr in STATES:
    dvapi.post("book_states", {"book_name": name, "book_abbreviation": abbr}); n += 1
print(f"states: {n}")
n = 0
for pg in PGS:
    dvapi.post("book_pgs", {"book_name": pg}); n += 1
print(f"pgs: {n}")
n = 0
for opr in OPRS:
    dvapi.post("book_oprs", {"book_name": opr}); n += 1
print(f"oprs: {n}")
print("--- counts ---")
import urllib.request
for es in ("book_states","book_pgs","book_oprs"):
    print(f"  {es}: {dvapi.get(es+'?$count=true&$top=1').get('@odata.count')}")
