import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Dropdown,
  Option,
} from "@fluentui/react-components";

type GroupBy = "fundCenter" | "fund" | "fundingType" | "disbursementDirection" | "month";

export interface DistributionsDonutProps {
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

// Fluent-ish categorical palette, repeated as needed
const PALETTE = [
  "#4F6BED", "#6264A7", "#9373C0", "#CC4A31", "#E0A45C",
  "#73AA24", "#117865", "#038387", "#0078D4", "#8764B8",
  "#B146C2", "#CA5010", "#A4262C", "#498205", "#005B70",
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
    case "fundCenter":
      return getLookupName(r, "fundCenter") || "(no fund center)";
    case "fund":
      return getLookupName(r, "fund") || "(no fund)";
    case "fundingType":
      return r.getFormattedValue("fundingType") || "(no funding type)";
    case "disbursementDirection":
      return r.getFormattedValue("disbursementDirection") || "(no direction)";
    case "month":
      return (r.getValue("month") as string | null) || "(no month)";
  }
}

const GROUP_LABELS: { [K in GroupBy]: string } = {
  fundCenter: "Fund Center",
  fund: "Fund",
  fundingType: "Funding Type",
  disbursementDirection: "Disbursement Direction",
  month: "Month",
};

function donutPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const sweep = endAngle - startAngle;
  // Avoid the 360-degree degenerate case
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

export const DistributionsDonutApp: React.FC<DistributionsDonutProps> = (props) => {
  const { dataset, defaultGroupBy } = props;
  const [groupBy, setGroupBy] = React.useState<GroupBy>(defaultGroupBy);
  const [hoverKey, setHoverKey] = React.useState<string | null>(null);

  const records = dataset.sortedRecordIds.map((id) => dataset.records[id]);

  const slices: Slice[] = React.useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const r of records) {
      const key = groupValue(r, groupBy);
      const amt = (r.getValue("amount") as number | null) ?? 0;
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

  let runningAngle = 0;
  const paths = slices.map((s) => {
    const sweep = total > 0 ? (s.amount / total) * 360 : 0;
    const start = runningAngle;
    const end = runningAngle + sweep;
    runningAngle = end;
    return { slice: s, d: donutPath(110, 110, 100, 60, start, end), midAngle: (start + end) / 2 };
  });

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-distributions-donut"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Distributions</span>
          <Badge appearance="outline" color="informative" size="medium">
            {records.length} rows · {fmtMoney(total)}
          </Badge>
          <div style={{ flex: 1 }} />
          <span style={{ color: "#605E5C" }}>Group by</span>
          <Dropdown
            size="small"
            value={GROUP_LABELS[groupBy]}
            selectedOptions={[groupBy]}
            onOptionSelect={(_, d) => setGroupBy((d.optionValue as GroupBy) || "fundCenter")}
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
            No distribution rows in scope.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            <svg width={220} height={220} viewBox="0 0 220 220" aria-label="Distribution donut">
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
              {/* Center label */}
              <text x={110} y={106} textAnchor="middle" fontSize={11} fill="#605E5C">
                Total
              </text>
              <text x={110} y={124} textAnchor="middle" fontSize={16} fontWeight={600} fill="#323130">
                {fmtMoney(total)}
              </text>
            </svg>

            <div style={{ flex: 1, minWidth: 0 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#F3F2F1", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px", width: 16 }} aria-label="color" />
                    <th style={{ padding: "6px 8px" }}>{GROUP_LABELS[groupBy]}</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Rows</th>
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
                          <span
                            style={{
                              display: "inline-block",
                              width: 10,
                              height: 10,
                              borderRadius: 2,
                              background: s.color,
                            }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {s.label}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {s.count}
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {fmtMoney(s.amount)}
                        </td>
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
