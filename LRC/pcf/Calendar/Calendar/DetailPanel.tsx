import * as React from "react";
import { CalEvent, DueOut, LEVELS, colorFor } from "./types";
import { formatRangeNoYear } from "./dateUtils";

export interface DetailPanelProps {
    event: CalEvent;
    dueOuts: DueOut[];
    onClose: () => void;
    onOpen: () => void;
}

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) =>
    value ? (
        <div className="cal-dp__field">
            <div className="cal-dp__label">{label}</div>
            <div className="cal-dp__value">{value}</div>
        </div>
    ) : null;

// Rich-text (HTML) field. Dataverse stores rich-text columns as raw HTML
// authored through Power Apps' rich-text editor; render it as markup.
const HtmlField: React.FC<{ label: string; html: string }> = ({ label, html }) => {
    const stripped = html.replace(/<[^>]+>/g, "").trim();
    if (!stripped) return null;
    return (
        <div className="cal-dp__field">
            <div className="cal-dp__label">{label}</div>
            <div className="cal-dp__html" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
    );
};

export const DetailPanel: React.FC<DetailPanelProps> = ({ event, dueOuts, onClose, onOpen }) => {
    const sorted = [...dueOuts].sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0));
    return (
        <div className="cal-dp">
            <div className="cal-dp__head" style={{ borderTopColor: colorFor(event.type) }}>
                <div className="cal-dp__title">{event.name}</div>
                <div className="cal-dp__actions">
                    <button className="cal-dp__open" onClick={onOpen} title="Open event record">
                        Open
                    </button>
                    <button className="cal-dp__close" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </div>
            </div>
            <div className="cal-dp__body">
                <Field label="Type" value={event.type} />
                <Field label="Dates" value={formatRangeNoYear(event.start, event.end)} />
                {LEVELS.map((level) => (
                    <Field key={level} label={level} value={event.orgs[level]?.name ?? ""} />
                ))}
                <Field label="Location" value={event.location} />
                <HtmlField label="Description" html={event.description} />
                <Field label="POC" value={event.pocName} />
                <Field label="Email" value={event.pocEmail} />
                <Field label="Phone" value={event.pocPhone} />

                <div className="cal-dp__field">
                    <div className="cal-dp__label">Due-Outs ({sorted.length})</div>
                    {sorted.length === 0 && <div className="cal-dp__value cal-dp__muted">None</div>}
                    {sorted.map((d) => (
                        <div className={`cal-dp__dueout${d.completed ? " cal-dp__dueout--done" : ""}`} key={d.id}>
                            <span className="cal-dp__duedate">
                                {d.due ? formatRangeNoYear(d.due, null) : "—"}
                            </span>
                            <span className="cal-dp__duetask">{d.task}</span>
                            {d.completed && <span className="cal-dp__donetag">done</span>}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
