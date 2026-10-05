#!/usr/bin/env python3
"""Delete all transactional seed records (children-first). Run before re-seeding."""
import sys
sys.path.insert(0, "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad")
import dvapi

# children before parents
for es in ("book_prioritizationfundings", "book_prioritizations", "book_requirementfundings",
           "book_requirementses", "book_fundinglines", "book_fundingtracks", "book_mdeps"):
    n = 0
    for r in dvapi.get(es + "?$select=book_name").get("value", []):
        gid = next((v for k, v in r.items() if k.endswith("id") and isinstance(v, str) and len(v) == 36), None)
        if gid:
            try: dvapi.delete(es, gid); n += 1
            except Exception as e: print(f"  {es} del err: {str(e)[:80]}")
    print(f"  cleared {es}: {n}")
