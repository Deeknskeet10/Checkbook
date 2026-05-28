import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Dropdown,
  Option,
} from "@fluentui/react-components";

type GroupBy = "ledgerType" | "direction" | "lineOfAccounting" | "fiscalYear" | "realignment" | "turnIn";

export interface LedgersDonutProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  defaultGroupBy: GroupBy;
}

interface Slice {
  key: string;
  label: string;
  amount: number;
  count: number;
  color: string;
}

const PALETTE = [
  "#0078D4", "#107C10", "#A4262C", "#C19C00", "#5C2D91",
  "#038387", "#CC4A31", "#73AA24", "#4F6BED", "#9373C0",
  "#E0A45C", "#6264A7", "#117865", "#8764B8", "#498205",
];

const fmtMoney = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function getLookupName(
  r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
  col: string
): string | null {
  const raw: any = r.getValue(col);
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v?.name ?? r.getFormattedValue(col) ?? null;
}

function groupValue(r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord, groupBy: GroupBy): string {
  switch (groupBy) {
    case "ledgerType":
      return r.getFormattedValue("ledgerType") || "(no type)";
    case "direction":
      return r.getFormattedValue("direction") || "(no direction)";
    case "lineOfAccounting":
      return getLookupName(r, "lineOfAccounting") || "(no LOA)";
    case "fiscalYear":
      return r.getFormattedValue("fiscalYear") || "(no FY)";
    case "realignment":
      return getLookupName(r, "realignment") || "(not a realignment)";
    case "turnIn":
      return getLookupName(r, "turnIn") || "(not a turn-in)";
  }
}

const GROUP_LABELS: { [K in GroupBy]: string } = {
  ledgerType: "Type",
  direction: "Direction",
  lineOfAccounting: "Line of Accounting",
  fiscalYear: "Fiscal Year",
  realignment: "Realignment",
  turnIn: "Turn-in",
};

function donutPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  if (sweep >= 360) {
    return [
      `M ${cx + rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy}`,
      `A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy}`,
      `M ${cx + rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy}`,
      `A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy}`,
      "Z",
    ].join(" ");
  }
  const toRad = (a: number) => (a - 90) * (Math.PI / 180);
  const x1o = cx + rOuter * Math.cos(toRad(startAngle));
  const y1o = cy + rOuter * Math.sin(toRad(startAngle));
  const x2o = cx + rOuter * Math.cos(toRad(endAngle));
  const y2o = cy + rOuter * Math.sin(toRad(endAngle));
  const x1i = cx + rInner * Math.cos(toRad(endAngle));
  const y1i = cy + rInner * Math.sin(toRad(endAngle));
  const x2i = cx + rInner * Math.cos(toRad(startAngle));
  const y2i = cy + rInner * Math.sin(toRad(startAngle));
  const largeArc = sweep > 180 ? 1 : 0;
  return [
    `M ${x1o} ${y1o}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2o} ${y2o}`,
    `L ${x1i} ${y1i}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x2i} ${y2i}`,
    "Z",
  ].join(" ");
}

