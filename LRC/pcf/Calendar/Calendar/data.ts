import { CalEvent, DueOut, LaneNode, Level, LEVELS, OrgVal, PathStep, UNASSIGNED } from "./types";
import { fromValue, toISODate } from "./dateUtils";

type DataSet = ComponentFramework.PropertyTypes.DataSet;

interface LookupLike {
    id?: { guid?: string } | string;
    name?: string;
}

function asLookup(v: unknown): LookupLike | null {
    if (!v || typeof v !== "object") return null;
    const o = Array.isArray(v) ? (v as unknown[])[0] : v;
    return o && typeof o === "object" ? (o as LookupLike) : null;
}

function lookupId(v: unknown): string | null {
    const id = asLookup(v)?.id;
    if (id == null) return null;
    const raw = typeof id === "string" ? id : id.guid;
    return raw ? raw.replace(/[{}]/g, "") : null;
}

// Choice column values arrive as a number in model-driven hosts but can be a
// numeric string in others (e.g. the test harness); normalize to number | null.
function asChoiceValue(v: unknown): number | null {
    if (typeof v === "number") return Number.isNaN(v) ? null : v;
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        return Number.isNaN(n) ? null : n;
    }
    return null;
}

// Two-option columns arrive as a boolean in model-driven hosts but can be a
// number or string ("1"/"true") elsewhere; normalize to a boolean.
function asBool(v: unknown): boolean {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v === 1;
    if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
    return false;
}

// Dataset property-set name for each org level (matches the manifest bindings).
const LEVEL_PROP: Record<Level, string> = {
    Directorate: "directorate",
    Staff: "staff",
    Division: "division",
    Branch: "branch",
};

// Stable key for an org at a level — its id when known, else its name.
function stepKey(level: Level, org: OrgVal): string {
    return `${level}|${org.id ?? org.name}`;
}

export function readEvents(dataset: DataSet): CalEvent[] {
    const out: CalEvent[] = [];
    for (const id of dataset.sortedRecordIds) {
        const rec = dataset.records[id];
        if (!rec) continue;
        const start = fromValue(rec.getValue("startDate"));
        if (!start) continue; // cannot place an event without a start date
        const end = fromValue(rec.getValue("endDate")) ?? start;

        const orgs: Partial<Record<Level, OrgVal>> = {};
        const path: PathStep[] = [];
        for (const level of LEVELS) {
            const prop = LEVEL_PROP[level];
            const name = (rec.getFormattedValue(prop) || "").trim();
            if (!name) continue;
            const org: OrgVal = { id: lookupId(rec.getValue(prop)), name };
            orgs[level] = org;
            path.push({ level, key: stepKey(level, org), name });
        }
        const laneKey = path.length ? path[path.length - 1].key : UNASSIGNED;

        out.push({
            id,
            name: rec.getFormattedValue("eventName") || "(untitled)",
            type: rec.getFormattedValue("eventType") || "Other",
            start,
            end: end < start ? start : end,
            orgs,
            path,
            laneKey,
            roleRank: asChoiceValue(rec.getValue("leadershipRoleRank")),
            roleRankLabel: rec.getFormattedValue("leadershipRoleRank") || "",
            tentative: asBool(rec.getValue("tentative")),
            location: rec.getFormattedValue("location") || "",
            description: rec.getFormattedValue("description") || "",
            pocName: rec.getFormattedValue("pocName") || "",
            pocEmail: rec.getFormattedValue("pocEmail") || "",
            pocPhone: rec.getFormattedValue("pocPhone") || "",
        });
    }
    return out;
}

