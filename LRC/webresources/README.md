# LRC Web Resources

Staging area for JS/HTML web resources that get uploaded to the
`LongRangeCalendar` Dataverse solution. After upload + a `pp-export`, the
same content lands under `src/LongRangeCalendar/WebResources/` for version
control. Edit here, upload, then re-export.

## Duplicate Event

Two files implement the "Duplicate" button on the Event form. The button
opens a modal dialog asking for a new name and new start/end dates, then
copies the source event (including all `lrc_EventDueOut` children, with
their due dates shifted by the same offset as the new start date).

| File | Type | Web resource name (no extension in the Name) |
|------|------|----------------------------------------------|
| `lrc_duplicateEvent.js` | JavaScript (JScript) | `lrc_duplicateEvent` |
| `lrc_duplicateEventDialog.html` | Webpage (HTML) | `lrc_duplicateEventDialog` |

> **Naming gotcha:** Dataverse's web resource **Name** field is the logical
> name and is what `Xrm.Navigation.navigateTo({ webresourceName: … })`
> resolves against. Leave the file extension OFF the Name (use
> `lrc_duplicateEventDialog`, not `lrc_duplicateEventDialog.html`) — that's
> the unique name the JS expects. The Display name can be anything.

### Wiring it up in the maker portal

1. **Upload both files** as web resources into the `LongRangeCalendar`
   solution. Use the exact names in the table above (these are referenced
   from the JS and the ribbon command).
2. **Publish** the web resources.
3. Open the **`lrc_Event` main form** in the form designer, switch to the
   **Command Bar** editor (or use Power Apps "Edit command bar" on the table).
4. Add a new command on the **Main form** command bar:
   - **Label:** Duplicate
   - **Icon:** Copy (or any clear icon)
   - **Action:** Run JavaScript
     - **Library:** `lrc_duplicateEvent.js`
     - **Function name:** `LRC.Event.openDuplicateDialog`
     - **Parameters:** add one parameter of type **PrimaryControl**
   - **Visibility:** Show on condition →
     - Run formula `Self.Selected.Item.<Event>` is not blank, **or**
     - Use the classic enable rule pattern: visible only when the record
       has been saved (the JS also guards against unsaved records and
       shows a form notification if invoked too early).
5. **Save and publish** the command.
6. (Optional) On the **Event view / subgrid** command bar, add the same
   command if you want to duplicate without opening the record — the JS
   currently expects `PrimaryControl` to be a form context, so for a
   grid-level button you'd need to adapt it to take `SelectedControlSelectedItemIds`
   first. Skip this for v1.
7. From the LRC folder, run `pp-export LongRangeCalendar` to pull the
   updated solution back into `src/`.

### Behaviour notes

- The dialog defaults the new dates to **source dates + 7 days** and the
  new name to **`<source name> (Copy)`**.
- Due-out due dates are **rebased by the same number of days** the start
  date shifted (e.g. if you push the event out 30 days, every due-out
  also moves 30 days). Completed-date is intentionally NOT copied — the
  duplicate starts fresh.
- Lookups copied: `lrc_Division`, `lrc_Branch`, `lrc_Directorate`, `lrc_Staff`.
- Owner is left as the default (the user creating the duplicate).
- If duplication fails partway through (e.g. a due-out create errors after
  the event was created), the new event remains — the user sees the error
  in the dialog. This is intentional: rolling back without a plugin/Custom
  API would require deleting the partial record, which is more dangerous
  than leaving a half-populated duplicate for the user to inspect.

## Recurring Event

Two files implement the "Make Recurring" button on the Event form. The
button opens a modal asking for a cadence (Weekly / Every 2 weeks /
Monthly / Quarterly / Yearly / Every N days) and an end condition (after
N more occurrences, or on/before a date). On OK it generates the
specified number of new `lrc_Event` rows, all stamped with a shared
`lrc_SeriesId` and marked `lrc_IsRecurring = true`. Each occurrence copies
the same field set as Duplicate, with start/end dates shifted by the
cadence and (optionally) due-outs copied with rebased due dates.

| File | Type | Web resource name (no extension in the Name) |
|------|------|----------------------------------------------|
| `lrc_recurringEvent.js` | JavaScript (JScript) | `lrc_recurringEvent` |
| `lrc_recurringEventDialog.html` | Webpage (HTML) | `lrc_recurringEventDialog` |

