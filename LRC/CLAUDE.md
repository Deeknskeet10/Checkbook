# Long Range Calendar (LRC) — Power Platform Development Context

This file gives you the context needed to work on the **Long Range Calendar**
(LRC), a Dataverse/Power Platform application for the ARNG **G-3/5/7** staff.
It covers what the app is for, the current boilerplate solution, the documented
requirements, the gap between the two, and the tooling in this folder.

> **Repo layout note:** This `LRC/` folder is one of two self-contained Power
> Platform projects under the parent directory; the sibling `../Checkbook/`
> (ARNG Checkbook) is a completely separate application with its own publisher,
> solutions, and tooling. They share only the parent git repository. This `LRC/`
> folder has its own duplicated `devenv.nix` / `.config` / `.pac`. Everything
> below is relative to this folder.

---

## What this project is

The Long Range Calendar replaces an Excel-based long-range calendar used by the
G-3/5/7 front office to track conferences, exercises, meetings, training events,
significant due-outs, and external public events across the directorate's
divisions. It is a **long-range** planning calendar (weeks-to-months horizon),
**not** a day/hour scheduler — events carry **dates only, no times**.

The end goal is a **custom PCF calendar component** that reproduces the Excel
calendar's "swim lane" layout with drag/drop, color coding, due-out tracking,
filtering, and long-range navigation, backed by the Dataverse tables in this
solution.

**Primary stakeholder:** the G-3/7 front office (referred to as "David" in the
requirements). He runs a weekly scrub with the G-3/7 XO to decide which LRC
events get pulled into the XO's Outlook calendar.

---

## Current solution state — boilerplate

The solution is an **early boilerplate** (`LongRangeCalendar` v1.0.0.1). It
defines the data model skeleton and a model-driven app, but **none of the
calendar-specific presentation columns or the PCF control exist yet**.

| Solution | Unpacked to | Publisher | Prefix | Option-value prefix | Version |
|----------|-------------|-----------|--------|---------------------|---------|
| **LongRangeCalendar** | `src/LongRangeCalendar/` | `longRangeCalendar` | `lrc` | `85645` | 1.0.0.1 |

### Tables

| Table | Logical name | Role |
|-------|--------------|------|
| **Event** | `lrc_Event` | A calendar event (the core table). |
| **Event Due-Out** | `lrc_EventDueOut` | An action due before an event (N per event). |
| **Organization** | `geip_Organization` | Pre-existing **org hierarchy** table from the `geip` publisher — divisions/branches/staff. Lookups on `lrc_Event` point here. |

> `geip_Organization` is **not** owned by this solution's publisher (`lrc`); it
> uses the `geip` prefix and was brought in as a dependency. Treat it as a shared
> org-structure reference table, not something to redesign here.

### `lrc_Event` columns (boilerplate)

- `lrc_Name` — event name (primary column)
- `lrc_EventType` — option set: **Conference, Exercise, External Public Event,
  Meeting, Other, Significant Due-Out (O-6/O-7), Training Event** (matches the 7
  requested types)
- `lrc_StartDate`, `lrc_EndDate` — date range (dates only)
- `lrc_Division`, `lrc_Branch`, `lrc_Directorate`, `lrc_Staff` — lookups to
  `geip_Organization` (the swim-lane / owning-org assignment)
- `lrc_DetailedDescription`, `lrc_Location`
- `lrc_POCName`, `lrc_POCEmail`, `lrc_POCPhone`

### `lrc_EventDueOut` columns (boilerplate)

- `lrc_Name` (primary), `lrc_Task`, `lrc_TaskDescription`
- `lrc_DueDate`, `lrc_CompletedDate`
- `lrc_Event` — lookup to `lrc_Event` (1:N: an event has many due-outs;
  cascade delete = RemoveLink)

### Other components

- **App / sitemap:** `lrc_LongRangeCalendar` (model-driven app + sitemap)
- **Workflow:** "Require Parent Org" (classic XAML) — enforces an org parent
- **Relationships:** `lrc_Event`↔`lrc_EventDueOut`, and `lrc_Event`/`geip_Organization`
  lookup relationships (Owner/Team/BusinessUnit/SystemUser are standard)

---

## Requirements (from the two source docs in this folder)

Source documents (kept here for reference): `Events_and_PCF_Requirements.docx`
and `G37 Calendar Requirements - Answers v1 (2).docx`.

### Swim lanes

- **Five lanes:** 1) External & G-3/7 Front Office, 2) Operations Division,
  3) Training Division, 4) Resource Integration Division, 5) Force Generation
  Division.
