# ARNG Checkbook Solution — LLM Context

This document provides context for AI agents working on the ARNG Checkbook Power Platform solution.

---

## Solution Overview

**Name:** ARNG Checkbook
**Version:** 1.11.0.40
**Publisher:** `ARNGCheckbook` — prefix `book`, option-value prefix `74649`
**Description:** Army National Guard resource management and budget execution tracking system

The ARNG Checkbook is a comprehensive financial management solution for tracking requirements, funding allocations, prioritizations, spend plans, and budget execution across state National Guard units.

> **Companion solution:** the 11 PCF code components used by this app currently
> ship in a separate solution, `ARNGCheckbookSupplyCodes` (publisher
> `ArmySupplyCodes`, prefix `arsc`), unpacked to `src/ARNGCheckbookSupplyCodes/`.
> The project goal is to merge these into this solution under the `book`
> publisher so the whole application ships as one `.zip`. See the repo-root
> `CLAUDE.md` → "Merging the PCF solution" for the open questions.

---

## Domain Model

### Core Entities (47 custom `book_*` tables)

#### Financial Structure
| Entity | Schema Name | Purpose |
|--------|-------------|---------|
| **Fund** | `book_Fund` | Fiscal year funding sources |
| **Fund Center** | `book_FundCenter` | Organizational budget units (states/territories) |
| **Funding Line (LOA)** | `book_FundingLine` | Line of Accounting - tracks TDP (Total Dollar Program) allocations |
| **Funding Track** | `book_FundingTrack` | Groups LOAs for resource management |
| **Funding Event** | `book_FundingEvent` | Funding milestones (AFP, distribution events) |
| **Funding Details** | `book_FundingDetails` | Detailed allocation breakdowns |
| **Ledger** | `book_Ledger` | Transaction records for fund movements |
| **Distributions** | `book_Distributions` | Fund distribution records to states |

#### Requirements & Prioritization
| Entity | Schema Name | Purpose |
|--------|-------------|---------|
| **Requirements** | `book_Requirements` | Master requirement records (persist year-over-year) |
| **Requirement Funding** | `book_RequirementFunding` | FY-specific funding for requirements |
| **Prioritization** | `book_Prioritization` | State priority rankings for funding |
| **Spend Plan** | `book_SpendPlan` | Monthly spend allocation by requirement |
| **Unfunded Requests (UFR)** | `book_UnfundedRequests` | Requests for additional funding |

#### Budget Execution
| Entity | Schema Name | Purpose |
|--------|-------------|---------|
| **Obligation Authority (OA)** | `book_ObligationAuthority` | Authority to obligate funds |
| **Obligation Periods** | `book_ObligationPeriods` | Obligation timeframes |
| **Realignments** | `book_Realignments` | Fund transfers between LOAs |
| **Turn-in** | `book_Turnin` | Returned unused funds |
| **Decision Event** | `book_DecisionEvent` | Budget decision tracking |

#### Reference Data
| Entity | Schema Name | Purpose |
|--------|-------------|---------|
| **State** | `book_State` | US states and territories |
| **APE** | `book_APE` | Army Program Elements |
| **MDEP** | `book_MDEP` | Management Decision Packages |
| **LIN** | `book_LIN` | Line Item Numbers (equipment) |
| **BOC** | `book_BOC` | Budget Object Codes |
| **PG** | `book_PG` | Program Groups |
| **SAG** | `book_SAG` | Sub-Activity Groups |
| **TDC** | `book_TDC` | Training and Doctrine Command categories |

---

## Key Relationships

```
State (1) ──────────────── (N) Fund Center
                               │
Fund Center (1) ───────── (N) Prioritization
                               │
Requirement (1) ───────── (N) Requirement Funding ────── (N) Prioritization
                               │
Requirement Funding (1) ─ (N) Spend Plan
                               │
Funding Line/LOA (1) ──── (N) Requirement Funding
                               │
Funding Line/LOA (1) ──── (N) Ledger (transactions)
```

---

## Approval Workflows

### Prioritization Approval Flow
```
State Input (0) → FC Review (1) → State Review (2) → State Approved (3) → NPM Review (4)
     ↑                  │                │                    │
     └──────────────────┴────────────────┴────────────────────┘
                        (Rejection loops back)
```

**Roles involved:**
- `Book - State PM` — Creates/edits prioritizations, sends to FC
- `Book - FC Reviewer` — Reviews and approves/rejects to State Review
- `Book - State Approver` — Final state approval, sends to NPM
- `Book - NPM` — National Program Manager review
- `Book - State Administrator` — Admin override capabilities

### Security Roles (14 total)
- APMO roles: `Checkbook Administrator`, `Checkbook User`
- Book roles: `Budget Executor`, `Checkbook Administrator`, `CSOR`, `FC Reviewer`, `LIN Manager`, `NPM`, `PEC`, `Read Only`, `Resource Integrator`, `State Administrator`, `State Approver`, `State PM`

---

