#!/usr/bin/env python3
import os, re, glob

ROOT = "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad/cbunpack"

# entities that actually have currency columns (transactioncurrencyid)
currency_entities = set()
for ent in glob.glob(os.path.join(ROOT, "Entities/*/Entity.xml")):
    with open(ent, encoding="utf-8") as f:
        if "transactioncurrencyid" in f.read():
            # logical name = folder name, lowercased
            currency_entities.add(os.path.basename(os.path.dirname(ent)).lower())
print("entities WITH currency:", sorted(currency_entities))

STALE = ("transactioncurrencyid", "exchangerate")
changed = 0
for stp in glob.glob(os.path.join(ROOT, "SdkMessageProcessingSteps/*.xml")):
    with open(stp, encoding="utf-8") as f:
        s = f.read()
    m = re.search(r"<PrimaryObjectTypeCode>([^<]*)</PrimaryObjectTypeCode>", s)
    entity = (m.group(1).lower() if m else "")
    fm = re.search(r"<FilteringAttributes>([^<]*)</FilteringAttributes>", s)
    if not fm:
        continue
    attrs = [a for a in fm.group(1).split(",") if a]
    if entity in currency_entities:
        continue  # currency fields exist here; leave filter alone
    new_attrs = [a for a in attrs if a not in STALE]
    if new_attrs != attrs:
        s = s.replace(fm.group(0), "<FilteringAttributes>" + ",".join(new_attrs) + "</FilteringAttributes>")
        with open(stp, "w", encoding="utf-8") as f:
            f.write(s)
        changed += 1
        print(f"  stripped {set(attrs)-set(new_attrs)} from step on '{entity}' ({os.path.basename(stp)})")
print(f"DONE - {changed} step(s) fixed")