- An event lives in **one lane** for now (later: a rule could also surface it in
  the External & G-3/7 lane — design so this is addable, don't build it yet).
- Lanes are an **option for leadership "snapshot" viewing**, not a hard
  requirement — a more traditional calendar layout is acceptable if it serves
  the same purpose. Users can also filter by organization for a less crowded view.

### Time layout

- **Rolling 30-day or 2-week window** (no full-quarter view — too small to read).
  Goal: fit as many lanes as possible on screen without shrinking past legibility.
- Quick navigation: next/previous period, jump/search by date.
- **Freeze the date header row** so dates stay visible while scrolling (R-004).
- **Clear weekly delineation lines** (e.g. "Week 29 DEC – 04 JAN") (R-003).

### Event types & color coding

- Color by **event type**, standardized across all lanes (all conferences one
  color, all exercises another, etc.) — not per-lane colors.
- Star-flagged events are special: a star flag should be able to **trigger a
  prompt** to the author about prep sessions, advance due-outs, or workflow
  requirements (sometimes, not always).

### Event detail / data entry philosophy

- **Less is more on the visible calendar:** ideally just the event name and the
  dates with **no year** (e.g. "G-3 Orientation Conference 14 – 16 Nov").
- Don't require lots of behind-the-scenes data. Provide an **optional** detailed
  info panel reachable via **double-click or hover**, plus a **visible indicator**
  on events that have extra info ("Has Additional Info").
- **Dates only — no times** on the visible LRC. Times, if anyone wants them, go
  in the optional detail panel.
- **Recurring events:** supported; each occurrence appears on the calendar, with
  a visible indicator that it is recurring.
- A **comments/notes section for leadership** (R-001).

### Due-outs (R-002)

- Show when something is due **in advance** of an event. Do **not** restrict to
  fixed 30/60/90/120-day offsets — let the user pick an arbitrary advance date /
  range; the calendar auto-populates the selected advance day(s).
- Support **multiple due-outs per event** (already modeled via `lrc_EventDueOut`).

### Permissions

- **~10 editors total:** a primary + alternate per division plus the G-3/7 main
  office. Each division edits only its own lane.
- **Open read access** to anyone in ARNG G-3/5/7. Leadership is read-only as a
  rule (rare exceptions).
- **No approval process** for any event type — divisions enter freely; curation
  happens via the weekly XO scrub.

### Filtering / search

- Filter by **division, event type, and keyword**.
- **Show/hide swim lanes** to streamline the view.
- **Event search** feature.

### Notifications

- Optional, author-chosen **leader notifications**: when entering an event the
  author can name leader(s) to be notified, and choose a cadence (e.g. one month
  / one week / one day out, and/or on due-out dates).
- Star/senior-leader events should be able to trigger alerts.
- Open question from the stakeholder: linking events to **Outlook/Teams calendars**
  or sending automated email heads-up — desirable, mechanism TBD.

### Reporting / export

- **Print and export** monthly views for leadership briefings.
- **Summary reports** (e.g. number of events per division/month) — nice to have.
- Future: offer the LRC as a **template to higher HQ** (likely 3–4 lanes), with
  business rules for which events get pushed up.

### Timeline (as stated in the 30 DEC 2025 doc)

No hard deadline, but the stakeholder wanted a **30-minute demo of a ~75%-ready
product by mid-January** for feedback. (Recorded as captured from the doc —
verify current expectations with the stakeholder rather than assuming this date
still drives the schedule.)

---

## Gap analysis — boilerplate vs. requirements

The data model needs new columns/components before the calendar can meet the
requirements. The `lrc_EventType` option set is already complete; most gaps are
presentation/automation fields **not yet present** on `lrc_Event`:

- **Swim-lane assignment** as a first-class, constrained value (the 5 named lanes)
  — currently only org lookups exist; decide whether lane derives from
  `lrc_Division` or is its own option set.
- **Recurrence:** recurring indicator + recurrence pattern.
- **Display:** color (likely derived from type), shape/icon, display
  abbreviation, "show on calendar view", "span across days".
- **Star event** flag + the prep-session / workflow-checklist prompt fields.
- **Additional-info indicator** ("Has Additional Info") + the optional detail
  content surfaced on hover/double-click.
- **Notifications:** "leaders to notify", "notify leaders" flag, notification
  cadence.
- **Due-out advance offset:** a flexible advance-date / offset field on
  `lrc_EventDueOut` so the calendar can auto-place advance markers (R-002).
- **Leadership comments/notes** section (R-001).

> Form/entity metadata is authored in the **maker portal**, then exported back
> into `src/LongRangeCalendar/` — it cannot be hand-authored reliably from the
> repo. Use this list as the backlog, confirm scope with the stakeholder, then
> build in the environment.

---

## The PCF calendar component (the deliverable)

A custom **PCF code component** is the core deliverable — it replicates the Excel
long-range calendar. It is **implemented** at `pcf/Calendar/` (namespace
`LongRangeCalendar`, constructor `Calendar`, virtual React 16 dataset control).

The manifest (`pcf/Calendar/Calendar/ControlManifest.Input.xml`) binds a
`data-set name="events"` to a view of `lrc_Event` with property-sets `eventName`
(`lrc_Name`), `eventType` (`lrc_EventType`), `startDate`/`endDate`, `division`
(`lrc_Division`), `leadershipRoleRank` (`lrc_leadershiprolerank`), plus detail
columns `description`, `location`, `pocName`, `pocEmail`, `pocPhone`; and a
`defaultView` input enum (2-week / 30-day).

### Source layout (`pcf/Calendar/Calendar/`)

| File | Responsibility |
|------|----------------|
| `index.ts`        | `ReactControl` entry; sets dataset page size, passes dataset + `webAPI` + width + `refresh` to the app. |
| `CalendarApp.tsx` | Orchestrator: state (view, anchor date, filters, hidden lanes, selection), filtering, counts, drag-drop write-back. |
| `CalendarGrid.tsx`| Day-axis grid: frozen header, sticky lane labels, weekly delineation, sub-row event packing, drop targets, due-out markers. |
| `Toolbar.tsx`     | Nav (prev/next/today/jump), 2-week/30-day toggle, type filter, keyword search, lane show/hide, export, print, summary/legend. |
| `DetailPanel.tsx` | Side panel on click/double-click — event fields + its due-outs. |
| `data.ts`         | Read dataset rows, fetch `lrc_EventDueOut` via WebAPI, `updateRecord` reschedule, CSV export. |
| `dateUtils.ts` · `types.ts` | Date math (dates-only) and the swim-lane / event-type / color constants. |
| `insignia.tsx` · `insigniaData.ts` | Leadership role/rank choice map (values 0–16) + rank-insignia badge; bitmaps from the Role - Rank Requirement doc as data URIs. |

### Implemented

- Rolling **2-week / 30-day** views, frozen date header, sticky lane labels.
- **Five swim lanes** (+ an Unassigned lane when needed), resolved from the
  `lrc_Division` lookup name against the canonical lane names.
- **Color coding by event type**, standardized across lanes (legend in toolbar).
- **Drag-and-drop** to reschedule: moves dates (preserving duration) and, on a
  cross-lane drop, re-binds `lrc_Division` when that lane's org id is known —
  via `webAPI.updateRecord` then dataset `refresh()`.
- **Filters** (type, keyword), **show/hide lanes**, **navigation/jump-to-date**.
- **Detail panel** on click/double-click + an info indicator on tiles that have
  description/location/due-outs.
- **Due-out markers** on due dates (fetched from `lrc_EventDueOut`) + listed in
  the detail panel. Dates only, no year, on tiles ("14 - 16 Nov").
- **Print** (print CSS) and **CSV export**; summary counts per lane/type.
- **Leadership role/rank insignia** (`lrc_leadershiprolerank` choice, values
  0–16 per `Role - Rank Requirement Function.docx`): a white badge on the tile
  and a row in the detail panel. Roles 0–7 = Action Officer → CNGB, ranks
  8–15 = O3 → O10, 16 = Other. Insignia: O3 bars / O4–O5 oak leaves / O6 eagle
  (bitmaps from the doc), 1–4 SVG stars for O7–O10 and the general-officer
  roles (G-3/5/7 = 1★, DDARNG = 2★, DARNG = 3★, CNGB = 4★, ARNG G3 = eagle);
  Action Officer, Branch Chief, Division Chief, and Other show no insignia.

### Still to build (need schema columns first — see gap analysis)

- **Star-event** flag + the prompt/workflow trigger.
- **Recurring-event** indicator/pattern.
- **Flexible due-out advance offsets** (auto-place advance markers, R-002).
- **Leader notifications** (author-chosen recipients + cadence) — backend
  (flow/plugin), not the control.

Keep the control **thin/presentational** — push roll-ups, validation, and
automation (notifications, due-out generation) into Dataverse (plugins / flows /
business rules) rather than duplicating business logic in the component.

### Build & package

```bash
# Build the control standalone
cd pcf/Calendar && npm install && npm run build

# Build the importable delivery solution (.zip)
cd solution/LongRangeCalendarControls
dotnet build -c Release
# → bin/Release/LongRangeCalendarControls.zip   (unmanaged, publisher: lrc)
```

`LongRangeCalendarControls` is an **unmanaged delivery solution** (publisher
`longRangeCalendar`, prefix `lrc`) that bundles the Calendar PCF control. Import
it into the environment, place the control on the `lrc_Event` view/subgrid (or a
custom page), then export the enriched `LongRangeCalendar` solution back into
`src/`. Add future controls with `pac solution add-reference`.

---

## Tooling — pac CLI (self-contained in this folder)

Identical setup to the Checkbook project, scoped to this folder. `pac` is **not
on `PATH`**; it is pinned as a local dotnet tool in `.config/dotnet-tools.json`
(v2.4.1). The `devenv.nix` here provides the same `pp-*` helper scripts.

```bash
dotnet tool restore                  # one-time, after a fresh clone
dotnet tool run pac -- <args>        # invoke pac
```

| Script | Does |
|--------|------|
| `pp-export <SolutionName>`  | export from the connected env + unpack into `src/` |
| `pp-unpack <ZipFile> [Out]` | unpack an existing solution zip |
| `pp-pack <SolutionName>`    | pack `src/<Solution>` into `solutions/<Solution>_packed.zip` |
| `pp-import <SolutionName>`  | import a packed zip into the connected env |
| `pp-diff <SolutionName>`    | diff unpacked source against git HEAD |

pac auth tokens are isolated to this folder (`PAC_CONFIG_PATH=./.pac`). Run
`pac auth create` before exporting/importing — `.pac` starts empty.

```bash
# Re-unpack the boilerplate (overwriting existing source)
dotnet tool run pac -- solution unpack \
  --zipfile solutions/LongRangeCalendar_1_0_0_1.zip \
  --folder src/LongRangeCalendar --allowDelete true

# Check a solution version without unpacking
unzip -p solutions/LongRangeCalendar_1_0_0_1.zip solution.xml | grep -oP '<Version>[^<]+'
```

---

## Directory Layout

```
LRC/
├── CLAUDE.md                       # This file
├── Events_and_PCF_Requirements.docx          # Requirements source doc
├── G37 Calendar Requirements - Answers v1 (2).docx  # Stakeholder Q&A source doc
├── devenv.nix                      # Self-contained dev environment + pp-* scripts
├── devenv.lock · devenv.yaml · .envrc
├── .config/dotnet-tools.json       # pac CLI pinned as a local dotnet tool
├── solutions/                      # Raw exported .zip files
│   └── LongRangeCalendar_1_0_0_1.zip
├── pcf/                            # Buildable PCF projects (npm + pac pcf)
│   └── Calendar/                    # The long-range calendar control
│       ├── Calendar.pcfproj
│       ├── package.json · tsconfig.json · pcfconfig.json
│       └── Calendar/
│           ├── ControlManifest.Input.xml   # dataset bound to lrc_Event
│           ├── index.ts                     # ReactControl entry point
│           ├── CalendarApp.tsx · CalendarGrid.tsx · Toolbar.tsx · DetailPanel.tsx
│           ├── data.ts · dateUtils.ts · types.ts
│           └── css/Calendar.css
├── solution/                       # pac solution projects → importable .zip
│   └── LongRangeCalendarControls/   # Delivery solution (publisher lrc) bundling the PCF
│       ├── LongRangeCalendarControls.cdsproj
│       └── src/Other/Solution.xml
└── src/                            # Unpacked solution source — this is what you edit
    └── LongRangeCalendar/
        ├── Other/Solution.xml       # Publisher: longRangeCalendar, prefix lrc
        ├── Other/Relationships/
        ├── Entities/
        │   ├── lrc_Event/
        │   ├── lrc_EventDueOut/
        │   └── geip_Organization/
        ├── AppModules/lrc_LongRangeCalendar/
        ├── AppModuleSiteMaps/lrc_LongRangeCalendar/
        └── Workflows/               # "Require Parent Org" (classic XAML)
```

Build the control standalone with `npm install` then `npm run build` (or
`npm start` for the test harness) from `pcf/Calendar/`. A `solution/` delivery
project (to package the control into an importable `.zip` under the `lrc`
publisher) still needs to be added — mirror the Checkbook `ARNGCheckbookExtensions`
structure.

---

## Working Conventions

- Edit files under `src/` — never edit the `.zip`s in `solutions/`.
- `lrc` is the canonical publisher prefix for this application; `geip` is a
  borrowed org-hierarchy dependency — don't redesign it here.
- Treat the **Dataverse environment as authoritative** for form/entity metadata:
  author in the maker portal, export back into `src/`.
- After changing source, `pp-pack` to produce an importable zip; don't commit
  generated `_packed.zip` artifacts unless asked.
- **No apostrophes in solution XML** descriptions/labels — Dataverse import
  rejects them (`noAPosStringType`); rephrase or use U+2019.
- Visible-calendar rule of thumb: **less is more** — name + dates (no year),
  details behind an optional panel.
