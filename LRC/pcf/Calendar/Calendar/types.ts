export type ViewMode = "twoWeek" | "thirtyDay";

// The five canonical G-3/5/7 swim lanes (requirements). Division lookups are
// matched against these by name; anything else falls into UNASSIGNED.
export const SWIM_LANES = [
    "External & G-3/7 Front Office",
    "Operations Division",
    "Training Division",
    "Resource Integration Division",
    "Force Generation Division",
] as const;

export const UNASSIGNED = "Unassigned";

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
    laneName: string;
    divisionName: string;
    divisionId: string | null;
    location: string;
    description: string;
    pocName: string;
    pocEmail: string;
    pocPhone: string;
}

export interface DueOut {
    id: string;
    eventId: string;
    task: string;
    description: string;
    due: Date | null;
    completed: Date | null;
}
