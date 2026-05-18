# ARNGCheckbook.Plugins — Plugin Registration Guide

Step-by-step reference for registering this assembly with the **Plugin
Registration Tool (PRT)**. This is the human-readable companion to
`PluginRegistration.json` (the manifest consumed by `Register-Plugins.ps1`);
both describe the same steps — keep them in sync.

---

## Assembly

| Property | Value |
|----------|-------|
| Assembly name | `ARNGCheckbook.Plugins` |
| Version | `1.0.0.0` |
| Build output | `bin/Debug/net462/ARNGCheckbook.Plugins.dll` |
| Isolation mode | **Sandbox** |
| Location | Database |

Build before registering:

```bash
cd plugins/ARNGCheckbook.Plugins
dotnet build
```

---

## How to register with the Plugin Registration Tool

1. **Connect** PRT to the target environment.
2. **Register New Assembly** → select `ARNGCheckbook.Plugins.dll` →
   Isolation Mode **Sandbox**, Location **Database** → Register.
   - On a later build, use **Update** on the existing assembly instead of
     re-registering, so existing steps/images are preserved.
3. For each **step** in the tables below: select the plugin type →
   **Register New Step** → fill in Message, Primary Entity, Stage, Execution
   Mode, Filtering Attributes → Register.
4. For each step that lists an **image**: select the step →
   **Register New Image** → set Image Type, Name, Entity Alias, and Attributes.
5. Add the assembly and all steps/images to the **`ARNGCheckbook`** solution.

### Field conventions used in the tables

- **Stage** — `PreOperation` = stage 20, `PostOperation` = stage 40
  (`PreValidation` = stage 10, not used here).
- **Mode** — `Synchronous` blocks the transaction; `Asynchronous` runs in a
  background system job after the operation commits.
- **Filtering Attributes** — step fires only when one of these columns changes
  (Update steps only). Blank = fires on every change.
- **Image** — `PreImage` is a snapshot *before* the operation. For Update steps
  register it with the listed attributes; for Delete steps it is the only way
  to see the deleted record's values. Use the **Name** exactly as given — the
  plugin code looks it up by that name.

---

## ⭐ New — Itemized Details feature

These two plugins are the newly-added feature. Register both.

### `ARNGCheckbook.Plugins.BusinessLogic.ItemizedDetailsSynchronizer`

Syncs `book_itemizeddetails` records to Prioritizations when Requirement Details
or Prioritizations change.

| Step name | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|-----------|---------|----------------|-------|------|-----------------|-------|
| RequirementDetails Create | `Create` | `book_requirementdetails` | PostOperation | **Asynchronous** | — | — |
| RequirementDetails Delete | `Delete` | `book_requirementdetails` | PreOperation | **Synchronous** | — | — |
| Prioritization Create | `Create` | `book_prioritization` | PostOperation | **Asynchronous** | — | — |

Notes:
- The Delete step **must** be `PreOperation` — it deletes the child
  `book_itemizeddetails` rows before the parent row is removed.
- The two Create steps are `Asynchronous`; Itemized Details appear a moment
  after the parent save. Switch to `Synchronous` if you need them immediately.
- No images required — the steps use the Target and the Primary Entity Id.

### `ARNGCheckbook.Plugins.BusinessLogic.PrioritizationItemizedRollup`

Rolls Itemized Details Requested/Validated/Funded amounts up to the parent
Prioritization (decimal fields `book_newrequestedamount`, `book_validatedamount`,
`book_newfundedamounttdp`).

| Step name | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|-----------|---------|----------------|-------|------|-----------------|-------|
| ItemizedDetails Create | `Create` | `book_itemizeddetails` | PostOperation | **Synchronous** | — | — |
| ItemizedDetails Update | `Update` | `book_itemizeddetails` | PostOperation | **Synchronous** | `book_requestedamount,book_validatedamount,book_fundedamount,book_prioritization` | PreImage |
| ItemizedDetails Delete | `Delete` | `book_itemizeddetails` | PostOperation | **Synchronous** | — | PreImage |

Images for this plugin:

| Step | Image type | Name | Attributes |
|------|-----------|------|------------|
| ItemizedDetails Update | Pre Image | `PreImage` | `book_prioritization` |
| ItemizedDetails Delete | Pre Image | `PreImage` | `book_prioritization` |

---

## Existing plugins (already in the assembly)

Register these only if not already present in the environment.

### `ARNGCheckbook.Plugins.Validation.RequirementFundingTDPValidator`

| Step | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|------|---------|----------------|-------|------|-----------------|-------|
| Create | `Create` | `book_requirementfunding` | PreOperation | Synchronous | `book_tdp,book_lineofaccounting,book_fundedamount` | — |
| Update | `Update` | `book_requirementfunding` | PreOperation | Synchronous | `book_tdp,book_lineofaccounting,book_fundedamount` | PreImage: `book_tdp,book_lineofaccounting,book_fundedamount` |

### `ARNGCheckbook.Plugins.Validation.PrioritizationValidator`

