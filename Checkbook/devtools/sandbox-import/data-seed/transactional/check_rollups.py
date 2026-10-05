#!/usr/bin/env python3
import sys, urllib.parse as u
sys.path.insert(0, "/tmp/claude-1000/-home-eric-Sync-Power-Platform/b20160c1-a641-4142-8694-7e91f30bc3ff/scratchpad")
import dvapi

def q(es, sel, order="book_name"):
    return dvapi.get(f"{es}?" + u.urlencode({"$select": sel, "$orderby": order}, quote_via=u.quote)).get("value", [])

print("=== auto-created funding junctions ===")
for j in q("book_prioritizationfundings", "book_name,book_fundedamount,book_validatedamount"):
    print(f"  {j.get('book_name')}: funded={j.get('book_fundedamount')} validated={j.get('book_validatedamount')}")

print("\n=== Requirement Funding (roll-up from junctions) ===")
for r in q("book_requirementfundings", "book_name,book_newtdp,book_newfundedamount,book_newvalidatedamount,book_newunfundedamount"):
    print(f"  {r.get('book_name')}: tdp={r.get('book_newtdp')} funded={r.get('book_newfundedamount')} validated={r.get('book_newvalidatedamount')} unfunded={r.get('book_newunfundedamount')}")

print("\n=== LOA TDP remaining (roll-up from RF allocations) ===")
for l in q("book_fundinglines", "book_name,book_newtdp,book_newtdpremaining"):
    print(f"  {l.get('book_name')}: tdp={l.get('book_newtdp')} remaining={l.get('book_newtdpremaining')}")

print("\n=== Prioritizations ===")
for p in q("book_prioritizations", "book_name,book_newrequestedamount,book_newfundedamounttdp,book_unfundedamount,book_approvalstatus"):
    print(f"  {p.get('book_name')}: requested={p.get('book_newrequestedamount')} funded={p.get('book_newfundedamounttdp')} unfunded={p.get('book_unfundedamount')} status={p.get('book_approvalstatus')}")
