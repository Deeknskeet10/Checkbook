import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
  Tooltip,
} from "@fluentui/react-components";

export interface FundingTrackTimelineProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  navigation: ComponentFramework.Navigation;
}

interface Event {
  id: string;
  name: string;
  start: Date;
  end: Date;
  fundingType: string | null;
  fiscalYear: string | null;
  description: string | null;
}

const PALETTE = ["#4F6BED", "#73AA24", "#CC4A31", "#9373C0", "#E0A45C", "#117865", "#0078D4", "#A4262C", "#8764B8", "#498205"];

function colorFor(label: string | null): string {
  const t = label || "default";
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const fmtMonth = (d: Date): string =>
  d.toLocaleDateString("en-US", { month: "short" });

const fmtDate = (d: Date): string =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

function fiscalYearStart(date: Date): Date {
  // Federal FY: Oct 1 of (year - 1) if month < Oct, else Oct 1 of (year)
  const y = date.getMonth() < 9 ? date.getFullYear() - 1 : date.getFullYear();
  return new Date(y, 9, 1); // Oct 1
}

export const FundingTrackTimelineApp: React.FC<FundingTrackTimelineProps> = (props) => {
  const { dataset, navigation } = props;

  const toDate = (v: any): Date | null => {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };
  const events: Event[] = dataset.sortedRecordIds
    .map((id) => dataset.records[id])
    .map((r) => {
      const start = toDate(r.getValue("startDate"));
      const end = toDate(r.getValue("endDate")) ?? start;
      if (!start || !end) return null;
      return {
        id: r.getRecordId(),
        name: (r.getValue("name") as string | null) || "(unnamed)",
        start,
        end,
        fundingType: r.getFormattedValue("fundingType") ?? null,
        fiscalYear: r.getFormattedValue("fiscalYear") ?? null,
        description: (r.getValue("description") as string | null) ?? null,
      };
    })
    .filter(Boolean) as Event[];

  if (events.length === 0) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div style={{ padding: 12, color: "#605E5C" }}>
          No funding events with start dates in scope.
        </div>
      </FluentProvider>
    );
  }

  // Determine timeline range: anchor to the FY of the earliest event start;
  // span 12 months from FY start (Oct 1 → Sep 30).
  const earliestStart = events.reduce(
    (acc, e) => (e.start < acc ? e.start : acc),
    events[0].start
  );
  const fyStart = fiscalYearStart(earliestStart);
  const fyEnd = new Date(fyStart.getFullYear() + 1, 9, 1); // next Oct 1

  // Extend if any event ends after fyEnd (multi-FY visibility)
  const latestEnd = events.reduce((acc, e) => (e.end > acc ? e.end : acc), events[0].end);
  const rangeEnd = latestEnd > fyEnd ? latestEnd : fyEnd;

  const totalMs = rangeEnd.getTime() - fyStart.getTime();
  const W = 1000;
  const ROW_H = 28;

  const xFor = (d: Date): number => {
    const ms = Math.max(fyStart.getTime(), Math.min(rangeEnd.getTime(), d.getTime()));
    return ((ms - fyStart.getTime()) / totalMs) * W;
  };

  // Lay out events in lanes — greedy first-fit so they don't overlap visually
  const lanes: Event[][] = [];
  for (const e of [...events].sort((a, b) => a.start.getTime() - b.start.getTime())) {
    let placed = false;
    for (const lane of lanes) {
      if (lane[lane.length - 1].end.getTime() <= e.start.getTime()) {
        lane.push(e);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([e]);
  }
  const H = Math.max(80, lanes.length * (ROW_H + 6) + 30);

  // Month tick positions
  const months: { x: number; label: string; date: Date }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(fyStart.getFullYear(), fyStart.getMonth() + i, 1);
    if (d > rangeEnd) break;
    months.push({ x: xFor(d), label: fmtMonth(d), date: d });
  }

  const today = new Date();
  const todayX = today >= fyStart && today <= rangeEnd ? xFor(today) : null;

  const onOpen = (id: string): void => {
    navigation
      .openForm({ entityName: "book_fundingevent", entityId: id, openInNewWindow: false })
      .catch(() => {});
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-funding-track"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Funding Track</span>
          <Badge appearance="outline" color="informative" size="medium">
            {events.length} {events.length === 1 ? "event" : "events"} · FY{(fyStart.getFullYear() + 1).toString().slice(-2)}
          </Badge>
          <span style={{ color: "#605E5C", fontSize: 12 }}>
            {fmtDate(fyStart)} → {fmtDate(rangeEnd)}
          </span>
        </div>

        <div style={{ overflowX: "auto", border: "1px solid #EDEBE9", borderRadius: 4 }}>
          <svg width={W} height={H} style={{ display: "block" }} aria-label="Funding events timeline">
            {/* Month gridlines + labels */}
            {months.map((m, i) => (
              <g key={i}>
                <line x1={m.x} y1={0} x2={m.x} y2={H - 22} stroke="#F3F2F1" strokeWidth={1} />
                <text x={m.x + 4} y={H - 8} fontSize={11} fill="#605E5C">
                  {m.label}
                </text>
              </g>
            ))}

            {/* Today line */}
            {todayX != null && (
              <g>
                <line x1={todayX} y1={0} x2={todayX} y2={H - 22} stroke="#A4262C" strokeWidth={1} strokeDasharray="3 3" />
                <text x={todayX + 4} y={12} fontSize={10} fill="#A4262C">
                  today
                </text>
              </g>
            )}

            {/* Event bars */}
            {lanes.map((lane, laneIdx) =>
              lane.map((e) => {
                const x1 = xFor(e.start);
                const x2 = Math.max(x1 + 6, xFor(e.end));
                const y = laneIdx * (ROW_H + 6) + 4;
                const c = colorFor(e.fundingType);
                return (
                  <g key={e.id} style={{ cursor: "pointer" }} onClick={() => onOpen(e.id)}>
                    <title>{`${e.name}\n${fmtDate(e.start)} → ${fmtDate(e.end)}${
                      e.fundingType ? `\nType: ${e.fundingType}` : ""
                    }${e.description ? `\n\n${e.description.slice(0, 200)}` : ""}`}</title>
                    <rect
                      x={x1}
                      y={y}
                      width={x2 - x1}
                      height={ROW_H}
                      fill={c}
                      fillOpacity={0.85}
                      rx={3}
                      ry={3}
                    />
                    {x2 - x1 > 60 && (
                      <text
                        x={x1 + 6}
                        y={y + ROW_H / 2 + 4}
                        fontSize={11}
                        fontWeight={600}
                        fill="#FFFFFF"
                      >
                        {e.name.slice(0, Math.floor((x2 - x1) / 7))}
                      </text>
                    )}
                  </g>
                );
              })
            )}
          </svg>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          {Array.from(new Set(events.map((e) => e.fundingType || "(no type)"))).map((t) => (
            <span key={t} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#605E5C" }}>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  background: colorFor(t === "(no type)" ? null : t),
                  borderRadius: 2,
                }}
              />
              {t}
            </span>
          ))}
        </div>
      </div>
    </FluentProvider>
  );
};
