# Prioritization Funding Invariant — Setup & Deploy

Enforces **`funded ⟹ NPM Review`**: a Prioritization may only *hold* funding
(`book_newfundedamounttdp`, or FY27 `book_prioritizationfunding` junction rows)
while its `book_approvalstatus` is **NPM Review (4)**. Below that stage the RF
funded roll-up (FinalApproved-only) ignores it, so any funding it held would
surface as a phantom `TDP − Funded` gap on the parent Requirement Funding.

Two ways a Prio used to end up funded-but-below-NPM-Review, both now closed:
1. Funding a Prio (grid / realignment / turn-in / swap) before it reached NPM Review.
2. A State pulling a funded Prio **back** out of NPM Review to edit it.

Backend / frontend pieces of this feature:

- `Plugins/Validation/PrioritizationFundingApprovalGuard.cs` — Prio-level guard (block + FY26 strip)
- `Plugins/Validation/PrioritizationPullbackFundingCleanup.cs` — FY27 junction clearing on pull-back
- `Plugins/Validation/PrioritizationFundingGuard.cs` — FY27 junction-level funding gate (check 5)
- `Plugins/Validation/ValidationMessages.cs` — `FundingRequiresNPMReview` message
- `pcf/PrioritizationFundingGrid` (v0.2.9) — non-NPM Prios read-only; LIN/Country bubbles
- `webresources/book_checkbookButtons` — pull-back funding-removal confirm dialog

This doc lists the maker-portal / PRT steps that are **not** doable from the
repo. Plugin build: `cd Plugins && dotnet build`. Delivery zip:
`dist/ARNGCheckbookExtensions.zip`.

---

## 1. Register the plugin steps (Plugin Registration Tool)

Register against the existing `Checkbook_Plugins` assembly. Full detail and the
per-entity ordering live in [`../Plugins/PLUGIN-REGISTRATION.md`](../Plugins/PLUGIN-REGISTRATION.md).

### `PrioritizationFundingApprovalGuard`
| Message | Entity | Stage | Mode | Rank | Filter | Pre-Image |
|---|---|---|---|---|---|---|
| Create | `book_prioritization` | Pre-Operation | Sync | 1 | *(none)* | — |
| Update | `book_prioritization` | Pre-Operation | Sync | **15** | `book_newfundedamounttdp, book_approvalstatus` | `PreImage`: `book_newfundedamounttdp, book_approvalstatus` |

> Create step must run **before** `PrioritizationFundingValidator` so the
> "requires NPM Review" message wins over a TDP-cap error. Update rank 15 sits
> after the reduction lock (10) and before the funding validator.

### `PrioritizationPullbackFundingCleanup`
| Message | Entity | Stage | Mode | Filter | Pre-Image |
|---|---|---|---|---|---|
| Update | `book_prioritization` | **Post-Operation** | Sync | `book_approvalstatus` | `PreImage`: `book_approvalstatus` |

### `PrioritizationFundingGuard` (already registered — no step change)
Logic-only update (new NPM-Review gate on junction funded increases). Just
redeploy the assembly; its existing Create/Update steps on
`book_prioritizationfunding` are unchanged.

After registering, tick the boxes in the verification checklist at the bottom of
`PLUGIN-REGISTRATION.md`.

---

## 2. Deploy the PCF (PrioritizationFundingGrid v0.2.9)

1. Import `dist/ARNGCheckbookExtensions.zip` (unmanaged, publisher `book`).
2. **Update the component inside the custom-page studio.** A PCF used on a
   canvas / custom page is **not** refreshed by import + publish alone — open the
   page in the studio, and let it pick up the new component version, then
   republish the page. (Same gotcha as every prior PCF bump.)

Behavior after deploy: Prios not in NPM Review show read-only funding cells;
itemized detail rows show LIN (blue bubble) + Country (green bubble) when set.

---

## 3. Publish the web resource

Upload / publish `webresources/book_checkbookButtons` (the `book_checkbookButtons`
web resource). New behavior: the **Return to State PM** command warns
("Remove funding?") before pulling a funded NPM-Review Prio back to State Input.
The server plugins do the actual strip, so the dialog is a heads-up only.

---

## 4. One-time data cleanup (existing bad records)

Records that were already funded-but-below-NPM-Review pre-date the guards and
will **not** self-heal. Find them:

```xml
<fetch>
  <entity name="book_prioritization">
    <attribute name="book_name"/>
    <attribute name="book_approvalstatus"/>
    <attribute name="book_newfundedamounttdp"/>
    <attribute name="book_requirementfunding"/>
    <attribute name="book_newfiscalyear"/>
    <filter type="and">
      <condition attribute="statecode" operator="eq" value="0"/>
      <condition attribute="book_approvalstatus" operator="ne" value="4"/>
      <condition attribute="book_newfundedamounttdp" operator="gt" value="0"/>
    </filter>
  </entity>
</fetch>
```

Per record: **FY26** → set `book_newfundedamounttdp = 0`; **FY27** → deactivate
its active `book_prioritizationfunding` rows. Either triggers the roll-up to
return the money to the parent RF. Then force a roll-up recompute on any RF where
`book_fundedamount` no longer equals the sum of its FinalApproved children (e.g.
by re-saving one FinalApproved child Prio), to clear pre-existing phantom gaps.

---

## 5. Smoke test

1. Fund a Prio that is **not** in NPM Review → blocked with the NPM-Review message.
2. Fund a Prio **in** NPM Review → allowed.
3. Pull back a funded NPM-Review Prio (FY26 **and** FY27) via **Return to State
   PM** → dialog warns; on confirm, its funding zeroes and the parent RF's Funded
   drops to match TDP (no phantom gap).
4. Grid: a non-NPM Prio shows read-only cells; itemized rows show LIN/Country bubbles.
