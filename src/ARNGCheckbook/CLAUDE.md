# ARNG Checkbook Solution — LLM Context

This document provides context for AI agents working on the ARNG Checkbook Power Platform solution.

---

## Solution Overview

**Name:** ARNG Checkbook
**Version:** 1.11.0.26
**Publisher Prefix:** `book`
**Description:** Army National Guard resource management and budget execution tracking system

The ARNG Checkbook is a comprehensive financial management solution for tracking requirements, funding allocations, prioritizations, spend plans, and budget execution across state National Guard units.

---

## Domain Model

### Core Entities (45 total)

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

**Power Automate Flows (31 total):**
- Notification flows: Distribution sent, Funded amount altered, Realignment/Turn-in created
- Calculation flows: LOA TDP recalculation, Spend plan roll-up, Funding aggregation
- Generation flows: UFR generation, Distribution generation, LOA generation
- Data maintenance: MDEP maintenance, Deactivation handlers

**Classic CRM Workflows (48 total):**
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

## Plugin Integration Opportunities

### High Priority — Server-Side Validation

1. **TDP Allocation Validation** (`book_RequirementFunding`)
   - Current: Client-side validation in `book_requirementFundingValidation`
   - Issue: Synchronous XHR calls, bypassable validation
   - Plugin: Pre-operation on Create/Update to validate TDP doesn't exceed LOA
   - Trigger: `book_tdp` or `book_lineofaccounting` changes

2. **Unique Priority Enforcement** (`book_Prioritization`)
   - Current: Client-side async check in `book_verifyUniquePri`
   - Issue: Race conditions, bypassable
   - Plugin: Pre-operation on Create/Update to enforce unique `book_statepriority` per FY/State/FundCenter

3. **Spend Plan Total Validation** (`book_SpendPlan`)
   - Current: Client-side in `book_spendPlanValidate`
   - Issue: Monthly allocations must not exceed total budget
   - Plugin: Pre-operation validation summing month fields vs `book_total`

4. **Approval Status Transitions** (`book_Prioritization`)
   - Current: Client-side role checks in `book_checkbookButtons`
   - Issue: Status can be modified via API bypassing role checks
   - Plugin: Pre-operation to enforce valid state transitions based on user roles

### Medium Priority — Business Logic

5. **Ledger Entry Creation** (`book_Realignments`, `book_Turnin`)
   - Current: Power Automate flows
   - Benefit: Transactional integrity, immediate ledger updates
   - Plugin: Post-operation to create ledger entries atomically

6. **Roll-up Calculations** (`book_RequirementFunding`, `book_Prioritization`)
   - Current: Power Automate flows triggered on change
   - Issue: Eventual consistency, potential timing issues
   - Plugin: Post-operation async to aggregate funding amounts

7. **LOA TDP Remaining Calculation** (`book_FundingLine`)
   - Current: Flow-based recalculation
   - Plugin: Post-operation on related RequirementFunding changes

### Plugin Architecture Recommendation

```csharp
// Suggested plugin structure
Plugins/
├── ARNGCheckbook.Plugins/
│   ├── Validation/
│   │   ├── RequirementFundingTDPValidator.cs
│   │   ├── PrioritizationUniqueValidator.cs
│   │   ├── SpendPlanTotalValidator.cs
│   │   └── ApprovalStatusTransitionValidator.cs
│   ├── BusinessLogic/
│   │   ├── LedgerEntryCreator.cs
│   │   ├── FundingRollupCalculator.cs
│   │   └── LOATDPRecalculator.cs
│   └── Shared/
│       ├── ValidationHelper.cs
│       └── EntityExtensions.cs
```

---

## PCF Component Opportunities

### High Impact Components

1. **Prioritization Grid with Drag-Drop Reordering**
   - Replace standard subgrid for prioritization records
   - Drag-drop to set `book_statepriority` values
   - Visual indicators for approval status
   - Automatic renumbering on reorder

2. **Spend Plan Monthly Calendar**
   - 12-month visual editor for spend allocation
   - Real-time total validation with progress bar
   - Color coding: under/at/over budget
   - Replace 12 separate currency fields with single visual control

3. **Funding Allocation Visualization**
   - Sankey diagram: Fund → Fund Center → Requirements
   - Interactive drill-down
   - Show allocated vs available at each level

4. **TDP Allocation Meter**
   - Gauge/meter showing LOA utilization
   - Real-time update as user enters TDP
   - Threshold warnings (80%, 95%, 100%)
   - Replace form notification with visual indicator

5. **Approval Status Timeline**
   - Horizontal timeline showing approval stages
   - Current position highlighted
   - Click to view/take action
   - Shows who approved and when

### Medium Impact Components

6. **State Fund Center Tree View**
   - Hierarchical navigation: State → Fund Centers → Requirements
   - Expandable/collapsible nodes
   - Aggregate totals at each level

7. **Ledger Transaction Log**
   - Timeline view of ledger entries for an LOA
   - Running balance display
   - Filter by transaction type

8. **UFR Priority Matrix**
   - 2D grid: Priority vs Funding Status
   - Quick bulk status updates
   - Export capability

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

## Next Steps (Recommended Order)

1. **Set up plugin project** — Create .NET project with SDK references
2. **Implement TDP validation plugin** — Highest impact, removes sync XHR
3. **Implement priority uniqueness plugin** — Prevents data integrity issues
4. **Create Spend Plan calendar PCF** — Highest UX improvement
5. **Create TDP allocation meter PCF** — Visual feedback for validation
6. **Migrate classic workflows** — Reduce technical debt
