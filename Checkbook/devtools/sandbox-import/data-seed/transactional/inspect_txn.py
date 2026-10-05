#!/usr/bin/env python3
import re, os, glob
ROOT = "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad/cbunpack"

# build lookup target map: (refing_entity_lower, refing_attr_lower) -> referenced_entity_lower
lk = {}
for f in glob.glob(os.path.join(ROOT, "Other/Relationships/*.xml")):
    s = open(f, encoding="utf-8").read()
    for m in re.finditer(r"<EntityRelationship Name=.*?</EntityRelationship>", s, re.DOTALL):
        b = m.group(0)
        re_ = re.search(r"<ReferencingEntityName>([^<]+)</ReferencingEntityName>", b)
        ra  = re.search(r"<ReferencingAttributeName>([^<]+)</ReferencingAttributeName>", b)
        rd  = re.search(r"<ReferencedEntityName>([^<]+)</ReferencedEntityName>", b)
        if re_ and ra and rd:
            lk[(re_.group(1).lower(), ra.group(1).lower())] = rd.group(1).lower()

ENTS = ["book_Requirements","book_Prioritization","book_RequirementFunding",
        "book_ObligationAuthority","book_FundingTrack","book_PrioritizationFunding"]

for ent in ENTS:
    f = os.path.join(ROOT, "Entities", ent, "Entity.xml")
    if not os.path.exists(f): print(f"== {ent}: NO FOLDER =="); continue
    s = open(f, encoding="utf-8").read()
    print(f"\n===== {ent} (logical {ent.lower()}) =====")
    for am in re.finditer(r"<attribute PhysicalName=\"(book_[^\"]+)\">(.*?)</attribute>", s, re.DOTALL):
        name, body = am.group(1), am.group(2)
        typ = (re.search(r"<Type>([^<]+)</Type>", body) or [None, "?"])[1]
        req = (re.search(r"<RequiredLevel>([^<]+)</RequiredLevel>", body) or [None, "none"])[1]
        if typ == "lookup":
            tgt = lk.get((ent.lower(), name.lower()), "?")
            print(f"  {name:34} lookup -> {tgt:28} [{req}]")
        elif typ in ("money", "decimal", "double", "integer") or req in ("required", "recommended", "systemrequired"):
            print(f"  {name:34} {typ:10} [{req}]")