// Build the collapsible lane tree from the events' org paths. Nesting follows
// each event's own path of set levels, so an event that skips a level nests its
// next set level directly. Roll-up counts include the whole subtree.
export function buildLaneTree(events: CalEvent[]): LaneNode[] {
    interface Acc extends LaneNode {
        childMap: Map<string, Acc>;
    }
    const make = (key: string, level: LaneNode["level"], name: string, depth: number): Acc => ({
        key,
        level,
        name,
        depth,
        children: [],
        childMap: new Map(),
        direct: [],
        rollup: 0,
    });

    const rootMap = new Map<string, Acc>();
    const unassigned: CalEvent[] = [];

    for (const e of events) {
        if (e.path.length === 0) {
            unassigned.push(e);
            continue;
        }
        let map = rootMap;
        let parentKey = "";
        let node: Acc | undefined;
        e.path.forEach((step, i) => {
            const key = parentKey ? `${parentKey}>${step.key}` : step.key;
            let n = map.get(key);
            if (!n) {
                n = make(key, step.level, step.name, i);
                map.set(key, n);
            }
            n.rollup++;
            parentKey = key;
            map = n.childMap;
            node = n;
        });
        node!.direct.push(e);
    }

    const finalize = (accs: Map<string, Acc>): LaneNode[] =>
        [...accs.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((a) => ({
                key: a.key,
                level: a.level,
                name: a.name,
                depth: a.depth,
                children: finalize(a.childMap),
                direct: a.direct,
                rollup: a.rollup,
            }));

    const roots = finalize(rootMap);
    if (unassigned.length) {
        roots.push({
            key: UNASSIGNED,
            level: UNASSIGNED,
            name: UNASSIGNED,
            depth: 0,
            children: [],
            direct: unassigned,
            rollup: unassigned.length,
        });
    }
    return roots;
}

// All events in a node's subtree (direct + descendants) — used to render the
// roll-up tiles when a node is collapsed.
export function subtreeEvents(node: LaneNode): CalEvent[] {
    const out = [...node.direct];
    for (const c of node.children) out.push(...subtreeEvents(c));
    return out;
}

// Distinct org names present at each level, for the filter dropdowns.
export function distinctOrgsByLevel(events: CalEvent[]): Record<Level, string[]> {
    const sets: Record<Level, Set<string>> = {
        Directorate: new Set(),
        Staff: new Set(),
        Division: new Set(),
        Branch: new Set(),
    };
    for (const e of events) {
        for (const level of LEVELS) {
            const o = e.orgs[level];
            if (o) sets[level].add(o.name);
        }
    }
    const out = {} as Record<Level, string[]>;
    for (const level of LEVELS) out[level] = [...sets[level]].sort((a, b) => a.localeCompare(b));
    return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
    const res: T[][] = [];
    for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
    return res;
}

export async function fetchDueOuts(
    webAPI: ComponentFramework.WebApi,
    eventIds: string[]
): Promise<DueOut[]> {
    if (eventIds.length === 0) return [];
    const select =
        "$select=lrc_eventdueoutid,lrc_name,lrc_task,lrc_taskdescription,lrc_duedate,lrc_completeddate,_lrc_event_value";
    const results: DueOut[] = [];
    for (const ids of chunk(eventIds, 20)) {
        const filter = ids.map((id) => `_lrc_event_value eq ${id}`).join(" or ");
        const query = `?${select}&$filter=(${filter})`;
        const resp = await webAPI.retrieveMultipleRecords("lrc_eventdueout", query);
        for (const r of resp.entities) {
            results.push({
                id: r.lrc_eventdueoutid as string,
                eventId: (r._lrc_event_value as string) ?? "",
                task: (r.lrc_task as string) || (r.lrc_name as string) || "Due-out",
                description: (r.lrc_taskdescription as string) || "",
                due: fromValue(r.lrc_duedate),
                completed: fromValue(r.lrc_completeddate),
            });
        }
    }
    return results;
}

export async function updateEventSchedule(
    webAPI: ComponentFramework.WebApi,
    eventId: string,
    newStart: Date,
    newEnd: Date
): Promise<void> {
    const data: Record<string, unknown> = {
        lrc_startdate: toISODate(newStart),
        lrc_enddate: toISODate(newEnd),
    };
    await webAPI.updateRecord("lrc_event", eventId, data as ComponentFramework.WebApi.Entity);
}

export function exportEventsCsv(events: CalEvent[]): void {
    if (typeof document === "undefined") return;
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const header = ["Event", "Type", "Start", "End", "Role/Rank", "Directorate", "Staff", "Division", "Branch", "Location", "POC", "Email", "Phone"];
    const lines = [header.join(",")];
    for (const e of events) {
        lines.push(
            [
                esc(e.name),
                esc(e.type),
                esc(toISODate(e.start)),
                esc(toISODate(e.end)),
                esc(e.roleRankLabel),
                esc(e.orgs.Directorate?.name ?? ""),
                esc(e.orgs.Staff?.name ?? ""),
                esc(e.orgs.Division?.name ?? ""),
                esc(e.orgs.Branch?.name ?? ""),
                esc(e.location),
                esc(e.pocName),
                esc(e.pocEmail),
                esc(e.pocPhone),
            ].join(",")
        );
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `long-range-calendar-${toISODate(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
