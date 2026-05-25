# Turn-In Plugins — Environment Variable

The Turn-In approval pipeline is already registered (assembly steps for
`TurnInValidator`, `TurnInApprovalPlugin`, `TurnInDeactivator`). The change
below is the only Dataverse-side configuration needed for the FY27 credit-LOA
resolution rules.

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

The cutoff lives in `LOAs.Helpers.LOANameBuilder.MdepInNameLastFy` (currently
26). Bump that constant if the MDEP-in-name rule ever extends another year.

### Failure modes (all surface as `InvalidPluginExecutionException`)

- Env var not defined → `Environment variable 'book_TurnInCreditOPR' is not defined in this environment.`
- Env var empty or unparsable → `Environment variable 'book_TurnInCreditOPR' value '<x>' is not a valid GUID.`
- No matching LOA → message lists the Fund / OPR / PG-or-SAG filter so the
  user can verify the BE OPR's holding LOA exists.
- &gt;1 matching LOA → the BE OPR's holding LOA must be unique per
  `(Fund, PG/SAG)`; fix the schema before re-approving.
- PG → SAG derivation finds 0 or &gt;1 SAG → resolver bails with a clear
  message telling the user to normalize the PG → SAG hierarchy.
