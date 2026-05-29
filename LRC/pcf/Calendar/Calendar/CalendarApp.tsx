import * as React from "react";
import { CalEvent, DueOut, SWIM_LANES, UNASSIGNED, ViewMode } from "./types";
import { addDays, diffDays, startOfDay } from "./dateUtils";
import { exportEventsCsv, fetchDueOuts, laneDivisionMap, readEvents, updateEventSchedule } from "./data";
import { Toolbar } from "./Toolbar";
import { CalendarGrid } from "./CalendarGrid";
import { DetailPanel } from "./DetailPanel";

type DataSet = ComponentFramework.PropertyTypes.DataSet;

const LABEL_W = 168;

export interface ICalendarProps {
    dataset: DataSet;
    webAPI: ComponentFramework.WebApi;
    defaultView: ViewMode;
    width: number;
    height: number;
    refresh: () => void;
}

const LANE_ORDER = [...SWIM_LANES, UNASSIGNED];

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export const CalendarApp: React.FC<ICalendarProps> = (props) => {
    const { dataset, webAPI, width, height } = props;

    // The PCF host reports its container size via allocatedWidth/Height (we opt in
    // with trackContainerResize). Apply them so the control fills its container in
    // model-driven pages, where CSS height:100% otherwise collapses to content.
    const rootStyle: React.CSSProperties = {
        width: width > 0 ? width : "100%",
        height: height > 0 ? height : "100%",
    };

    const [view, setView] = React.useState<ViewMode>(props.defaultView);
    const [anchor, setAnchor] = React.useState<Date>(() => startOfDay(new Date()));
    const [typeFilter, setTypeFilter] = React.useState("");
    const [keyword, setKeyword] = React.useState("");
    const [hiddenLanes, setHiddenLanes] = React.useState<Set<string>>(() => new Set());
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [dueOuts, setDueOuts] = React.useState<DueOut[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const events = React.useMemo(() => readEvents(dataset), [dataset]);
    const laneMap = React.useMemo(() => laneDivisionMap(events), [events]);

    // Fetch due-outs whenever the set of event ids changes.
    const eventsRef = React.useRef(events);
    eventsRef.current = events;
    const idsKey = React.useMemo(() => events.map((e) => e.id).sort().join("|"), [events]);
    React.useEffect(() => {
        let cancelled = false;
        const ids = eventsRef.current.map((e) => e.id);
        if (ids.length === 0) {
            setDueOuts([]);
            return;
        }
        fetchDueOuts(webAPI, ids)
            .then((d) => {
                if (!cancelled) setDueOuts(d);
                return null;
            })
            .catch((err) => {
                if (!cancelled) setError(errMessage(err));
            });
        return () => {
            cancelled = true;
        };
    }, [idsKey, webAPI]);

    const days = view === "twoWeek" ? 14 : 30;
    const windowStart = anchor;
    const windowEnd = addDays(windowStart, days - 1);

    const matches = React.useCallback(
        (e: CalEvent): boolean => {
            if (typeFilter && e.type !== typeFilter) return false;
            if (keyword) {
                const kw = keyword.toLowerCase();
                const hay = `${e.name} ${e.location} ${e.divisionName} ${e.pocName}`.toLowerCase();
                if (!hay.includes(kw)) return false;
            }
            return true;
        },
        [typeFilter, keyword]
    );

    const inWindow = React.useCallback(
        (e: CalEvent): boolean => diffDays(windowStart, e.end) >= 0 && diffDays(windowStart, e.start) <= days - 1,
        [windowStart, days]
    );

    const hasUnassigned = events.some((e) => e.laneName === UNASSIGNED);
    const allLanes = LANE_ORDER.filter((l) => l !== UNASSIGNED || hasUnassigned);
    const visibleLanes = allLanes.filter((l) => !hiddenLanes.has(l));

    // Events passed to the grid: match filters + in a visible lane. Window is applied inside the grid.
    const gridEvents = events.filter((e) => matches(e) && !hiddenLanes.has(e.laneName));

    // Counts (within the current window).
    const windowed = events.filter((e) => matches(e) && inWindow(e));
    const laneCounts: Record<string, number> = {};
    for (const e of windowed) laneCounts[e.laneName] = (laneCounts[e.laneName] ?? 0) + 1;
    const typeCounts: Record<string, number> = {};
    for (const e of windowed) {
        if (!hiddenLanes.has(e.laneName)) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    }
    const totalShown = Object.values(typeCounts).reduce((a, b) => a + b, 0);

    const colWidth = Math.max(view === "twoWeek" ? 70 : 34, Math.floor(((width > 0 ? width : 1000) - LABEL_W - 2) / days));

    const toggleLane = (l: string) =>
        setHiddenLanes((prev) => {
            const next = new Set(prev);
            if (next.has(l)) next.delete(l);
            else next.add(l);
            return next;
        });

    const onReschedule = (e: CalEvent, newStart: Date, newLane: string) => {
        const duration = diffDays(e.start, e.end);
        const newEnd = addDays(newStart, duration);
        const laneChanged = newLane !== e.laneName;
        const targetDivision = laneChanged ? laneMap[newLane] ?? null : null;
        if (laneChanged && !targetDivision) {
            setError(`Moved dates only — no known division to assign for "${newLane}". Set it on the form.`);
        } else {
            setError(null);
        }
        setBusy(true);
        updateEventSchedule(webAPI, e.id, newStart, newEnd, targetDivision)
            .then(() => props.refresh())
            .finally(() => setBusy(false))
            .catch((err) => setError(errMessage(err)));
    };

    const selected = selectedId ? events.find((e) => e.id === selectedId) ?? null : null;
    const selectedDueOuts = selectedId ? dueOuts.filter((d) => d.eventId === selectedId) : [];

    return (
        <div className="cal-root" style={rootStyle}>
            <Toolbar
                view={view}
                onView={setView}
                windowStart={windowStart}
                windowEnd={windowEnd}
                onPrev={() => setAnchor((a) => addDays(a, -days))}
                onNext={() => setAnchor((a) => addDays(a, days))}
                onToday={() => setAnchor(startOfDay(new Date()))}
                onJump={(d) => setAnchor(startOfDay(d))}
                typeFilter={typeFilter}
                onTypeFilter={setTypeFilter}
                keyword={keyword}
                onKeyword={setKeyword}
                lanes={allLanes}
                hiddenLanes={hiddenLanes}
                onToggleLane={toggleLane}
                totalShown={totalShown}
                typeCounts={typeCounts}
                onExport={() => exportEventsCsv(windowed.filter((e) => !hiddenLanes.has(e.laneName)))}
                onPrint={() => window.print()}
                busy={busy}
                error={error}
            />
            <div className="cal-main">
                <CalendarGrid
                    events={gridEvents}
                    dueOuts={dueOuts}
                    lanes={visibleLanes}
                    laneCounts={laneCounts}
                    windowStart={windowStart}
                    days={days}
                    colWidth={colWidth}
                    selectedId={selectedId}
                    onSelect={(e) => setSelectedId(e.id)}
                    onReschedule={onReschedule}
                />
                {selected && (
                    <DetailPanel event={selected} dueOuts={selectedDueOuts} onClose={() => setSelectedId(null)} />
                )}
            </div>
        </div>
    );
};
