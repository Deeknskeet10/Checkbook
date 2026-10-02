#!/usr/bin/env python3
import re, os

ROOT = "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad/cbunpack"

def read(p):
    with open(p, encoding="utf-8") as f: return f.read()
def write(p, s):
    with open(p, "w", encoding="utf-8") as f: f.write(s)

# --- 1. Main form: strip the 3 APMO subgrid tabs + the web-resource library ---
form = os.path.join(ROOT, "Entities/apmo_GenericRVB/FormXml/main/{a5f05669-53ed-42eb-911a-b7d70f924689}.xml")
s = read(form)
before = s
# remove tab_2, tab_3, tab_4 (each contains exactly one </tab>; non-greedy is safe)
s, n_tabs = re.subn(r'[ \t]*<tab name="tab_[234]".*?</tab>\n', '', s, flags=re.DOTALL)
# remove the apmo_hidervbsubgrid form library (leave an empty formLibraries element)
s = re.sub(r'<formLibraries>.*?</formLibraries>', '<formLibraries></formLibraries>', s, flags=re.DOTALL)
assert 'apmo_hidervbsubgrid' not in s, "library ref still present"
assert 'apmo_rvb_GenericRVB' not in s and 'apmo_prejudice_GenericRVB' not in s and 'apmo_sa_GenericRVB' not in s, "subgrid rel still present"
assert s != before
write(form, s)
print(f"[form] removed {n_tabs} APMO subgrid tabs + web-resource library")

# --- 2. Entity.xml: drop the external icon web-resource reference ---
ent = os.path.join(ROOT, "Entities/apmo_GenericRVB/Entity.xml")
s = read(ent)
s2 = s.replace("<IconVectorName>apmo_GenericRVBIcon</IconVectorName>", "<IconVectorName></IconVectorName>")
assert s2 != s, "icon ref not found"
write(ent, s2)
print("[entity] cleared apmo_GenericRVBIcon reference")

# --- 3. Solution.xml: empty the MissingDependencies node (kills ghost FSP deps; platform recomputes real deps from components) ---
sol = os.path.join(ROOT, "Other/Solution.xml")
s = read(sol)
s2, n = re.subn(r'<MissingDependencies>.*?</MissingDependencies>', '<MissingDependencies></MissingDependencies>', s, flags=re.DOTALL)
assert n == 1 and s2 != s, "MissingDependencies node not replaced"
assert '07c36b9a-6f24-f011-998a-001dd805a06b' not in s2 and 'e1f5babf-6f24-f011-998a-001dd805a06b' not in s2, "ghost FSP still present"
write(sol, s2)
print("[solution] emptied MissingDependencies (ghosts + stale apmo deps gone)")

print("DONE")
