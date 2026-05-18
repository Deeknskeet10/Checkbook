import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
} from "@fluentui/react-components";

export interface PrioritizationsForRequirementProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  parentRequirementId?: string;
}

interface Row {
  id: string;
  name: string;
  statePriority: number | null;
  approvalStatus: string | null;
  fundedAmount: number | null;
  unfundedAmount: number | null;
  requirementType: string | null;
  createdOn: Date | null;
}

const fmtMoney = (n: number | null): string =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (d: Date | null): string =>
  d ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

function statusColor(label: string | null): "danger" | "warning" | "success" | "informative" | "brand" {
  const t = (label || "").toLowerCase();
  if (t.includes("approved") || t.includes("funded")) return "success";
  if (t.includes("submit")) return "brand";
  if (t.includes("reject") || t.includes("kick")) return "danger";
  if (t.includes("draft") || t.includes("planning")) return "informative";
  if (t.includes("review")) return "warning";
  return "informative";
}

export const PrioritizationsForRequirementApp: React.FC<PrioritizationsForRequirementProps> = (props) => {
  const { dataset, navigation } = props;

  const rows: Row[] = React.useMemo(() => {
    return dataset.sortedRecordIds
      .map((id) => dataset.records[id])
      .map((r) => ({
        id: r.getRecordId(),
        name: (r.getValue("name") as string | null) || "(unnamed)",
        statePriority: (r.getValue("statePriority") as number | null) ?? null,
        approvalStatus: r.getFormattedValue("approvalStatus") ?? null,
        fundedAmount: (r.getValue("fundedAmount") as number | null) ?? null,
        unfundedAmount: (r.getValue("unfundedAmount") as number | null) ?? null,
        requirementType: r.getFormattedValue("requirementType") ?? null,
        createdOn: toDate(r.getValue("createdOn")),
      }))
      .sort((a, b) => {
        const pa = a.statePriority == null ? Number.MAX_SAFE_INTEGER : a.statePriority;
        const pb = b.statePriority == null ? Number.MAX_SAFE_INTEGER : b.statePriority;
        if (pa !== pb) return pa - pb;
        const da = a.createdOn?.getTime() ?? 0;
        const db = b.createdOn?.getTime() ?? 0;
        return db - da;
      });
  }, [dataset.sortedRecordIds.join("|")]);

  const open = (id: string): void => {
    navigation.openForm({ entityName: "book_prioritization", entityId: id });
  };

  const totalFunded = rows.reduce((s, r) => s + (r.fundedAmount ?? 0), 0);
  const totalUnfunded = rows.reduce((s, r) => s + (r.unfundedAmount ?? 0), 0);

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-prios-for-req"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Prioritizations</span>
          <Badge appearance="outline" color="informative" size="medium">
            {rows.length} {rows.length === 1 ? "prioritization" : "prioritizations"}
          </Badge>
          <Badge appearance="tint" color="success">
            Funded: {fmtMoney(totalFunded)}
          </Badge>
          <Badge appearance="tint" color="warning">
            Unfunded: {fmtMoney(totalUnfunded)}
          </Badge>
        </div>

        {rows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No prioritizations under this requirement yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((row) => {
              return (
                <div
                  key={row.id}
                  onClick={() => open(row.id)}
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
                  <div
                    style={{
                      minWidth: 36,
                      height: 36,
                      borderRadius: 18,
                      background: row.statePriority == null ? "#A19F9D" : row.statePriority <= 1 ? "#107C10" : row.statePriority <= 3 ? "#0078D4" : "#605E5C",
                      color: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 13,
                      fontVariantNumeric: "tabular-nums",
                    }}
                    title={`State priority: ${row.statePriority ?? "—"}`}
                  >
                    {row.statePriority ?? "—"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
                      <strong
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 480,
                        }}
                      >
                        {row.name}
                      </strong>
                      {row.approvalStatus && (
                        <Badge appearance="tint" color={statusColor(row.approvalStatus)}>
                          {row.approvalStatus}
                        </Badge>
                      )}
                      {row.requirementType && (
                        <Badge appearance="outline" color="informative">
                          {row.requirementType}
                        </Badge>
                      )}
                    </div>
                    <div style={{ color: "#605E5C", fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {row.createdOn && <span>Created {fmtDate(row.createdOn)}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 140 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: "tabular-nums", color: "#107C10" }}>
                      {fmtMoney(row.fundedAmount)}
                    </div>
                    <div style={{ color: "#605E5C", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                      uf {fmtMoney(row.unfundedAmount)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
