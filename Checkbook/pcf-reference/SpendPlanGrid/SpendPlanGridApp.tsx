import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
} from "@fluentui/react-components";

export interface SpendPlanGridProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  navigation: ComponentFramework.Navigation;
}

// Fiscal-year order (Oct-Sep)
const MONTHS: { col: string; short: string }[] = [
  { col: "october",   short: "Oct" },
  { col: "november",  short: "Nov" },
  { col: "december",  short: "Dec" },
  { col: "january",   short: "Jan" },
  { col: "february",  short: "Feb" },
  { col: "march",     short: "Mar" },
  { col: "april",     short: "Apr" },
  { col: "may",       short: "May" },
  { col: "june",      short: "Jun" },
  { col: "july",      short: "Jul" },
  { col: "august",    short: "Aug" },
  { col: "september", short: "Sep" },
];

const fmtMoney = (n: number): string => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `$${(n / 1000).toFixed(0)}K`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};

function getLookupName(
  r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
  col: string
): string | null {
  const raw: any = r.getValue(col);
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v?.name ?? r.getFormattedValue(col) ?? null;
}

function readMonths(r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord): number[] {
  return MONTHS.map((m) => (r.getValue(m.col) as number | null) ?? 0);
}

function Sparkline({ values, max, color }: { values: number[]; max: number; color: string }): React.ReactElement {
  const w = 110, h = 24, pad = 2;
  if (max <= 0) {
    return <svg width={w} height={h} aria-hidden="true" />;
  }
  const stepX = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} aria-label="monthly profile">
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
    </svg>
  );
}

function cellBgFor(v: number, rowMax: number): string {
  if (v <= 0 || rowMax <= 0) return "transparent";
  const intensity = Math.min(1, v / rowMax);
  // Tint of Fluent blue (#4F6BED). Background opacity 0.08 → 0.45.
  const opacity = 0.08 + intensity * 0.37;
  return `rgba(79, 107, 237, ${opacity.toFixed(3)})`;
}

export const SpendPlanGridApp: React.FC<SpendPlanGridProps> = (props) => {
  const { dataset, navigation } = props;
  const records = dataset.sortedRecordIds.map((id) => dataset.records[id]);

  const rows = records.map((r) => {
    const months = readMonths(r);
    const sum = months.reduce((s, x) => s + x, 0);
    const declaredTotal = (r.getValue("total") as number | null) ?? null;
    const totalMatches = declaredTotal == null ? true : Math.abs(declaredTotal - sum) < 0.5;
    return {
      id: r.getRecordId(),
      name: (r.getValue("name") as string | null) || "(unnamed)",
      loa: getLookupName(r, "lineOfAccounting"),
      requirement: getLookupName(r, "requirement"),
      months,
      monthsMax: Math.max(0, ...months),
      sum,
      declaredTotal,
      totalMatches,
      ref: r,
    };
  });

  // Column totals (across all rows for each month)
  const colTotals = MONTHS.map((_, idx) => rows.reduce((s, row) => s + row.months[idx], 0));
  const grandTotal = colTotals.reduce((s, x) => s + x, 0);

  // Color scale: use the max cell value across the grid for cell intensity
  const gridMax = Math.max(0, ...rows.flatMap((r) => r.months));

  const onOpen = (id: string): void => {
    navigation
      .openForm({ entityName: "book_spendplan", entityId: id, openInNewWindow: false })
      .then(() => dataset.refresh())
      .catch(() => {});
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-spendplan-grid"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Spend Plan</span>
          <Badge appearance="outline" color="informative" size="medium">
            {rows.length} {rows.length === 1 ? "plan" : "plans"} · {fmtMoney(grandTotal)}
          </Badge>
        </div>

        {rows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No spend plans in scope.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr style={{ background: "#F3F2F1", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", position: "sticky", left: 0, background: "#F3F2F1", zIndex: 1, minWidth: 180 }}>Plan</th>
                  {MONTHS.map((m) => (
                    <th key={m.col} style={{ padding: "6px 6px", textAlign: "right", minWidth: 64 }}>{m.short}</th>
                  ))}
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Total</th>
                  <th style={{ padding: "6px 8px", textAlign: "center" }}>Profile</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid #EDEBE9" }}>
                    <td
                      style={{
                        padding: "6px 8px",
                        position: "sticky",
                        left: 0,
                        background: "#FFFFFF",
                        zIndex: 1,
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={[row.name, row.requirement, row.loa].filter(Boolean).join(" · ")}
                    >
                      <Button
                        size="small"
                        appearance="subtle"
                        onClick={() => onOpen(row.id)}
                        style={{ padding: 0, height: "auto", minWidth: 0, justifyContent: "flex-start" }}
                      >
                        {row.name}
                      </Button>
                      {row.requirement && (
                        <div style={{ color: "#605E5C", fontSize: 11 }}>{row.requirement}</div>
                      )}
                    </td>
                    {row.months.map((v, i) => (
                      <td
                        key={i}
                        style={{
                          padding: "6px 6px",
                          textAlign: "right",
                          background: cellBgFor(v, gridMax),
                          color: v > 0 ? "#323130" : "#A19F9D",
                        }}
                      >
                        {v > 0 ? fmtMoney(v) : "—"}
                      </td>
                    ))}
                    <td
                      style={{
                        padding: "6px 8px",
                        textAlign: "right",
                        fontWeight: 600,
                        color: row.totalMatches ? "#323130" : "#A4262C",
                      }}
                      title={
                        row.totalMatches
                          ? undefined
                          : `Sum of months (${fmtMoney(row.sum)}) doesn't match declared total (${fmtMoney(row.declaredTotal ?? 0)})`
                      }
                    >
                      {fmtMoney(row.sum)}
                      {!row.totalMatches && <span style={{ marginLeft: 4 }}>!</span>}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <Sparkline values={row.months} max={row.monthsMax} color="#4F6BED" />
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr style={{ background: "#FAF9F8", fontWeight: 600 }}>
                  <td style={{ padding: "8px", position: "sticky", left: 0, background: "#FAF9F8", zIndex: 1 }}>
                    Total
                  </td>
                  {colTotals.map((t, i) => (
                    <td key={i} style={{ padding: "8px 6px", textAlign: "right" }}>
                      {t > 0 ? fmtMoney(t) : "—"}
                    </td>
                  ))}
                  <td style={{ padding: "8px", textAlign: "right" }}>{fmtMoney(grandTotal)}</td>
                  <td style={{ padding: "8px" }} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