| Step | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|------|---------|----------------|-------|------|-----------------|-------|
| Create | `Create` | `book_prioritization` | PreOperation | Synchronous | `book_statepriority,book_state,book_newfiscalyear,book_fundcenter` | — |
| Update | `Update` | `book_prioritization` | PreOperation | Synchronous | `book_statepriority,book_state,book_newfiscalyear,book_fundcenter` | PreImage: `book_statepriority,book_state,book_newfiscalyear,book_fundcenter` |

### `ARNGCheckbook.Plugins.Validation.SpendPlanValidator`

| Step | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|------|---------|----------------|-------|------|-----------------|-------|
| Create | `Create` | `book_spendplan` | PreOperation | Synchronous | `book_total,book_october,book_november,book_december,book_january,book_february,book_march,book_april,book_may,book_june,book_july,book_august,book_september,book_availableamount` | — |
| Update | `Update` | `book_spendplan` | PreOperation | Synchronous | (same 14 columns as Create) | PreImage: same 14 columns **+** `book_spendplantotal` |

### `ARNGCheckbook.Plugins.Validation.DistributionValidator`

| Step | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|------|---------|----------------|-------|------|-----------------|-------|
| Create | `Create` | `book_distribution` ⚠️ | PreOperation | Synchronous | `book_fundingevent,book_newpgsag,book_fund,book_fundcenter,book_amount` | — |
| Update | `Update` | `book_distribution` ⚠️ | PreOperation | Synchronous | (same as Create) | PreImage: same **+** `book_manualentry` |

> ⚠️ The manifest names this entity `book_distribution` (singular), but the
> entity logical name in the solution is `book_distributions` (plural). Verify
> the correct logical name in your environment before registering these two
> steps.

### `ARNGCheckbook.Plugins.LOATDPRecalculator`

| Step | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|------|---------|----------------|-------|------|-----------------|-------|
| FundingTrack Create | `Create` | `book_fundingtrack` | PostOperation | Asynchronous | `book_resourceamount,book_lineofaccountingloa` | — |
| FundingTrack Update | `Update` | `book_fundingtrack` | PostOperation | Asynchronous | `book_resourceamount,book_lineofaccountingloa` | PreImage: `book_lineofaccountingloa` |
| FundingTrack Delete | `Delete` | `book_fundingtrack` | PreOperation | Synchronous | — | PreImage: `book_lineofaccountingloa,book_resourceamount` |
| RequirementFunding Create | `Create` | `book_requirementfunding` | PostOperation | Asynchronous | `book_tdp,book_lineofaccounting` | — |
| RequirementFunding Update | `Update` | `book_requirementfunding` | PostOperation | Asynchronous | `book_tdp,book_lineofaccounting` | PreImage: `book_lineofaccounting` |
| RequirementFunding Delete | `Delete` | `book_requirementfunding` | PreOperation | Synchronous | — | PreImage: `book_lineofaccounting,book_tdp` |

### `ARNGCheckbook.Plugins.BusinessLogic.NameBuilder`

All steps: `Create` · PreOperation · Synchronous · no filtering · no image.

| Step | Primary entity |
|------|----------------|
| Fund Create | `book_fund` |
| LOEFocusArea Create | `book_loefocusarea` |
| FundingTrack Create | `book_fundingtrack` |
| Distributions Create | `book_distribution` ⚠️ (see note above) |
| LINRequests Create | `book_linrequests` |
| Realignments Create | `book_realignments` |
| RequirementFunding Create | `book_requirementfunding` |
| Prioritization Create | `book_prioritization` |

### `ARNGCheckbook.Plugins.BusinessLogic.RecordInitializer`

All steps: `Create` · PreOperation · Synchronous · no filtering · no image.

| Step | Primary entity |
|------|----------------|
| RequirementFunding Create | `book_requirementfunding` |
| FundingLine Create | `book_fundingline` |
| Turnin Create | `book_turnin` |
| Prioritization Create | `book_prioritization` |
| SpendPlan Create | `book_spendplan` |

### `ARNGCheckbook.Plugins.BusinessLogic.LedgerEntryCreator`

| Step | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|------|---------|----------------|-------|------|-----------------|-------|
| Realignments Create | `Create` | `book_realignments` | PostOperation | Asynchronous | — | — |
| Turnin Create | `Create` | `book_turnin` | PostOperation | Asynchronous | — | — |

### `ARNGCheckbook.Plugins.Realignments.SetSameFundSagFlagPlugin`

| Step | Message | Primary entity | Stage | Mode | Filtering attrs | Image |
|------|---------|----------------|-------|------|-----------------|-------|
| Create | `Create` | `book_realignments` | PreOperation | Synchronous | — | — |
| Update | `Update` | `book_realignments` | PreOperation | Synchronous | `book_debitedloa,book_creditedloa,book_newdebitedrequirement,book_newcreditedrequirement,book_debitedprioritization,book_creditedprioritization` | PreImage: same 6 columns |

---

## After registration

- Add the assembly, every step, and every image to the **`ARNGCheckbook`**
  solution so they travel with solution export/import.
- Verify async steps via **Settings → System Jobs** after a test transaction.
- For sync plugin errors, the download-log link on the error dialog contains the
  `ITracingService` output — every plugin here traces its progress.
