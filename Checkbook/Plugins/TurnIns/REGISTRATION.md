# Turn-In Plugins — Environment Variable & FY27 Credit-LOA Rules

Deep-dive doc for the `book_TurnInCreditOPR` env var that the Turn-In
approval pipeline reads via `TurnInLOAResolver` for FY27+ records.

> **Canonical step registrations for the five Turn-In plugins**
> (`TurnInAmountCalculator`, `TurnInValidator`, `TurnInApprovalPlugin`,
> `TurnInDeactivator`, `TurnInRequiresBEApprovalRecalc`) **live in
> [`../PLUGIN-REGISTRATION.md`](../PLUGIN-REGISTRATION.md) under the
> `## TurnIns` section.** This file only covers the FY27 credit-LOA
> resolution rules and the env var that drives them.

## `book_TurnInCreditOPR`

Environment variable that holds the GUID of the OPR (Disbursing Official)
that receives turned-in funds for **FY27 and later** Turn-Ins.

| Field | Value |
|---|---|
| Schema name | `book_TurnInCreditOPR` |
| Display name | ARNG Checkbook — Turn-In Credit OPR |
| Data type | **Text** |
| Required | No |
| Default value | _(leave blank or set to the BE OPR record id)_ |
| Current value (per env) | The `book_opr` record GUID for the OPR that should receive returns |

Read by `TurnInLOAResolver.ResolveCreditLOA_FY27Plus` (via
`Checkbook.Plugins.Helpers.EnvironmentVariableHelper.GetGuid`). The resolver:

1. Parses the Turn-In's Fund name (`…D26` → FY26, `…D27` → FY27, etc).
2. If FY &le; 26 → uses the **legacy** filter:
   `Fund + PG + BOC(BASE) + DollarType(BASE) + MDEP(RISK)`. No env var read.
3. If FY &ge; 27 → uses the **new** filter:
   `Fund + DisbursingOfficial(<env var GUID>) + (PG or SAG)`.
   - PG vs SAG follows the same APPN rule as LOA names: NGPA / NGPM / NGREA → PG;
     all other appropriations → SAG, derived from PG via `book_sag.book_pg`.

The cutoff lives in `LOAs.Helpers.LOANameBuilder.LegacyGrainLastFy` (currently
26). Bump that constant if the legacy-grain rule ever extends another year.

### FY27 item-based Turn-Ins (2026-10-15)

FY27 State/BE Turn-Ins built with the TurnInBuilder have **no header Fund/PG** —
one Turn-In can span several Fund/SAGs (docs/TurnIn-FY27-Redesign.md). For these
(`book_fiscalyear` ≥ 2027 and at least one item) the credit LOA is resolved **per
debit LOA** by `TurnInLOAResolver.ResolveLOAsFy27`:
`Fund (debit LOA's) + DisbursingOfficial(<env var GUID>) + (PG | SAG of the debit LOA)`,
PG vs SAG by the Fund's appropriation as above. Each source LOA's money returns to
the ARNG holding LOA with the same Fund + PG/SAG, so the env var must point at the
**ARNG** OPR. Zero-item Sweep Turn-Ins keep the header Fund/PG rule above.

Sandbox value set by `devtools/sandbox-import/data-seed/transactional/fy27_turnin_validate.py`
(ARNG OPR `9b6d7541-02c1-f111-aaaf-70a8a5af378b`). **Gov: confirm the env var value is
the ARNG OPR before FY27 Turn-Ins are approved.**

### Failure modes (all surface as `InvalidPluginExecutionException`)

- Env var not defined → `Environment variable 'book_TurnInCreditOPR' is not defined in this environment.`
- Env var empty or unparsable → `Environment variable 'book_TurnInCreditOPR' value '<x>' is not a valid GUID.`
- No matching LOA → message lists the Fund / OPR / PG-or-SAG filter so the
  user can verify the BE OPR's holding LOA exists.
- &gt;1 matching LOA → the BE OPR's holding LOA must be unique per
  `(Fund, PG/SAG)`; fix the schema before re-approving.
- PG → SAG derivation finds 0 or &gt;1 SAG → resolver bails with a clear
  message telling the user to normalize the PG → SAG hierarchy.
