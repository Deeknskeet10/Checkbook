# Sandbox import tooling (prod → personal dev environment)

Scripts + runbook for importing a production `ARNGCheckbook` solution export into a
**personal/commercial Dataverse dev environment** that does **not** have the external
**APMO** data model installed. First used 2026-10-02 to stand up the `Blipsnchitz`
sandbox from `ARNGCheckbook_1_11_0_119.zip`.

## Why this is needed

Checkbook is coupled to an APMO reference model (`apmo_*` tables) that is circular /
unavailable to import standalone. Rather than drag in all of APMO, we:

1. **Stub** the `apmo_*` tables Checkbook's lookups point at (empty shells).
2. **Strip** `apmo_genericrvb`'s own outbound APMO dependencies (its form's RVB/SA/
   Prejudice subgrids, the icon, the form web-resource library) while **keeping the
   base table** so the `book_ → apmo` lookups (book_Item.book_RVB,
   book_Requirements.book_newRVB, book_RequirementFunding.book_RVBNumber) survive.
3. Drop two **ghost FieldSecurityProfiles** ("Requirement - Budget Executors/Resource
   Integrators") that are deleted in prod but linger as phantom MissingDependencies.
4. Fix a **stale plugin-step filter** (`transactioncurrencyid`/`exchangerate` on an
   entity with no currency field).

## Prerequisites

- `pac` authenticated to the target env and a **Dataverse System Administrator** there.
  (Entra Global/PP Admin is NOT enough — bootstrap via Power Platform admin center >
  Environments > `…` > Manage membership > add yourself as System Administrator.)
- If the tenant has **Security Defaults** on, pac user auth fails with `AADSTS530035`
  (device-code AND interactive). Either disable Security Defaults, or auth with a
  **service principal** (`pac admin create-service-principal`), which Defaults ignores.
- Run everything inside devenv: `direnv exec . bash -c '...'` from `Checkbook/`.
  (If devenv throws `dotenv.resolved … no value defined` after a nix update, run
  `devenv update` then `direnv allow .`.)

## Runbook

All three scripts have a `ROOT`/`OUT` path constant near the top pointing at a working
directory — **set those to your working dir** before running (they were written against
a session scratchpad path).

```bash
WORK=/path/to/working-dir            # scratch area, NOT the repo
PROD_ZIP=/path/to/ARNGCheckbook_X.zip

# 1. Create + import the apmo_ stub solution (9 tables; apmo_rvb gets apmo_rvbnumber)
python3 gen_stubs.py                 # -> $WORK/APMOStubs.zip
pac solution import --path "$WORK/APMOStubs.zip" --publish-changes

# 2. Unpack the prod Checkbook export
pac solution unpack --zipfile "$PROD_ZIP" --folder "$WORK/cbunpack" --packagetype Unmanaged

# 3. Strip apmo_genericrvb's outbound deps + empty MissingDependencies (ghost FSPs)
python3 strip_apmo.py

# 4. Strip stale transactioncurrencyid/exchangerate filters from plugin steps
python3 fix_steps.py

# 5. Repack + import
pac solution pack --folder "$WORK/cbunpack" --zipfile "$WORK/ARNGCheckbook_stripped.zip" --packagetype Unmanaged
pac solution import --path "$WORK/ARNGCheckbook_stripped.zip" --activate-plugins --publish-changes
```

## What's deliberately NOT in the sandbox after this

- The **Generic RVB form** subgrids (Associated RVBs / Prejudices / SAs) and its icon.
  The `apmo_genericrvb` table and all `book_` RVB lookups remain functional.
- Real APMO reference data (the stubs are empty).

## Post-import (not handled by these scripts)

Environment variable values, connection references / cloud flows (one flow references
`item/book_fundedamount` and needs reconnecting), business units + security roles +
test users (BU-scoped plugins misbehave without them), and synthetic seed data.

## Updating to a newer prod export

Re-run the whole runbook with the new `$PROD_ZIP`. If the new export references
additional `apmo_*` tables/columns, add them to `gen_stubs.py`; if the import still
reports missing deps, the error enumerates exactly what to stub or strip next.