export const LedgersDonutApp: React.FC<LedgersDonutProps> = (props) => {
  const { dataset, defaultGroupBy } = props;
  const [groupBy, setGroupBy] = React.useState<GroupBy>(defaultGroupBy);
  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  const records = dataset.sortedRecordIds.map((id) => dataset.records[id]);

  // Compute signed amount per row using book_ledgerdirection (Credit=positive, Debit=negative).
  // This way the donut still aggregates magnitudes by default (we use absolute values for slice
  // sizing) but reports a "net" total in the center label.
  const slices: Slice[] = React.useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const r of records) {
      const key = groupValue(r, groupBy);
      const amt = Math.abs((r.getValue("amount") as number | null) ?? 0);
      const cur = map.get(key) || { amount: 0, count: 0 };
      cur.amount += amt;
      cur.count += 1;
      map.set(key, cur);
    }
    const arr = Array.from(map.entries())
      .map(([label, v]) => ({ key: label, label, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount - a.amount);
    return arr.map((s, i) => ({ ...s, color: PALETTE[i % PALETTE.length] }));
  }, [records.length, groupBy, dataset.sortedRecordIds.join("|")]);

  const total = slices.reduce((s, x) => s + x.amount, 0);

  // Net = credits − debits (uses the direction picklist's formatted value)
  const net = React.useMemo(() => {
    let n = 0;
    for (const r of records) {
      const v = (r.getValue("amount") as number | null) ?? 0;
      const dir = (r.getFormattedValue("direction") || "").toLowerCase();
      const signed = dir.startsWith("d") ? -Math.abs(v) : Math.abs(v);
      n += signed;
    }
    return n;
  }, [records.length, dataset.sortedRecordIds.join("|")]);

  let runningAngle = 0;
  const paths = slices.map((s) => {
    const sweep = total > 0 ? (s.amount / total) * 360 : 0;
    const start = runningAngle;
    const end = runningAngle + sweep;
    runningAngle = end;
    return { slice: s, d: donutPath(110, 110, 100, 60, start, end) };
  });

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-ledgers-donut"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Ledgers</span>
          <Badge appearance="outline" color="informative" size="medium">
            {records.length} entries · gross {fmtMoney(total)}
          </Badge>
          <Badge appearance="tint" color={net >= 0 ? "success" : "danger"} size="medium">
            Net: {fmtMoney(net)}
          </Badge>
          <div style={{ flex: 1 }} />
          <span style={{ color: "#605E5C" }}>Group by</span>
          <Dropdown
            size="small"
            value={GROUP_LABELS[groupBy]}
            selectedOptions={[groupBy]}
            onOptionSelect={(_, d) => setGroupBy((d.optionValue as GroupBy) || "ledgerType")}
            style={{ minWidth: 180 }}
          >
            {(Object.keys(GROUP_LABELS) as GroupBy[]).map((k) => (
              <Option key={k} value={k}>
                {GROUP_LABELS[k]}
              </Option>
            ))}
          </Dropdown>
        </div>

        {records.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No ledger entries in scope.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <svg width={220} height={220} viewBox="0 0 220 220" aria-label="Ledger donut">
              {paths.map((p) => (
                <path
                  key={p.slice.key}
                  d={p.d}
                  fill={p.slice.color}
                  fillOpacity={hoverKey == null || hoverKey === p.slice.key ? 1 : 0.35}
                  stroke="#fff"
                  strokeWidth={1}
                  onMouseEnter={() => setHoverKey(p.slice.key)}
                  onMouseLeave={() => setHoverKey(null)}
                />
              ))}
              <text x={110} y={102} textAnchor="middle" fontSize={11} fill="#605E5C">
                Gross
              </text>
              <text x={110} y={120} textAnchor="middle" fontSize={15} fontWeight={600} fill="#323130">
                {fmtMoney(total)}
              </text>
              <text x={110} y={138} textAnchor="middle" fontSize={11} fill={net >= 0 ? "#107C10" : "#A4262C"}>
                net {fmtMoney(net)}
              </text>
            </svg>

            <div style={{ flex: 1, minWidth: 0 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F3F2F1", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px", width: 16 }} aria-label="color" />
                    <th style={{ padding: "6px 8px" }}>{GROUP_LABELS[groupBy]}</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Entries</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Amount</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {slices.map((s) => {
                    const pct = total > 0 ? (s.amount / total) * 100 : 0;
                    const dim = hoverKey != null && hoverKey !== s.key;
                    return (
                      <tr
                        key={s.key}
                        style={{
                          borderBottom: "1px solid #EDEBE9",
                          opacity: dim ? 0.4 : 1,
                          cursor: "default",
                        }}
                        onMouseEnter={() => setHoverKey(s.key)}
                        onMouseLeave={() => setHoverKey(null)}
                      >
                        <td style={{ padding: "6px 8px" }}>
                          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: s.color }} />
                        </td>
                        <td style={{ padding: "6px 8px", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {s.label}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{s.count}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(s.amount)}</td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#605E5C" }}>
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
