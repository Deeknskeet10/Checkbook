import * as React from "react";
import { CalEvent, ColumnUnit, DueOut, UNASSIGNED, VisibleLane, colorFor } from "./types";
import { addDays, diffDays, isWeekStart, monthShort, weekdayShort } from "./dateUtils";
import { RankBadge, roleRankMeta } from "./insignia";

const HEADER_H = 48;
const BAR_H = 22;
const BAR_GAP = 4;
const STRIP_H = 24;
const LANE_PAD = 5;
const INDENT = 16;

interface Positioned {
    e: CalEvent;
    s: number;
    en: number;
}

interface Column {
    index: number;
    start: Date;
    end: Date;
}

export interface CalendarGridProps {
    lanes: VisibleLane[];
    dueOuts: DueOut[];
    windowStart: Date;
    columns: number;
    unitDays: number;
    columnUnit: ColumnUnit;
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
    const { lanes, dueOuts, windowStart, columns, unitDays, columnUnit, colWidth, labelWidth, selectedId } = props;
    const draggedRef = React.useRef<CalEvent | null>(null);
    const today = new Date();
    const isWeek = columnUnit === "week";
    const totalDays = columns * unitDays;

    const colList = React.useMemo<Column[]>(
        () =>
            Array.from({ length: columns }, (_, i) => {
                const start = addDays(windowStart, i * unitDays);
                const end = addDays(start, unitDays - 1);
                return { index: i, start, end };
            }),
        [windowStart, columns, unitDays]
    );

    const dueOutsByEvent = React.useMemo(() => {
        const m: Record<string, DueOut[]> = {};
        for (const d of dueOuts) {
            if (!m[d.eventId]) m[d.eventId] = [];
            m[d.eventId].push(d);
        }
        return m;
    }, [dueOuts]);

    const innerWidth = labelWidth + columns * colWidth;

    // Drop: snap to the column. In week mode we preserve the event's original
    // day-of-week within the dropped week so a Wednesday event stays a Wednesday.
    const handleDrop = (colIdx: number) => (ev: React.DragEvent) => {
        ev.preventDefault();
        const dragged = draggedRef.current;
        draggedRef.current = null;
        if (!dragged) return;
        let newStart = addDays(windowStart, colIdx * unitDays);
        if (isWeek) {
            const dow = (dragged.start.getDay() + 6) % 7; // Mon=0..Sun=6
            newStart = addDays(newStart, dow);
        }
        props.onReschedule(dragged, newStart);
    };

    const allowDrop = (ev: React.DragEvent) => ev.preventDefault();

    const colContainsToday = (c: Column): boolean =>
        diffDays(c.start, today) >= 0 && diffDays(c.start, today) < unitDays;

    return (
        <div className="cal">
            <div className="cal__inner" style={{ width: innerWidth }}>
                {/* ── Frozen header row ── */}
                <div className="cal__head" style={{ height: HEADER_H }}>
                    <div className="cal__corner" style={{ width: labelWidth }}>
                        Organization
                    </div>
                    {colList.map((c, i) => {
                        const prev = colList[i - 1];
                        const showMonth = i === 0 || c.start.getMonth() !== prev?.start.getMonth();
                        const wknd = !isWeek && (c.start.getDay() === 0 || c.start.getDay() === 6);
                        const cls = [
                            "cal__dayhead",
                            !isWeek && isWeekStart(c.start) ? "cal__col--week" : "",
                            wknd ? "cal__col--wknd" : "",
                            colContainsToday(c) ? "cal__col--today" : "",
                        ]
                            .filter(Boolean)
                            .join(" ");
                        return (
                            <div className={cls} key={i} style={{ width: colWidth }}>
                                <span className="cal__mon">{showMonth ? monthShort(c.start) : ""}</span>
                                <span className="cal__dnum">
                                    {isWeek ? `${c.start.getDate()} – ${c.end.getDate()}` : c.start.getDate()}
                                </span>
                                <span className="cal__dow">{isWeek ? "Wk" : weekdayShort(c.start)}</span>
                            </div>
                        );
                    })}
                </div>

                {/* ── Lanes ── */}
                {lanes.map((lane) => {
                    const positioned: Positioned[] = [];
                    for (const e of lane.events) {
                        const sDays = diffDays(windowStart, e.start);
                        const eDays = diffDays(windowStart, e.end);
                        if (eDays < 0 || sDays > totalDays - 1) continue;
                        const sIdx = clamp(Math.floor(sDays / unitDays), 0, columns - 1);
                        const eIdx = clamp(Math.floor(eDays / unitDays), 0, columns - 1);
                        positioned.push({ e, s: sIdx, en: eIdx });
                    }
                    const rows = pack(positioned);

                    // Due-out markers grouped by column index.
                    const dueByCol: Record<number, DueOut[]> = {};
                    for (const e of lane.events) {
                        for (const d of dueOutsByEvent[e.id] ?? []) {
                            if (!d.due) continue;
                            const dDays = diffDays(windowStart, d.due);
                            if (dDays < 0 || dDays > totalDays - 1) continue;
                            const idx = Math.floor(dDays / unitDays);
                            if (!dueByCol[idx]) dueByCol[idx] = [];
                            dueByCol[idx].push(d);
                        }
                    }
                    const hasStrip = Object.keys(dueByCol).length > 0;
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
                            <div className="cal__lanebody" style={{ width: columns * colWidth, height: bodyH }}>
                                {/* drop cells + weekly delineation */}
                                {colList.map((c, i) => {
                                    const wknd = !isWeek && (c.start.getDay() === 0 || c.start.getDay() === 6);
                                    const cls = [
                                        "cal__cell",
                                        !isWeek && isWeekStart(c.start) ? "cal__col--week" : "",
                                        wknd ? "cal__col--wknd" : "",
                                        colContainsToday(c) ? "cal__col--today" : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ");
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
                                    Object.keys(dueByCol).map((k) => {
                                        const idx = Number(k);
                                        const list = dueByCol[idx];
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
                                        const rank = roleRankMeta(p.e.roleRank);
                                        const rankTip = rank?.full ?? p.e.roleRankLabel;
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
                                                title={`${p.e.name} (${p.e.type})${rankTip ? ` — ${rankTip}` : ""}`}
                                                draggable
                                                onDragStart={() => {
                                                    draggedRef.current = p.e;
                                                }}
                                                onClick={() => props.onSelect(p.e)}
                                                onDoubleClick={() => props.onSelect(p.e)}
                                            >
                                                {hasDetail && <span className="cal__info">i</span>}
                                                <RankBadge value={p.e.roleRank} />
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
