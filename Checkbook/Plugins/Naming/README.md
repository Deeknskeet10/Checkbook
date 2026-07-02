# Prioritization Naming

`PrioritizationNameSetter` stamps `book_name` at PreOperation on `book_prioritization` Create/Update so the `book_uniqueprioritizationname` alt key catches duplicates in-transaction.

## Naming convention

| Fiscal Year | Format |
|-------------|--------|
| FY25 / FY26 | `FY{FY}-{State}-{FundCenter}-{StatePriority}-{RequirementFunding}` |
| FY27+       | `FY{FY}-{State}-{FundCenter}-{Requirement}` |

`{State}` is included in both branches to disambiguate centrally managed Prios (`book_requirement.book_national = 1`). Under central management the same FC is cascaded to every state's Prio via `RequirementFundCenterCascade`, so without State two states with the same FC-priority would collide on the alt key.

## Registration

- Message: Create, Update
- Stage: PreOperation, Sync
- Filtering attributes: `book_state, book_requirementfunding, book_requirement, book_statepriority, book_fundcenter, book_newfiscalyear`
- PreImage `PreImage`: same attributes

## Bulk-renaming existing records

After a naming-convention change, existing rows keep their old names until something touches a filter attribute. A stub PATCH that includes any filter attribute — even set to its current value — will re-fire the plugin because the filter check is on presence in the Update Target, not on value change.

### Recommended: Power Automate flow

Manually-triggered Instant flow:

1. **List rows** (`book_prioritization`)
   - Select columns: `book_prioritizationid, _book_state_value`
   - Filter rows: `statecode eq 0`
   - Pagination: on, threshold `100000`

2. **Apply to each** over `value`
   - Concurrency control: on, degree of parallelism `50`
   - **Update a row** (`book_prioritization`)
     - Row ID: `item()?['book_prioritizationid']`
     - State (Lookup) bind: `book_states(@{item()?['_book_state_value']})`

### Notes

- Test with a `top 1` filter first, then `top 100` at concurrency 5, then the full run.
- ~20k rows at concurrency 50 finishes in 30–60 minutes; Dataverse throttling (6000 req / 5 min per user) will slow it down but flow retries 429s automatically.
- Split by FY (`book_newfiscalyear eq 2026`, then 2025, ...) into separate runs if the flow's 2-hour action timeout bites.
- Genuine data-level duplicates surface as `DuplicateRecord` on Update. Apply-to-each will keep going; review failed items in the run history.
- Downstream flows that trigger on `book_prioritization` update will fire once per row — check `Workflows/` before running.
