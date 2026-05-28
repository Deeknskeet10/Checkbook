import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";

export interface UnfundedRequestsRankProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
}

interface Row {
  id: string;
  name: string;
  amount: number | null;
  justification: string | null;
  dropDeadDate: Date | null;
  riskLabel: string | null;
  priority: number | null;
}

const fmtMoney = (n: number | null): string =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (d: Date | null): string =>
  d ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";

const daysUntil = (d: Date | null): number | null =>
  d ? Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;

function riskColor(label: string | null): "danger" | "warning" | "success" | "informative" {
  const t = (label || "").toLowerCase();
  if (t.includes("high") || t.includes("critical") || t.includes("severe")) return "danger";
  if (t.includes("med") || t.includes("moder")) return "warning";
  if (t.includes("low")) return "success";
  return "informative";
}

export const UnfundedRequestsRankApp: React.FC<UnfundedRequestsRankProps> = (props) => {
  const { dataset, webAPI } = props;

  const toDate = (v: any): Date | null => {
    if (!v) return null;
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };

  const initial: Row[] = React.useMemo(() => {
    return dataset.sortedRecordIds
      .map((id) => dataset.records[id])
      .map((r) => ({
        id: r.getRecordId(),
        name: (r.getValue("name") as string | null) || "(unnamed)",
        amount: (r.getValue("amount") as number | null) ?? null,
        justification: (r.getValue("justification") as string | null) ?? null,
        dropDeadDate: toDate(r.getValue("dropDeadDate")),
        riskLabel: r.getFormattedValue("riskLabel") ?? null,
        priority: (r.getValue("priority") as number | null) ?? null,
      }))
      .sort((a, b) => {
        // Lower priority number = higher importance, but treat null as worst
        const pa = a.priority == null ? Number.MAX_SAFE_INTEGER : a.priority;
        const pb = b.priority == null ? Number.MAX_SAFE_INTEGER : b.priority;
        return pa - pb;
      });
  }, [dataset.sortedRecordIds.join("|")]);

  const [rows, setRows] = React.useState<Row[]>(initial);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [err, setErr] = React.useState<string | null>(null);

  // Keep rows in sync when the dataset changes externally
  React.useEffect(() => {
    setRows(initial);
  }, [initial]);

  const totalUnfunded = rows.reduce((s, r) => s + (r.amount ?? 0), 0);

  const onDragStart = (e: React.DragEvent, id: string): void => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver = (e: React.DragEvent, overId: string): void => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overId !== hoverId) setHoverId(overId);
  };
  const onDragEnd = (): void => {
    setDragId(null);
    setHoverId(null);
  };

  const onDrop = async (e: React.DragEvent, overId: string): Promise<void> => {
    e.preventDefault();
    setHoverId(null);
    if (!dragId || dragId === overId) {
      setDragId(null);
      return;
    }
    const fromIdx = rows.findIndex((r) => r.id === dragId);
    const toIdx = rows.findIndex((r) => r.id === overId);
    if (fromIdx < 0 || toIdx < 0) {
      setDragId(null);
      return;
    }
    const next = [...rows];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);

    // Renumber: 1-based priority across all rows
    const priorityChanges: { id: string; priority: number }[] = next
      .map((r, i) => ({ id: r.id, priority: i + 1 }))
      .filter((c, i) => next[i].priority !== c.priority);

    // Optimistic update
    setRows(next.map((r, i) => ({ ...r, priority: i + 1 })));
    setDragId(null);

    // Push changes in parallel; track which rows are saving
    const saving = new Set<string>(priorityChanges.map((c) => c.id));
    setSavingIds(saving);
    try {
      await Promise.all(
        priorityChanges.map((c) =>
          webAPI.updateRecord("book_unfundedrequests", c.id, { book_priority: c.priority })
        )
      );
    } catch (e: any) {
      setErr(e?.message || "Reorder save failed");
    } finally {
      setSavingIds(new Set());
      // Refresh dataset so other clients pick up changes
      dataset.refresh();
    }
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-ufr-rank"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Unfunded Requests</span>
          <Badge appearance="outline" color="informative" size="medium">
            {rows.length} {rows.length === 1 ? "request" : "requests"} · {fmtMoney(totalUnfunded)}
          </Badge>
          <span style={{ color: "#605E5C", fontSize: 12 }}>· Drag a card to reorder</span>
        </div>

        {err && (
          <MessageBar intent="error" style={{ marginBottom: 12 }}>
            <MessageBarBody>
              <strong>Save failed: </strong>{err}{" "}
              <Button size="small" appearance="transparent" onClick={() => setErr(null)}>
                Dismiss
              </Button>
            </MessageBarBody>
          </MessageBar>
        )}

        {rows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No unfunded requests in scope.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((row, idx) => {
              const dragging = dragId === row.id;
              const hovering = hoverId === row.id && dragId !== row.id;
              const dDays = daysUntil(row.dropDeadDate);
              const justPreview = (row.justification || "").replace(/\s+/g, " ").slice(0, 140);
              return (
                <div
                  key={row.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, row.id)}
                  onDragOver={(e) => onDragOver(e, row.id)}
                  onDragEnd={onDragEnd}
                  onDrop={(e) => onDrop(e, row.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 12px",
                    border: hovering ? "2px dashed #4F6BED" : "1px solid #EDEBE9",
                    borderRadius: 4,
                    background: dragging ? "#F3F2F1" : "#FFFFFF",
                    opacity: dragging ? 0.5 : 1,
                    cursor: "grab",
                  }}
                >
                  <div
                    style={{
                      minWidth: 32,
                      height: 32,
                      borderRadius: 16,
                      background: idx === 0 ? "#107C10" : idx <= 2 ? "#0078D4" : "#605E5C",
                      color: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 13,
                      fontVariantNumeric: "tabular-nums",
                    }}
                    title={`Rank ${idx + 1}`}
                  >
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        marginBottom: 2,
                      }}
                    >
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
                      {row.riskLabel && (
                        <Badge appearance="tint" color={riskColor(row.riskLabel)}>
                          {row.riskLabel}
                        </Badge>
                      )}
                      {dDays != null && (
                        <Badge
                          appearance="outline"
                          color={dDays < 0 ? "danger" : dDays < 30 ? "warning" : "informative"}
                          title={`Drop-dead: ${fmtDate(row.dropDeadDate)}`}
                        >
                          {dDays < 0
                            ? `${Math.abs(dDays)}d overdue`
                            : `${dDays}d to drop-dead`}
                        </Badge>
                      )}
                    </div>
                    {justPreview && (
                      <div style={{ color: "#605E5C", fontSize: 12 }}>
                        {justPreview}
                        {(row.justification || "").length > 140 && "…"}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
                      fontVariantNumeric: "tabular-nums",
                      color: "#323130",
                      minWidth: 96,
                      textAlign: "right",
                    }}
                  >
                    {fmtMoney(row.amount)}
                  </div>
                  {savingIds.has(row.id) && <Spinner size="extra-tiny" />}
                  <span
                    aria-hidden="true"
                    style={{
                      width: 20,
                      textAlign: "center",
                      color: "#A19F9D",
                      cursor: "grab",
                      userSelect: "none",
                    }}
                    title="Drag handle"
                  >
                    ⋮⋮
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
