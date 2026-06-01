import * as React from "react";
import { CalEvent, DueOut, Level, LEVELS, VIEW_CONFIGS, VisibleLane, ViewMode } from "./types";
import { addDays, diffDays, startOfDay, weekStart } from "./dateUtils";
import {
    buildLaneTree,
    distinctOrgsByLevel,
    exportEventsCsv,
    fetchDueOuts,
    readEvents,
    subtreeEvents,
    updateEventSchedule,
} from "./data";
import { Toolbar } from "./Toolbar";
import { CalendarGrid } from "./CalendarGrid";
import { DetailPanel } from "./DetailPanel";

type DataSet = ComponentFramework.PropertyTypes.DataSet;

const LABEL_W = 220;

export interface ICalendarProps {
    dataset: DataSet;
    webAPI: ComponentFramework.WebApi;
    defaultView: ViewMode;
    width: number;
    height: number;
    refresh: () => void;
}

function errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

type OrgFilters = Record<Level, string>;
const EMPTY_FILTERS: OrgFilters = { Directorate: "", Staff: "", Division: "", Branch: "" };

export const CalendarApp: React.FC<ICalendarProps> = (props) => {
    const { dataset, webAPI, width, height } = props;

    const rootStyle: React.CSSProperties = {
        width: width > 0 ? width : "100%",
        height: height > 0 ? height : "100%",
    };

    const [view, setView] = React.useState<ViewMode>(props.defaultView);
    const [anchor, setAnchor] = React.useState<Date>(() => startOfDay(new Date()));
    const [typeFilter, setTypeFilter] = React.useState("");
    const [keyword, setKeyword] = React.useState("");
    const [orgFilters, setOrgFilters] = React.useState<OrgFilters>(EMPTY_FILTERS);
    const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
    const [selectedId, setSelectedId] = React.useState<string | null>(null);
    const [dueOuts, setDueOuts] = React.useState<DueOut[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const events = React.useMemo(() => readEvents(dataset), [dataset]);
    const orgOptions = React.useMemo(() => distinctOrgsByLevel(events), [events]);

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

    const cfg = VIEW_CONFIGS[view];
    const totalDays = cfg.columns * cfg.unitDays;
    // Week-mode windows align to Monday so each column is a full ISO-ish week.
    const windowStart = cfg.unit === "week" ? weekStart(anchor) : anchor;
    const windowEnd = addDays(windowStart, totalDays - 1);

    const matches = React.useCallback(
        (e: CalEvent): boolean => {
            if (typeFilter && e.type !== typeFilter) return false;
            for (const level of LEVELS) {
                const f = orgFilters[level];
                if (f && e.orgs[level]?.name !== f) return false;
            }
            if (keyword) {
                const kw = keyword.toLowerCase();
                const orgNames = LEVELS.map((l) => e.orgs[l]?.name ?? "").join(" ");
                const hay = `${e.name} ${e.location} ${orgNames} ${e.pocName}`.toLowerCase();
                if (!hay.includes(kw)) return false;
            }
            return true;
        },
        [typeFilter, keyword, orgFilters]
    );

    const inWindow = React.useCallback(
        (e: CalEvent): boolean =>
            diffDays(windowStart, e.end) >= 0 && diffDays(windowStart, e.start) <= totalDays - 1,
        [windowStart, totalDays]
    );

    const filtered = React.useMemo(() => events.filter(matches), [events, matches]);
    const tree = React.useMemo(() => buildLaneTree(filtered), [filtered]);

    // Flatten the tree to the lane rows to render, honoring expand state. A
    // collapsed node shows its whole subtree rolled up; an expanded node shows
    // only its direct events and recurses into children.
    const visibleLanes = React.useMemo<VisibleLane[]>(() => {
        const out: VisibleLane[] = [];
        const walk = (nodes: typeof tree): void => {
            for (const node of nodes) {
                const hasChildren = node.children.length > 0;
                const isExpanded = hasChildren && expanded.has(node.key);
                out.push({
                    key: node.key,
                    name: node.name,
                    level: node.level,
                    depth: node.depth,
                    hasChildren,
                    expanded: isExpanded,
                    count: node.rollup,
                    events: isExpanded ? node.direct : subtreeEvents(node),
                });
                if (isExpanded) walk(node.children);
            }
        };
        walk(tree);
        return out;
    }, [tree, expanded]);

    // Type counts within the current window, across the filtered events.
    const windowed = filtered.filter(inWindow);
    const typeCounts: Record<string, number> = {};
    for (const e of windowed) typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    const totalShown = windowed.length;

    // Min column width: wide for week-mode (room for "27 - 2 May"), narrow for day-mode.
    const minColW = cfg.unit === "week" ? 90 : view === "twoWeek" ? 70 : 34;
    const colWidth = Math.max(minColW, Math.floor(((width > 0 ? width : 1000) - LABEL_W - 2) / cfg.columns));

    const allKeys = React.useMemo(() => {
        const keys: string[] = [];
        const walk = (nodes: typeof tree): void => {
            for (const n of nodes) {
                if (n.children.length) {
                    keys.push(n.key);
                    walk(n.children);
                }
            }
        };
        walk(tree);
        return keys;
    }, [tree]);

    const toggleExpand = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const onReschedule = (e: CalEvent, newStart: Date) => {
        const duration = diffDays(e.start, e.end);
        const newEnd = addDays(newStart, duration);
        setError(null);
        setBusy(true);
        updateEventSchedule(webAPI, e.id, newStart, newEnd)
            .then(() => props.refresh())
            .finally(() => setBusy(false))
            .catch((err) => setError(errMessage(err)));
    };

    const setOrgFilter = (level: Level, value: string) =>
        setOrgFilters((prev) => ({ ...prev, [level]: value }));

    const selected = selectedId ? events.find((e) => e.id === selectedId) ?? null : null;
    const selectedDueOuts = selectedId ? dueOuts.filter((d) => d.eventId === selectedId) : [];

    return (
        <div className="cal-root" style={rootStyle}>
            <Toolbar
                view={view}
                onView={setView}
                windowStart={windowStart}
                windowEnd={windowEnd}
                onPrev={() => setAnchor((a) => addDays(a, -totalDays))}
                onNext={() => setAnchor((a) => addDays(a, totalDays))}
                onToday={() => setAnchor(startOfDay(new Date()))}
                onJump={(d) => setAnchor(startOfDay(d))}
                typeFilter={typeFilter}
                onTypeFilter={setTypeFilter}
                keyword={keyword}
                onKeyword={setKeyword}
                orgOptions={orgOptions}
                orgFilters={orgFilters}
                onOrgFilter={setOrgFilter}
                onExpandAll={() => setExpanded(new Set(allKeys))}
                onCollapseAll={() => setExpanded(new Set())}
                totalShown={totalShown}
                typeCounts={typeCounts}
                onExport={() => exportEventsCsv(windowed)}
                onPrint={() => window.print()}
                busy={busy}
                error={error}
            />
            <div className="cal-main">
                <CalendarGrid
                    lanes={visibleLanes}
                    dueOuts={dueOuts}
                    windowStart={windowStart}
                    columns={cfg.columns}
                    unitDays={cfg.unitDays}
                    columnUnit={cfg.unit}
                    colWidth={colWidth}
                    labelWidth={LABEL_W}
                    selectedId={selectedId}
                    onSelect={(e) => setSelectedId(e.id)}
                    onReschedule={onReschedule}
                    onToggleExpand={toggleExpand}
                />
                {selected && (
                    <DetailPanel event={selected} dueOuts={selectedDueOuts} onClose={() => setSelectedId(null)} />
                )}
            </div>
        </div>
    );
};