### Schema prerequisites (add in the maker portal first)

Recurring writes to four columns on `lrc_Event` that don't exist yet.
Add them before publishing the button:

| Column | Data type | Notes |
|--------|-----------|-------|
| `lrc_SeriesId` | Single line of text (max 36) | Shared Guid string identifying all occurrences of a series. Blank = standalone event. |
| `lrc_IsRecurring` | Yes/No | Stamped `Yes` on every occurrence (including the source). The calendar PCF can use this for a recurring indicator. |
| `lrc_RecurrencePattern` | Choice | Cadence label. **Reset option values to be sequential starting at 1** when creating the choice. See table below. |
| `lrc_RecurrenceIntervalDays` | Whole Number | Populated only when pattern = Custom. Leave blank for the fixed cadences. |

`lrc_RecurrencePattern` choice options — the integer values matter
because the JS writes by integer, not by label:

| Label | Value |
|-------|-------|
| Weekly | 1 |
| Biweekly | 2 |
| Monthly | 3 |
| Quarterly | 4 |
| Yearly | 5 |
| Custom | 6 |

If you ever reorder the choice or add a new option in the middle,
update the `CADENCE_OPTIONSET` map at the top of
`lrc_recurringEventDialog.html` to match — that map is the single source
of truth for the integer values the JS writes.

Add them to the main form (the JS doesn't need them on the form, but the
junior maintainer will want to see them when inspecting a record).

### Wiring it up in the maker portal

1. Add the three columns above to `lrc_Event`, save, publish.
2. **Upload both files** as web resources into the `LongRangeCalendar`
   solution under the exact names in the table above.
3. **Publish** the web resources.
4. Open the **`lrc_Event` main form** Command Bar editor.
5. Add a new command:
   - **Label:** Make Recurring
   - **Icon:** Repeat / Refresh (or any clear icon)
   - **Action:** Run JavaScript
     - **Library:** `lrc_recurringEvent.js`
     - **Function name:** `LRC.Event.openRecurringDialog`
     - **Parameters:** add one parameter of type **PrimaryControl**
   - **Visibility:** Show only when the record is saved (the JS guards
     against unsaved records too).
6. **Save and publish** the command.
7. From the LRC folder, run `pp-export LongRangeCalendar` to pull the
   updated solution back into `src/`.

### Behaviour notes

- The source event is itself stamped with the new `lrc_SeriesId` and
  `lrc_IsRecurring = true` as part of generation, so the source is
  "occurrence 1" of its own series.
- If the source is already part of a series (`lrc_SeriesId` is set), new
  occurrences **join the existing series** — they reuse the same id
  rather than starting a new one. The subtitle in the dialog says so.
- **Date math:** monthly/quarterly/yearly cadences use **day-of-month
  clamping** — if the source falls on the 31st, occurrences land on the
  last day of months that don't have a 31st (Feb 28/29, Apr 30, etc.).
  Weekly / biweekly / N-days use simple day arithmetic.
- A **safety cap of 60 occurrences** prevents runaway generation. Adjust
  `MAX_OCCURRENCES` at the top of the script if a larger series is ever
  legitimately needed.
- Occurrences are created **sequentially**, one at a time. This is slow
  for large series but keeps the failure mode simple: if generation
  stops partway, you know exactly how many were created and they all
  share the same series id, so cleanup is a single FetchXML/Advanced
  Find query away.
- Like Duplicate, this is intentionally fire-and-forget — no rollback if
  a mid-series create fails. The status line tells the user how many
  succeeded; they can fix the issue and re-run "Make Recurring" with a
  shorter end window to fill in the gap, or delete the partial series.

### Editing a series later

There is intentionally **no "edit the whole series" affordance**. Each
occurrence is a fully independent `lrc_Event` row — edit one, and only
that one changes. The shared `lrc_SeriesId` lets the calendar PCF
visually mark them as related and lets a user open Advanced Find on
"events where SeriesId = X" for bulk operations, but there is no plugin
or flow keeping them in sync. This is the intentional trade-off for a
plugin-free design: simpler maintenance, at the cost of Outlook-style
"edit all future occurrences" behaviour.
