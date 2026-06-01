export type ViewMode = "twoWeek" | "thirtyDay" | "sixtyDay" | "ninetyDay" | "oneTwentyDay";

// Column unit: each column on the grid is either one day or one week.
export type ColumnUnit = "day" | "week";

export interface ViewConfig {
    unit: ColumnUnit;
    columns: number; // number of columns to render
    unitDays: number; // 1 for day mode, 7 for week mode
    label: string; // shown in the view picker
}

// View modes ≤ 30 days use day columns; longer outlooks switch to week columns
// so the swim-lane bar metaphor stays readable. Week counts are rounded up
// from the headline day total so the window covers at least N days.
export const VIEW_CONFIGS: Record<ViewMode, ViewConfig> = {
    twoWeek:      { unit: "day",  columns: 14, unitDays: 1, label: "2 Weeks" },
    thirtyDay:    { unit: "day",  columns: 30, unitDays: 1, label: "30 Days" },
    sixtyDay:     { unit: "week", columns: 9,  unitDays: 7, label: "60 Days" },
    ninetyDay:    { unit: "week", columns: 13, unitDays: 7, label: "90 Days" },
    oneTwentyDay: { unit: "week", columns: 18, unitDays: 7, label: "120 Days" },
};

export const VIEW_MODES = Object.keys(VIEW_CONFIGS) as ViewMode[];

// Org-hierarchy levels, top-to-bottom. Lane nesting follows this order:
// an event's deepest populated level is its lane; the levels above it are
// roll-up parents. Each level corresponds to a geip_Organization lookup on
// lrc_Event (lrc_Directorate, lrc_Staff, lrc_Division, lrc_Branch).
export const LEVELS = ["Directorate", "Staff", "Division", "Branch"] as const;
export type Level = (typeof LEVELS)[number];

// Name of the bucket for events with no org level set at all.
export const UNASSIGNED = "Unassigned";

export interface OrgVal {
    id: string | null;
    name: string;
}

// One step in an event's lane path (an org assigned at a given level).
export interface PathStep {
    level: Level;
    key: string; // stable key for this org at this level
    name: string;
}

// Standardized color per event type, applied across all lanes (requirements).
export const TYPE_COLORS: Record<string, string> = {
    Conference: "#1f6feb",
    Exercise: "#8957e5",
    Meeting: "#2da44e",
    "Training Event": "#bf8700",
    "Significant Due-Out (O-6/O-7)": "#cf222e",
    "External Public Event": "#0f6e6e",
    Other: "#6e7781",
};

export const EVENT_TYPES = Object.keys(TYPE_COLORS);

export function colorFor(type: string): string {
    return TYPE_COLORS[type] ?? TYPE_COLORS.Other;
}

export interface CalEvent {
    id: string;
    name: string;
    type: string;
    start: Date;
    end: Date;
    // Org assignment per level (only levels that are set are present).
    orgs: Partial<Record<Level, OrgVal>>;
    // Set levels in LEVELS order — the event's nesting path (deepest last).
    path: PathStep[];
    // Key of the deepest node the event belongs to, or UNASSIGNED.
    laneKey: string;
    location: string;
    description: string;
    pocName: string;
    pocEmail: string;
    pocPhone: string;
}

// A node in the collapsible lane tree.
export interface LaneNode {
    key: string; // full path key (unique per tree position)
    level: Level | typeof UNASSIGNED;
    name: string;
    depth: number; // 0-based nesting depth
    children: LaneNode[];
    direct: CalEvent[]; // events whose deepest level is exactly this node
    rollup: number; // count of events in this node's subtree (incl. direct)
}

// A lane row to render, produced by flattening the tree against expand state.
export interface VisibleLane {
    key: string;
    name: string;
    level: Level | typeof UNASSIGNED;
    depth: number;
    hasChildren: boolean;
    expanded: boolean;
    count: number; // roll-up count shown on the lane label
    events: CalEvent[]; // tiles to render (direct if expanded, subtree if collapsed)
}

export interface DueOut {
    id: string;
    eventId: string;
    task: string;
    description: string;
    due: Date | null;
    completed: Date | null;
}
