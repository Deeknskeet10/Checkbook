const MS_PER_DAY = 86400000;

export function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
    const r = startOfDay(d);
    r.setDate(r.getDate() + n);
    return r;
}

// Whole-day difference (b - a), ignoring time-of-day.
export function diffDays(a: Date, b: Date): number {
    return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / MS_PER_DAY);
}

export function isSameDay(a: Date, b: Date): boolean {
    return startOfDay(a).getTime() === startOfDay(b).getTime();
}

// Week boundary = Monday (clear weekly delineation, requirements).
export function isWeekStart(d: Date): boolean {
    return d.getDay() === 1;
}

// Monday of the week containing d.
export function weekStart(d: Date): Date {
    const dow = d.getDay(); // Sun=0..Sat=6
    const offset = dow === 0 ? -6 : 1 - dow;
    return addDays(d, offset);
}

export function weekdayShort(d: Date): string {
    return d.toLocaleString("en-US", { weekday: "narrow" });
}

export function monthShort(d: Date): string {
    return d.toLocaleString("en-US", { month: "short" });
}

// "14 - 16 Nov" / "14 Nov" — dates only, no year (requirements).
export function formatRangeNoYear(start: Date, end: Date | null): string {
    if (!start) return "";
    const day = (x: Date) => x.getDate();
    if (!end || isSameDay(start, end)) return `${day(start)} ${monthShort(start)}`;
    if (start.getMonth() === end.getMonth()) return `${day(start)} - ${day(end)} ${monthShort(end)}`;
    return `${day(start)} ${monthShort(start)} - ${day(end)} ${monthShort(end)}`;
}

// yyyy-mm-dd for Web API date-only fields (avoids timezone shifting).
export function toISODate(d: Date): string {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
}

// LRC events carry dates only, no times. Dataverse date-only values arrive
// anchored to UTC midnight (a Date instance, or an ISO string like
// "2026-08-14"/"2026-08-14T00:00:00Z"). Reading them with LOCAL calendar
// fields in a negative-offset zone (e.g. EST, UTC-5) rolls them back to the
// previous evening, placing the event one day early. So we take the calendar
// day timezone-independently — from the leading yyyy-mm-dd of a string, or the
// UTC fields of a Date/number — and rebuild it as a local start-of-day.
export function fromValue(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
    if (value instanceof Date || typeof value === "number" || typeof value === "string") {
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) return null;
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return null;
}
