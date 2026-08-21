import * as React from "react";
import { EVENT_TYPES, Level, LEVELS, VIEW_CONFIGS, VIEW_MODES, ViewMode, colorFor } from "./types";
import { monthShort, toISODate } from "./dateUtils";

export interface ToolbarProps {
    view: ViewMode;
    onView: (v: ViewMode) => void;
    windowStart: Date;
    windowEnd: Date;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    onJump: (d: Date) => void;
    typeFilter: string;
    onTypeFilter: (t: string) => void;
    keyword: string;
    onKeyword: (s: string) => void;
    orgOptions: Record<Level, string[]>;
    orgFilters: Record<Level, string>;
    onOrgFilter: (level: Level, value: string) => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    totalShown: number;
    typeCounts: Record<string, number>;
    onExport: () => void;
    onPrint: () => void;
    busy: boolean;
    error: string | null;
}

export const Toolbar: React.FC<ToolbarProps> = (props) => {
    const { windowStart, windowEnd } = props;
    const rangeLabel = `${windowStart.getDate()} ${monthShort(windowStart)} – ${windowEnd.getDate()} ${monthShort(
        windowEnd
    )} ${windowEnd.getFullYear()}`;

    return (
        <div className="cal-tb">
            <div className="cal-tb__row">
                <div className="cal-tb__group">
                    <button className="cal-btn" onClick={props.onPrev} title="Previous period" aria-label="Previous">
                        ◀
                    </button>
                    <button className="cal-btn" onClick={props.onToday} title="Jump to today">
                        Today
                    </button>
                    <button className="cal-btn" onClick={props.onNext} title="Next period" aria-label="Next">
                        ▶
                    </button>
                    <span className="cal-tb__range">{rangeLabel}</span>
                    <input
                        className="cal-input"
                        type="date"
                        value={toISODate(windowStart)}
                        onChange={(e) => {
                            const v = e.target.value;
                            if (v) props.onJump(new Date(`${v}T00:00:00`));
                        }}
                        title="Jump to date"
                    />
                </div>

                <div className="cal-tb__group">
                    <select
                        className="cal-input"
                        value={props.view}
                        onChange={(e) => props.onView(e.target.value as ViewMode)}
                        title="Time window"
                    >
                        {VIEW_MODES.map((m) => (
                            <option key={m} value={m}>
                                {VIEW_CONFIGS[m].label}
                            </option>
                        ))}
                    </select>
                    <button className="cal-btn" onClick={props.onExpandAll} title="Expand all lanes">
                        Expand all
                    </button>
                    <button className="cal-btn" onClick={props.onCollapseAll} title="Collapse to roll-up">
                        Collapse
                    </button>
                </div>

                <div className="cal-tb__group cal-tb__group--right">
                    <button className="cal-btn" onClick={props.onExport} title="Export visible events to CSV">
                        Export
                    </button>
                    <button className="cal-btn" onClick={props.onPrint} title="Print the calendar">
                        Print
                    </button>
                </div>
            </div>

            <div className="cal-tb__row">
                {LEVELS.map((level) => (
                    <select
                        key={level}
                        className="cal-input"
                        value={props.orgFilters[level]}
                        onChange={(e) => props.onOrgFilter(level, e.target.value)}
                        title={`Filter by ${level}`}
                    >
                        <option value="">All {level}s</option>
                        {props.orgOptions[level].map((name) => (
                            <option key={name} value={name}>
                                {name}
                            </option>
                        ))}
                    </select>
                ))}
                <select
                    className="cal-input"
                    value={props.typeFilter}
                    onChange={(e) => props.onTypeFilter(e.target.value)}
                    title="Filter by event type"
                >
                    <option value="">All types</option>
                    {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                            {t}
                        </option>
                    ))}
                </select>
                <input
                    className="cal-input"
                    type="search"
                    placeholder="Search events…"
                    value={props.keyword}
                    onChange={(e) => props.onKeyword(e.target.value)}
                />
            </div>

            <div className="cal-tb__summary">
                <span className="cal-tb__count">{props.totalShown} event(s)</span>
                {EVENT_TYPES.filter((t) => (props.typeCounts[t] ?? 0) > 0).map((t) => (
                    <span className="cal-legend" key={t}>
                        <span className="cal-legend__swatch" style={{ backgroundColor: colorFor(t) }} />
                        {t}: {props.typeCounts[t]}
                    </span>
                ))}
                <span className="cal-legend" title="A diamond on a due date marks an event due-out">
                    <span className="cal-legend__glyph cal-legend__glyph--dueout">◆</span>
                    Due-Out
                </span>
                <span className="cal-legend" title="A (T) after an event name marks it Tentative">
                    <span className="cal-legend__glyph">(T)</span>
                    Tentative
                </span>
                {props.busy && <span className="cal-tb__busy">Saving…</span>}
                {props.error && <span className="cal-tb__error">{props.error}</span>}
            </div>
        </div>
    );
};
