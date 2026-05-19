import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
} from "@fluentui/react-components";

export interface PendingRealignmentsQueueProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  navigation: ComponentFramework.Navigation;
}

interface Row {
  id: string;
  name: string;
  amount: number;
  status: string;
  debitFrom: string;
  creditTo: string;
  payerConcur: string;
  payeeConcur: string;
  stateApproved: boolean | null;
}

const fmtMoney = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function getLookupName(
  r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
  col: string
): string {
  const raw: any = r.getValue(col);
  if (!raw) return "";
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v?.name ?? r.getFormattedValue(col) ?? "";
}

function concurColor(label: string): "success" | "danger" | "warning" | "informative" {
  const t = (label || "").toLowerCase();
  if (t.includes("concur") && !t.includes("non")) return "success";
  if (t.includes("non") || t.includes("reject") || t.includes("deny")) return "danger";
  if (t.includes("pend") || t.includes("review")) return "warning";
  return "informative";
}

export const PendingRealignmentsQueueApp: React.FC<PendingRealignmentsQueueProps> = (props) => {
  const { dataset, navigation } = props;

  const rows: Row[] = dataset.sortedRecordIds
    .map((id) => dataset.records[id])
    .map((r) => ({
      id: r.getRecordId(),
      name: (r.getValue("name") as string | null) || "(unnamed)",
      amount: (r.getValue("amount") as number | null) ?? 0,
      status: r.getFormattedValue("status") ?? "",
      debitFrom: getLookupName(r, "debitedPrioritization"),
      creditTo: getLookupName(r, "creditedPrioritization"),
      payerConcur: r.getFormattedValue("payerConcurrence") ?? "",
      payeeConcur: r.getFormattedValue("payeeConcurrence") ?? "",
      stateApproved: (r.getValue("stateApproved") as boolean | null) ?? null,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const total = rows.reduce((s, r) => s + Math.abs(r.amount), 0);
  const bothConcur = rows.filter((r) => /concur/i.test(r.payerConcur) && /concur/i.test(r.payeeConcur) && !/non/i.test(r.payerConcur) && !/non/i.test(r.payeeConcur));
  const blockedRows = rows.filter((r) => /non/i.test(r.payerConcur) || /non/i.test(r.payeeConcur));

  const onOpen = (id: string): void => {
    navigation.openForm({ entityName: "book_realignments", entityId: id }).catch(() => {});
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-pending-realignments"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Pending Realignments</span>
          <Badge appearance="outline" color="informative" size="medium">
            {rows.length} {rows.length === 1 ? "realignment" : "realignments"}
          </Badge>
          <Badge appearance="tint" color="brand" size="medium">
            Queued: {fmtMoney(total)}
          </Badge>
          {bothConcur.length > 0 && (
            <Badge appearance="tint" color="success" size="medium">
              Both concur: {bothConcur.length}
            </Badge>
          )}
          {blockedRows.length > 0 && (
            <Badge appearance="tint" color="danger" size="medium">
              Non-concur: {blockedRows.length}
            </Badge>
          )}
        </div>

        {rows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No pending realignments — the queue is clear.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r) => (
              <div
                key={r.id}
                onClick={() => onOpen(r.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  border: "1px solid #EDEBE9",
                  borderRadius: 4,
                  background: "#FFFFFF",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "#F3F2F1")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "#FFFFFF")}
              >
                {/* Debit side */}
                <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#A4262C", textTransform: "uppercase", letterSpacing: 0.4 }}>Debit</div>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.debitFrom || "—"}
                  </div>
                  {r.payerConcur && (
                    <Badge appearance="tint" color={concurColor(r.payerConcur)} size="small">
                      Payer: {r.payerConcur}
                    </Badge>
                  )}
                </div>

                {/* Arrow + amount */}
                <div style={{ minWidth: 140, textAlign: "center" }}>
                  <div style={{ fontSize: 18, color: "#605E5C", lineHeight: 1 }}>→</div>
                  <div style={{ fontWeight: 700, fontSize: 15, fontVariantNumeric: "tabular-nums", color: "#323130" }}>
                    {fmtMoney(Math.abs(r.amount))}
                  </div>
                  {r.status && (
                    <div style={{ fontSize: 11, color: "#605E5C" }}>{r.status}</div>
                  )}
                </div>

                {/* Credit side */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "#107C10", textTransform: "uppercase", letterSpacing: 0.4 }}>Credit</div>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.creditTo || "—"}
                  </div>
                  {r.payeeConcur && (
                    <Badge appearance="tint" color={concurColor(r.payeeConcur)} size="small">
                      Payee: {r.payeeConcur}
                    </Badge>
                  )}
                </div>

                {/* State approval pill */}
                <div style={{ minWidth: 110, textAlign: "right" }}>
                  {r.stateApproved === true && (
                    <Badge appearance="tint" color="success">State approved</Badge>
                  )}
                  {r.stateApproved === false && (
                    <Badge appearance="tint" color="warning">Awaiting state</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
