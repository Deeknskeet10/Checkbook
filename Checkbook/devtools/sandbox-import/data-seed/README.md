# Reference-data seeding (dev sandbox)

Loads ARNG Checkbook **reference data** into a dev environment via the Dataverse Web API.
First used 2026-10-05 to seed `Blipsnchitz` after the solution import.

## Auth

Uses the service principal `checkbook-sandbox-cli` (AppId `8e54ae46-…`) via **client
credentials**. `dvapi.py` reads the secret from `~/.config/checkbook-dataload.secret`
(chmod 600, **never** in the repo) and mints org tokens on demand (auto-refreshing, so
no expiry problems). AppId can be overridden via `~/.config/checkbook-dataload.appid`.

> There is no `pac` verb for generic data writes — that's why this uses the Web API
> directly. pac is only for solution/PCF/plugin operations.

## Run (inside devenv, from Checkbook/)

```bash
direnv exec . bash -c 'python3 devtools/sandbox-import/data-seed/load_ref.py'   # States, PGs, OPRs
direnv exec . bash -c 'python3 devtools/sandbox-import/data-seed/load_ref2.py'  # FundCenters, Funds, SAGs, APEs
```

Both are **idempotent** (get-or-create by `book_name`), so re-running won't duplicate.
`inspect_meta.py` dumps lookup navigation-property names and choice option values.

## What gets loaded (defaults — refine later)

| Table | Rows | Notes |
|---|---|---|
| State | 54 | 50 states + DC, PR, GU, VI (`book_abbreviation`) |
| PG | 9 | 10010–10090 |
| OPR | 9 | G1–G9 |
| FundCenter | 66 | `A18` → `A18NG` → `A1830`(HQ)/`A1831–A1839`(G1–G9); `A18`→`A18<abbr>` per state (state linked) |
| Fund | 24 | `{2020\|2060\|2065}{10=BASE\|20=OOC}{D\|F}{26\|27}`; appropriation + fiscalyear choices set |
| SAG | 22 | 111–132, round-robin across the 9 PGs |
| APE | 10 | placeholder `APE000001`–`APE000010` |

## Gotchas learned (baked into the scripts)

- Web API payloads use **logical (lowercase)** attribute names (`book_name`, not `book_Name`).
- Lookups bind via `@odata.bind` with the **navigation-property** name (schema-cased):
  `book_ParentFundCenter`, `book_State`, `book_PG`.
- `book_fundcenter.book_category` is a **local** option set (values `0,1,2`) — NOT the global
  `book_category` (ARMY=4…). It's **left blank** here; set real values later. `safe_post`
  auto-drops any choice value the server rejects (reported at the end of the run).
- Appropriation 4-digit code → choice: `2020→OMA(4)`, `2060→NGPA(1)`, `2065→OMNG(3)`;
  fiscal year `FY26=2026 / FY27=2027` (goal_fiscalyear). Dollar-type/direct-reimb live in
  the fund **name** only (no dedicated columns populated).
- `$filter` queries must be URL-encoded (spaces/quotes).

## Still TODO (data)

- Correct `book_fundcenter.book_category` values (local 0/1/2) once their meaning is known.
- Transactional/sample data (Requirements, Prioritizations, RFs, Turn-Ins) to exercise plugin roll-ups.
