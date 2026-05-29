import * as React from "react";
import { CalEvent, DueOut, UNASSIGNED, VisibleLane, colorFor } from "./types";
import { addDays, diffDays, isSameDay, isWeekStart, monthShort, weekdayShort } from "./dateUtils";

const HEADER_H = 48;
const BAR_H = 22;
const BAR_GAP = 4;
const STRIP_H = 16;
const LANE_PAD = 5;
const INDENT = 16;

interface Positioned {
    e: CalEvent;
    s: number;
    en: number;
}

export interface CalendarGridProps {
    lanes: VisibleLane[];
    dueOuts: DueOut[];
    windowStart: Date;
    days: number;
    colWidth: number;
    labelWidth: number;
    selectedId: string | null;
    onSelect: (e: CalEvent) => void;
    onReschedule: (e: CalEvent, newStart: Date) => void;
    onToggleExpand: (key: string) => void;
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

// Greedy packing: each event takes the first sub-row it does not overlap.
function pack(items: Positioned[]): Positioned[][] {
    const sorted = [...items].sort((a, b) => a.s - b.s || a.en - b.en);
    const rows: Positioned[][] = [];
    const lastEnd: number[] = [];
    for (const it of sorted) {
        let placed = false;
        for (let r = 0; r < rows.length; r++) {
            if (it.s > lastEnd[r]) {
                rows[r].push(it);
                lastEnd[r] = it.en;
                placed = true;
                break;
            }
        }
        if (!placed) {
            rows.push([it]);
            lastEnd.push(it.en);
        }
    }
    return rows;
}

export const CalendarGrid: React.FC<CalendarGridProps> = (props) => {
    const { lanes, dueOuts, windowStart, days, colWidth, labelWidth, selectedId } = props;
    const draggedRef = React.useRef<CalEvent | null>(null);
    const today = new Date();

    const dayList = React.useMemo(
        () => Array.from({ length: days }, (_, i) => addDays(windowStart, i)),
        [windowStart, days]
    );

    const dueOutsByEvent = React.useMemo(() => {
        const m: Record<string, DueOut[]> = {};
        for (const d of dueOuts) {
            if (!m[d.eventId]) m[d.eventId] = [];
            m[d.eventId].push(d);
        }
        return m;
    }, [dueOuts]);

    const innerWidth = labelWidth + days * colWidth;

    const handleDrop = (dayIdx: number) => (ev: React.DragEvent) => {
        ev.preventDefault();
        const dragged = draggedRef.current;
        draggedRef.current = null;
        if (dragged) props.onReschedule(dragged, addDays(windowStart, dayIdx));
    };

    const allowDrop = (ev: React.DragEvent) => ev.preventDefault();

    return (
        <div className="cal">
            <div className="cal__inner" style={{ width: innerWidth }}>
                {/* ── Frozen header row ── */}
                <div className="cal__head" style={{ height: HEADER_H }}>
                    <div className="cal__corner" style={{ width: labelWidth }}>
                        Organization
                    </div>
                    {dayList.map((d, i) => {
                        const showMonth = i === 0 || d.getDate() === 1;
                        const wknd = d.getDay() === 0 || d.getDay() === 6;
                        const cls = [
                            "cal__dayhead",
                            isWeekStart(d) ? "cal__col--week" : "",
                            wknd ? "cal__col--wknd" : "",
                            isSameDay(d, today) ? "cal__col--today" : "",
                        ].join(" ");
                        return (
                            <div className={cls} key={i} style={{ width: colWidth }}>
                                <span className="cal__mon">{showMonth ? monthShort(d) : ""}</span>
                                <span className="cal__dnum">{d.getDate()}</span>
                                <span className="cal__dow">{weekdayShort(d)}</span>
                            </div>
                        );
                    })}
                </div>

                {/* ── Lanes ── */}
                {lanes.map((lane) => {
                    const positioned: Positioned[] = [];
                    for (const e of lane.events) {
                        const sIdx = diffDays(windowStart, e.start);
                        const eIdx = diffDays(windowStart, e.end);
                        if (eIdx < 0 || sIdx > days - 1) continue;
                        positioned.push({ e, s: clamp(sIdx, 0, days - 1), en: clamp(eIdx, 0, days - 1) });
                    }
                    const rows = pack(positioned);

                    // Due-out markers for this lane, grouped by day column.
                    const dueByDay: Record<number, DueOut[]> = {};
                    for (const e of lane.events) {
                        for (const d of dueOutsByEvent[e.id] ?? []) {
                            if (!d.due) continue;
                            const idx = diffDays(windowStart, d.due);
                            if (idx < 0 || idx > days - 1) continue;
                            if (!dueByDay[idx]) dueByDay[idx] = [];
                            dueByDay[idx].push(d);
                        }
                    }
                    const hasStrip = Object.keys(dueByDay).length > 0;
                    const stripH = hasStrip ? STRIP_H : 0;
                    const nRows = Math.max(1, rows.length);
                    const bodyH = stripH + nRows * (BAR_H + BAR_GAP) + LANE_PAD * 2;

                    const labelCls = [
                        "cal__lanelabel",
                        `cal__lanelabel--d${Math.min(lane.depth, 3)}`,
                        lane.level === UNASSIGNED ? "cal__lanelabel--unassigned" : "",
                    ].join(" ");

                    return (
                        <div className="cal__lane" key={lane.key} style={{ minHeight: bodyH }}>
                            <div className={labelCls} style={{ width: labelWidth, paddingLeft: 8 + lane.depth * INDENT }}>
                                {lane.hasChildren ? (
                                    <button
                                        className="cal__caret"
                                        onClick={() => props.onToggleExpand(lane.key)}
                                        aria-label={lane.expanded ? "Collapse" : "Expand"}
                                        title={lane.expanded ? "Collapse" : "Expand"}
                                    >
                                        {lane.expanded ? "▼" : "▶"}
                                    </button>
                                ) : (
                                    <span className="cal__caret cal__caret--leaf">•</span>
                                )}
                                <span className="cal__lanename" title={`${lane.level}: ${lane.name}`}>
                                    {lane.name}
                                </span>
                                <span className="cal__lanecount">{lane.count}</span>
                            </div>
                            <div className="cal__lanebody" style={{ width: days * colWidth, height: bodyH }}>
                                {/* drop cells + weekly delineation */}
                                {dayList.map((d, i) => {
                                    const wknd = d.getDay() === 0 || d.getDay() === 6;
                                    const cls = [
                                        "cal__cell",
                                        isWeekStart(d) ? "cal__col--week" : "",
                                        wknd ? "cal__col--wknd" : "",
                                        isSameDay(d, today) ? "cal__col--today" : "",
                                    ].join(" ");
                                    return (
                                        <div
                                            className={cls}
                                            key={i}
                                            style={{ left: i * colWidth, width: colWidth }}
                                            onDragOver={allowDrop}
                                            onDrop={handleDrop(i)}
                                        />
                                    );
                                })}

                                {/* due-out strip */}
                                {hasStrip &&
                                    Object.keys(dueByDay).map((k) => {
                                        const idx = Number(k);
                                        const list = dueByDay[idx];
                                        const title = list
                                            .map((d) => `Due-out: ${d.task}${d.completed ? " (done)" : ""}`)
                                            .join("\n");
                                        const open = list.some((d) => !d.completed);
                                        return (
                                            <div
                                                key={`do-${idx}`}
                                                className={`cal__dueout ${open ? "cal__dueout--open" : "cal__dueout--done"}`}
                                                style={{ left: idx * colWidth + 2, top: 2 }}
                                                title={title}
                                            >
                                                ◆{list.length > 1 ? list.length : ""}
                                            </div>
                                        );
                                    })}

                                {/* event bars */}
                                {rows.map((row, r) =>
                                    row.map((p) => {
                                        const left = p.s * colWidth + 2;
                                        const width = (p.en - p.s + 1) * colWidth - 4;
                                        const top = stripH + LANE_PAD + r * (BAR_H + BAR_GAP);
                                        const selected = selectedId === p.e.id;
                                        const hasDetail =
                                            !!p.e.description || !!p.e.location || (dueOutsByEvent[p.e.id]?.length ?? 0) > 0;
                                        return (
                                            <div
                                                key={p.e.id}
                                                className={`cal__event${selected ? " cal__event--sel" : ""}`}
                                                style={{
                                                    left,
                                                    width: Math.max(width, colWidth - 4),
                                                    top,
                                                    height: BAR_H,
                                                    backgroundColor: colorFor(p.e.type),
                                                }}
                                                title={`${p.e.name} (${p.e.type})`}
                                                draggable
                                                onDragStart={() => {
                                                    draggedRef.current = p.e;
                                                }}
                                                onClick={() => props.onSelect(p.e)}
                                                onDoubleClick={() => props.onSelect(p.e)}
                                            >
                                                {hasDetail && <span className="cal__info">i</span>}
                                                <span className="cal__evname">{p.e.name}</span>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