## Current Implementation Analysis

### Web Resources (JavaScript)

#### Validation Scripts
| Script | Purpose | Pattern |
|--------|---------|---------|
| `book_requirementFundingValidation` | TDP allocation validation against LOA | Async + sync validation, debounced onChange |
| `book_spendPlanValidate` | Monthly spend vs total budget validation | Precision-tolerant comparison |
| `book_verifyUniquePri` | Unique priority per Fund Center/FY | FetchXML duplicate check |

#### Business Logic Scripts
| Script | Purpose |
|--------|---------|
| `book_checkbookButtons` | Approval workflow state transitions with role-based access |
| `book_calculateRollUp` | Roll-up calculations |
| `book_allocation` | Fund allocation logic |
| `book_ledger` | Ledger entry management |

#### Form Scripts
| Script | Purpose |
|--------|---------|
| `book_reqFundLockFields` | Field locking based on state |
| `book_reqFundOnLOAChange` | LOA change handlers |
| `book_tabVisibility` | Conditional tab visibility |
| `book_showHideFC` / `book_showHideDOMOPs` | Conditional field visibility |
| `book_populateUserBU` | Auto-populate user's business unit |

### Workflows

**Power Automate Flows (29 total):**
- Notification flows: Distribution sent, Funded amount altered, Realignment/Turn-in created
- Calculation flows: LOA TDP recalculation, Spend plan roll-up, Funding aggregation
- Generation flows: UFR generation, Distribution generation, LOA generation
- Data maintenance: MDEP maintenance, Deactivation handlers

**Classic CRM Workflows (55 total):**
- Form field show/hide logic
- Record naming conventions
- Field initialization and locking
- Approval status transitions

### Canvas Apps (7 custom pages)
- `book_arngcheckbookhomepage` — Main dashboard
- `book_pagecostestimateworksheetcew` — Cost estimation worksheet
- `book_pagedistributionmodal` — Distribution entry modal
- `book_pagefundingtrackmodal` — Funding track management
- `book_pagegenerateufrmodal` — UFR generation wizard
- `book_pagenpmspendplan` — NPM spend plan view
- `book_pagespendplanufr` — Spend plan UFR management
- `book_pagevalidatefund` — Fund validation page

---

## Plugins (Implemented)

The C# plugin project lives **outside this solution folder** at
`plugins/ARNGCheckbook.Plugins/` (targets .NET Framework 4.6.2). Earlier
versions of this doc framed plugins as future "opportunities" — they now exist.
The solution's registration metadata is under `PluginAssemblies/` and
`SdkMessageProcessingSteps/`; `plugins/ARNGCheckbook.Plugins/PluginRegistration.json`
is the source-of-truth step manifest.

```
plugins/ARNGCheckbook.Plugins/
├── PluginBase.cs                       # Shared IPlugin base class
├── Validation/
│   ├── RequirementFundingTDPValidator.cs   # PreOp sync, book_requirementfunding
│   ├── PrioritizationValidator.cs          # PreOp sync, book_prioritization
│   ├── SpendPlanValidator.cs
│   ├── DistributionValidator.cs
│   └── ValidationMessages.cs
├── BusinessLogic/
│   ├── LedgerEntryCreator.cs
│   ├── NameBuilder.cs
│   └── RecordInitializer.cs
├── Realignments/
│   └── SetSameFundSagFlagPlugin.cs
├── LOATDPRecalculator.cs
├── Helpers/TDPCalculationHelper.cs
└── Constants/EntityConstants.cs
```

### Registered steps (from `PluginRegistration.json`)

| Plugin | Message | Entity | Stage / Mode |
|--------|---------|--------|--------------|
| `RequirementFundingTDPValidator` | Create, Update | `book_requirementfunding` | PreOperation / Sync |
| `PrioritizationValidator` | Create, Update | `book_prioritization` | PreOperation / Sync |

Update steps register a `PreImage`. Filtering attributes scope execution to the
relevant fields (e.g. `book_tdp`, `book_lineofaccounting`, `book_statepriority`).

### Build & register

```bash
cd plugins/ARNGCheckbook.Plugins && dotnet build      # → bin/Debug/net462/*.dll
pwsh plugins/ARNGCheckbook.Plugins/Register-Plugins.ps1
```

---

## PCF Code Components

The 11 PCF controls used by this app currently ship in the separate
`ARNGCheckbookSupplyCodes` solution (`src/ARNGCheckbookSupplyCodes/Controls/`).
All use the `ARNGCheckbook` namespace; their solution-component names carry the
`arsc_` publisher prefix.

