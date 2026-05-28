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

export function fromValue(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : startOfDay(value);
    if (typeof value === "number" || typeof value === "string") {
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : startOfDay(d);
    }
    return null;
}
