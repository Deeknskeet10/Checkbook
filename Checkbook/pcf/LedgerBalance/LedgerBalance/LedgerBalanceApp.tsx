import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
} from "@fluentui/react-components";

export interface LedgerBalanceProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  navigation: ComponentFramework.Navigation;
  webAPI?: ComponentFramework.WebApi;
  parentEntityName?: string;
  parentEntityId?: string;
  parentEntityName_record?: string;
}

const fmtMoney = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (d: Date | null): string => {
  if (!d) return "";
  return d.toLocaleDateString("en-US", { year: "2-digit", month: "short", day: "numeric" });
};

function getDirection(
  r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord
): "credit" | "debit" {
  // book_ledgerdirection picklist; the formatted value typically reads "Credit" / "Debit".
  const formatted = (r.getFormattedValue("direction") || "").toLowerCase();
  if (formatted.startsWith("c")) return "credit";
  if (formatted.startsWith("d")) return "debit";
  // Fall back: positive amount → credit, negative → debit
  const v = (r.getValue("amount") as number | null) ?? 0;
  return v >= 0 ? "credit" : "debit";
}

function colorForType(label: string): string {
  // categorical Fluent palette by transaction type
  const colors = ["#4F6BED", "#73AA24", "#CC4A31", "#9373C0", "#E0A45C", "#117865", "#0078D4", "#A4262C"];
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

function Sparkline({ values, w = 200, h = 36 }: { values: number[]; w?: number; h?: number }): React.ReactElement {
  if (values.length === 0) return <svg width={w} height={h} aria-hidden="true" />;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const stepX = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  // Zero baseline
  const zeroY = h - ((0 - min) / range) * h;
  return (
    <svg width={w} height={h} aria-label="balance over time">
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="#EDEBE9" strokeWidth={1} />
      <polyline points={pts.join(" ")} fill="none" stroke="#4F6BED" strokeWidth={1.5} />
    </svg>
  );
}

export const LedgerBalanceApp: React.FC<LedgerBalanceProps> = (props) => {
  const { dataset, navigation, webAPI, parentEntityName, parentEntityId, parentEntityName_record } = props;

  // Opening balance comes from the parent LOA (book_fundingline.book_newtdp).
  // For any other host, opening balance is 0.
  const [openingBalance, setOpeningBalance] = React.useState<number>(0);
  const [openingBalanceLabel, setOpeningBalanceLabel] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!webAPI || !parentEntityId || parentEntityName !== "book_fundingline") {
      setOpeningBalance(0);
      setOpeningBalanceLabel(null);
      return;
    }
    const id = parentEntityId.replace(/[{}]/g, "");
    webAPI
      .retrieveRecord("book_fundingline", id, "?$select=book_newtdp,book_tdp,book_name")
      .then((rec: any) => {
        const tdp = Number(rec.book_newtdp ?? rec.book_tdp ?? 0) || 0;
        setOpeningBalance(tdp);
        setOpeningBalanceLabel(`Opening TDP${rec.book_name ? ` (${rec.book_name})` : ""}`);
      })
      .catch(() => {
        setOpeningBalance(0);
        setOpeningBalanceLabel(null);
      });
  }, [webAPI, parentEntityName, parentEntityId]);

  // Sort by createdOn ascending so running balance accumulates left-to-right.
  // The dataset returns date columns as ISO strings; coerce to Date.
  const toDate = (v: any): Date | null => {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };
  const records = dataset.sortedRecordIds
    .map((id) => dataset.records[id])
    .map((r) => ({ r, date: toDate(r.getValue("createdOn")) }))
    .sort((a, b) => {
      const ta = a.date ? a.date.getTime() : 0;
      const tb = b.date ? b.date.getTime() : 0;
      return ta - tb;
    });

  let running = openingBalance;
  const rows = records.map(({ r, date }) => {
    const amount = (r.getValue("amount") as number | null) ?? 0;
    const direction = getDirection(r);
    const signed = direction === "debit" ? -Math.abs(amount) : Math.abs(amount);
    running += signed;
    return {
      id: r.getRecordId(),
      ref: r,
      date,
      name: (r.getValue("name") as string | null) || "(unnamed)",
      typeLabel: r.getFormattedValue("ledgerType") || "",
      loa:
        ((r.getValue("lineOfAccounting") as ComponentFramework.LookupValue[] | null)?.[0]?.name) ||
        ((r.getValue("lineOfAccounting") as any)?.name) ||
        "",
      fy: r.getFormattedValue("fiscalYear") || "",
      direction,
      signed,
      balance: running,
    };
  });

  const balances = rows.map((r) => r.balance);
  const finalBalance = rows.length > 0 ? rows[rows.length - 1].balance : 0;
  const totalDebit = rows.filter((r) => r.signed < 0).reduce((s, r) => s + Math.abs(r.signed), 0);
  const totalCredit = rows.filter((r) => r.signed > 0).reduce((s, r) => s + r.signed, 0);

  // Reverse the visual order so most recent appears at top (statement style)
  const visible = [...rows].reverse();

  const onOpen = (id: string) => {
    navigation
      .openForm({ entityName: "book_ledger", entityId: id, openInNewWindow: false })
      .catch(() => {});
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-ledger-balance"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            Ledger{parentEntityName_record ? ` · ${parentEntityName_record}` : ""}
          </span>
          <Badge appearance="outline" color="informative" size="medium">
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </Badge>
          {openingBalanceLabel && (
            <Badge appearance="tint" color="informative" size="medium">
              {openingBalanceLabel}: {fmtMoney(openingBalance)}
            </Badge>
          )}
          <span style={{ color: "#107C10", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
            + {fmtMoney(totalCredit)}
          </span>
          <span style={{ color: "#A4262C", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
            − {fmtMoney(totalDebit)}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ color: "#605E5C", fontSize: 12 }}>Balance</span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: finalBalance >= 0 ? "#107C10" : "#A4262C",
            }}
          >
            {fmtMoney(finalBalance)}
          </span>
        </div>

        {rows.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <Sparkline values={balances} w={1000} h={40} />
          </div>
        )}

        {rows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No ledger entries in scope.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
            <thead>
              <tr style={{ background: "#F3F2F1", textAlign: "left" }}>
                <th style={{ padding: "6px 8px", width: 90 }}>Date</th>
                <th style={{ padding: "6px 8px", width: 110 }}>Type</th>
                <th style={{ padding: "6px 8px" }}>Description / LOA</th>
                <th style={{ padding: "6px 8px", width: 50 }}>FY</th>
                <th style={{ padding: "6px 8px", textAlign: "right", width: 110 }}>Debit</th>
                <th style={{ padding: "6px 8px", textAlign: "right", width: 110 }}>Credit</th>
                <th style={{ padding: "6px 8px", textAlign: "right", width: 130 }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const debit = row.signed < 0 ? Math.abs(row.signed) : null;
                const credit = row.signed > 0 ? row.signed : null;
                const c = colorForType(row.typeLabel);
                return (
                  <tr
                    key={row.id}
                    style={{ borderBottom: "1px solid #EDEBE9", cursor: "pointer" }}
                    onClick={() => onOpen(row.id)}
                  >
                    <td style={{ padding: "6px 8px", color: "#605E5C", fontSize: 12 }}>
                      {fmtDate(row.date)}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.typeLabel ? (
                        <Badge appearance="tint" color="informative" style={{ background: `${c}22`, color: c }}>
                          {row.typeLabel}
                        </Badge>
                      ) : (
                        <span style={{ color: "#A19F9D" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.name}
                      </div>
                      {row.loa && (
                        <div style={{ color: "#605E5C", fontSize: 11 }}>{row.loa}</div>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#605E5C" }}>{row.fy}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#A4262C" }}>
                      {debit != null ? fmtMoney(debit) : ""}
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#107C10" }}>
                      {credit != null ? fmtMoney(credit) : ""}
                    </td>
                    <td
                      style={{
                        padding: "6px 8px",
                        textAlign: "right",
                        fontWeight: 600,
                        color: row.balance >= 0 ? "#323130" : "#A4262C",
                      }}
                    >
                      {fmtMoney(row.balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </FluentProvider>
  );
};