| Control | Notes |
|---------|-------|
| `ARNGCheckbook.SpendPlanGrid` | Used on the `book_Requirements` main form |
| `ARNGCheckbook.PrioritizationsForRequirement` | Used on the `book_Requirements` main form |
| `ARNGCheckbook.LedgerBalance` · `DecisionLedgerBalance` | Ledger balance displays |
| `ARNGCheckbook.LedgersDonut` · `DistributionsDonut` | Chart visualizations |
| `ARNGCheckbook.PendingRealignmentsQueue` · `RealignmentsFlow` | Realignment UI |
| `ARNGCheckbook.ValidateAndFundGrid` | Validate-and-fund grid |
| `ARNGCheckbook.UnfundedRequestsRank` | UFR ranking grid |
| `ARNGCheckbook.LINRequestsGrid` | LIN requests grid |

This solution's forms reference `arsc_ARNGCheckbook.SpendPlanGrid` and
`arsc_ARNGCheckbook.PrioritizationsForRequirement` directly
(`Entities/book_Requirements/FormXml/main/`). When the PCF components are merged
under the `book` publisher, every such reference must be updated in lockstep.

---

## Code Quality Observations

### Strengths
- Consistent namespace pattern (`Book.EntityName`)
- Good use of async/await in modern scripts
- Debounced validation prevents excessive API calls
- Proper form context usage (not deprecated `Xrm.Page`)

### Areas for Improvement

1. **Synchronous XMLHttpRequest** (`book_requirementFundingValidation`)
   - Lines 305-333, 339-371: Blocking XHR calls in OnSave
   - Recommendation: Move to plugin for validation

2. **Duplicate API Calls**
   - Role checks fetch user teams on every button click
   - Recommendation: Cache in session storage

3. **Error Handling**
   - Some catch blocks only log, don't surface to user
   - Recommendation: Standardize error notification pattern

4. **Magic Numbers in Approval Logic**
   - Status values (0, 1, 2, 3, 4) not documented
   - Recommendation: Use constants or enums

5. **Classic Workflows**
   - 48 XAML workflows for form field logic
   - Recommendation: Migrate to client-side business rules or modern flows

---

## Development Guidelines

### Naming Conventions
- Entities: `book_EntityName` (PascalCase after prefix)
- Attributes: `book_attributename` (lowercase)
- Web Resources: `book_descriptiveName` (camelCase after prefix)
- Workflows: `Entity - Action Description`

### Testing Considerations
- Role-based testing required for approval workflows
- Multi-state scenarios for Fund Center isolation
- Fiscal year boundary testing
- Concurrent user testing for priority uniqueness

### Environment Variables
- Connection reference: `book_sharedcommondataserviceforapps_9388f`

---

## Quick Reference

### Common FetchXML Patterns

**Aggregate Prioritization funding:**
```xml
<fetch aggregate="true">
  <entity name="book_prioritization">
    <attribute name="book_fundedamounttdp" alias="total_funded" aggregate="sum"/>
    <filter>
      <condition attribute="book_approvalstatus" operator="eq" value="4"/>
      <condition attribute="statecode" operator="eq" value="0"/>
    </filter>
    <link-entity name="book_requirementfunding" from="book_requirementfundingid" to="book_requirementfunding">
      <filter>
        <condition attribute="book_requirementfundingid" operator="eq" value="{id}"/>
      </filter>
    </link-entity>
  </entity>
</fetch>
```

**Check unique priority:**
```xml
<fetch top="1">
  <entity name="book_prioritization">
    <attribute name="book_statepriority"/>
    <filter>
      <condition attribute="book_newfiscalyear" operator="eq" value="{fy}"/>
      <condition attribute="book_state" operator="eq" value="{stateId}"/>
      <condition attribute="book_fundcenter" operator="eq" value="{fcId}"/>
      <condition attribute="book_statepriority" operator="eq" value="{priority}"/>
      <condition attribute="book_prioritizationid" operator="ne" value="{currentId}"/>
    </filter>
  </entity>
</fetch>
```

### Key Field References

| Entity | Important Fields |
|--------|-----------------|
| `book_RequirementFunding` | `book_tdp`, `book_lineofaccounting`, `book_fundedamount`, `book_validatedamount`, `book_fundingvalidated` |
| `book_Prioritization` | `book_statepriority`, `book_approvalstatus`, `book_fundedamounttdp`, `book_requirementfunding`, `book_state`, `book_fundcenter`, `book_newfiscalyear` |
| `book_SpendPlan` | `book_total`, `book_january` through `book_december` |
| `book_FundingLine` | `book_tdp` (total available TDP) |
| `book_Ledger` | `book_lineofaccounting`, `book_ledgertype`, `book_amount` |

---

## Current Focus

The plugin project and PCF components from the older "Next Steps" list have
been built. The active work item is:

1. **Consolidate to a single solution** — merge the `ARNGCheckbookSupplyCodes`
   PCF solution into ARNGCheckbook under the `book` publisher, update all
   `arsc_` control references, and produce one importable `.zip`. See repo-root
   `CLAUDE.md` → "Merging the PCF solution".

Still-open improvements from earlier analysis:
- Migrate the 55 classic XAML workflows to business rules / modern flows.
- Replace remaining synchronous XHR in `book_requirementFundingValidation` now
  that server-side validation plugins exist.
