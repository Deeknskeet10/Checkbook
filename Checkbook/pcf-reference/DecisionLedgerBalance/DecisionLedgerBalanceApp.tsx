import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
} from "@fluentui/react-components";

export interface DecisionLedgerBalanceProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  parentEntityName?: string;
  parentEntityId?: string;
  parentRecordName?: string;
}

interface Row {
  id: string;
  date: Date | null;
  name: string;
  eventName: string;
  amount: number;          // signed: + = credit/increase, - = debit/decrease
  balance: number;
}

const fmtMoney = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (d: Date | null): string =>
  d ? d.toLocaleDateString("en-US", { year: "2-digit", month: "short", day: "numeric" }) : "";

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

function getLookupName(v: any): string {
  if (!v) return "";
  if (Array.isArray(v)) return v[0]?.name || "";
  return v.name || "";
}

function colorForLabel(label: string): string {
  const colors = ["#4F6BED", "#73AA24", "#9373C0", "#E0A45C", "#117865", "#0078D4", "#CC4A31"];
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
  const zeroY = h - ((0 - min) / range) * h;
  return (
    <svg width={w} height={h} aria-label="balance over time">
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="#EDEBE9" strokeWidth={1} />
      <polyline points={pts.join(" ")} fill="none" stroke="#4F6BED" strokeWidth={1.5} />
    </svg>
  );
}

export const DecisionLedgerBalanceApp: React.FC<DecisionLedgerBalanceProps> = (props) => {
  const { dataset, webAPI, navigation, parentEntityName, parentEntityId, parentRecordName } = props;

  // Opening balance + target final balance come from the parent FundingTrack.
  const [openingBalance, setOpeningBalance] = React.useState<number>(0);
  const [targetBalance, setTargetBalance] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!webAPI || !parentEntityId || parentEntityName !== "book_fundingtrack") {
      setOpeningBalance(0);
      setTargetBalance(null);
      return;
    }
    const id = parentEntityId.replace(/[{}]/g, "");
    webAPI
      .retrieveRecord(
        "book_fundingtrack",
        id,
        "?$select=book_beginningbalancereadonly,book_newresourceamount,book_resourceamount,book_newdecisiontotal"
      )
      .then((rec: any) => {
        const begin = Number(rec.book_beginningbalancereadonly ?? 0) || 0;
        const target =
          Number(rec.book_newresourceamount ?? rec.book_resourceamount ?? NaN);
        setOpeningBalance(begin);
        setTargetBalance(isNaN(target) ? null : target);
      })
      .catch(() => {
        setOpeningBalance(0);
        setTargetBalance(null);
      });
  }, [webAPI, parentEntityName, parentEntityId]);

  // Sort by createdOn ascending; running total accumulates left-to-right
  const records = dataset.sortedRecordIds
    .map((id) => dataset.records[id])
    .map((r) => ({ r, date: toDate(r.getValue("createdOn")) }))
    .sort((a, b) => {
      const ta = a.date ? a.date.getTime() : 0;
      const tb = b.date ? b.date.getTime() : 0;
      return ta - tb;
    });

  let running = openingBalance;
  const rows: Row[] = records.map(({ r, date }) => {
    const amount = (r.getValue("amount") as number | null) ?? 0;
    running += amount;
    return {
      id: r.getRecordId(),
      date,
      name: (r.getValue("name") as string | null) || "(unnamed)",
      eventName: getLookupName(r.getValue("event")),
      amount,
      balance: running,
    };
  });

  const balances = [openingBalance, ...rows.map((r) => r.balance)];
  const finalBalance = rows.length > 0 ? rows[rows.length - 1].balance : openingBalance;
  const totalIncrease = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const totalDecrease = rows.filter((r) => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);

  // Newest first for the statement table
  const visible = [...rows].reverse();

  const onOpen = (id: string) => {
    navigation
      .openForm({ entityName: "book_decision", entityId: id, openInNewWindow: false })
      .catch(() => {});
  };

  const targetMismatch =
    targetBalance != null && Math.abs(finalBalance - targetBalance) > 0.005;

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-decision-ledger"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            Decision Ledger{parentRecordName ? ` · ${parentRecordName}` : ""}
          </span>
          <Badge appearance="outline" color="informative" size="medium">
            {rows.length} {rows.length === 1 ? "decision" : "decisions"}
          </Badge>
          <Badge appearance="tint" color="informative" size="medium">
            Opening: {fmtMoney(openingBalance)}
          </Badge>
          <span style={{ color: "#107C10", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
            + {fmtMoney(totalIncrease)}
          </span>
          <span style={{ color: "#A4262C", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
            − {fmtMoney(totalDecrease)}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ color: "#605E5C", fontSize: 12 }}>Resource Amount</span>
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
          {targetBalance != null && (
            <Badge
              appearance="tint"
              color={targetMismatch ? "warning" : "success"}
              title={`Funding Track says: ${fmtMoney(targetBalance)}`}
            >
              {targetMismatch
                ? `≠ track (${fmtMoney(targetBalance)})`
                : "matches track ✓"}
            </Badge>
          )}
        </div>

        <Sparkline values={balances} w={1000} h={40} />

        {rows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No decisions yet — the resource amount equals the opening balance.
          </div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid #EDEBE9", borderRadius: 4, marginTop: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F3F2F1", color: "#323130" }}>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Decision Event</th>
                  <th style={thStyleNum}>+ Increase</th>
                  <th style={thStyleNum}>− Decrease</th>
                  <th style={thStyleNum}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onOpen(row.id)}
                    style={{ borderTop: "1px solid #EDEBE9", cursor: "pointer" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = "#F3F2F1")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLTableRowElement).style.background = "#FFFFFF")}
                  >
                    <td style={tdStyle}>{fmtDate(row.date)}</td>
                    <td style={tdStyle}>{row.name}</td>
                    <td style={tdStyle}>
                      {row.eventName && (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 10,
                            fontSize: 11,
                            color: "#FFFFFF",
                            background: colorForLabel(row.eventName),
                          }}
                        >
                          {row.eventName}
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdStyleNum, color: row.amount > 0 ? "#107C10" : "#A19F9D" }}>
                      {row.amount > 0 ? fmtMoney(row.amount) : ""}
                    </td>
                    <td style={{ ...tdStyleNum, color: row.amount < 0 ? "#A4262C" : "#A19F9D" }}>
                      {row.amount < 0 ? fmtMoney(Math.abs(row.amount)) : ""}
                    </td>
                    <td
                      style={{
                        ...tdStyleNum,
                        fontWeight: 600,
                        color: row.balance >= 0 ? "#323130" : "#A4262C",
                      }}
                    >
                      {fmtMoney(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#FAF9F8", fontWeight: 700, borderTop: "2px solid #EDEBE9" }}>
                  <td style={tdStyle} colSpan={3}>Opening + Decisions = Resource Amount</td>
                  <td style={tdStyleNum}>{fmtMoney(totalIncrease)}</td>
                  <td style={tdStyleNum}>{fmtMoney(totalDecrease)}</td>
                  <td style={{ ...tdStyleNum, color: finalBalance >= 0 ? "#107C10" : "#A4262C" }}>
                    {fmtMoney(finalBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </FluentProvider>
  );
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  borderBottom: "1px solid #EDEBE9",
};
const thStyleNum: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "8px 12px", verticalAlign: "middle" };
const tdStyleNum: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
