import { CalEvent, DueOut, SWIM_LANES, UNASSIGNED } from "./types";
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

function resolveLane(divisionName: string): string {
    return (SWIM_LANES as readonly string[]).includes(divisionName) ? divisionName : UNASSIGNED;
}

export function readEvents(dataset: DataSet): CalEvent[] {
    const out: CalEvent[] = [];
    for (const id of dataset.sortedRecordIds) {
        const rec = dataset.records[id];
        if (!rec) continue;
        const start = fromValue(rec.getValue("startDate"));
        if (!start) continue; // cannot place an event without a start date
        const end = fromValue(rec.getValue("endDate")) ?? start;
        const divisionName = (rec.getFormattedValue("division") || "").trim();
        out.push({
            id,
            name: rec.getFormattedValue("eventName") || "(untitled)",
            type: rec.getFormattedValue("eventType") || "Other",
            start,
            end: end < start ? start : end,
            divisionName,
            divisionId: lookupId(rec.getValue("division")),
            laneName: resolveLane(divisionName),
            location: rec.getFormattedValue("location") || "",
            description: rec.getFormattedValue("description") || "",
            pocName: rec.getFormattedValue("pocName") || "",
            pocEmail: rec.getFormattedValue("pocEmail") || "",
            pocPhone: rec.getFormattedValue("pocPhone") || "",
        });
    }
    return out;
}

// Maps each lane name to a known geip_Organization id, harvested from events
// already in that lane — used to set the division lookup on cross-lane drops.
export function laneDivisionMap(events: CalEvent[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const e of events) {
        if (e.divisionId && !map[e.laneName]) map[e.laneName] = e.divisionId;
    }
    return map;
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
    newEnd: Date,
    divisionId: string | null
): Promise<void> {
    const data: Record<string, unknown> = {
        lrc_startdate: toISODate(newStart),
        lrc_enddate: toISODate(newEnd),
    };
    if (divisionId) data["lrc_Division@odata.bind"] = `/geip_organizations(${divisionId})`;
    await webAPI.updateRecord("lrc_event", eventId, data as ComponentFramework.WebApi.Entity);
}

export function exportEventsCsv(events: CalEvent[]): void {
    if (typeof document === "undefined") return;
    const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
    const header = ["Event", "Type", "Start", "End", "Lane", "Division", "Location", "POC", "Email", "Phone"];
    const lines = [header.join(",")];
    for (const e of events) {
        lines.push(
            [
                esc(e.name),
                esc(e.type),
                esc(toISODate(e.start)),
                esc(toISODate(e.end)),
                esc(e.laneName),
                esc(e.divisionName),
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
