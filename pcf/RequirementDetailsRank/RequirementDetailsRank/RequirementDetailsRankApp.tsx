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

export interface RequirementDetailsRankProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  parentRequirementId?: string;
}

interface Row {
  id: string;
  name: string;
  priorityOrder: number | null;
  itemLabel: string | null;
  category: string | null;
  quantityType: string | null;
  tdc: number | null;
}

const ENTITY = "book_requirementdetails";
const FIELD_ORDER = "book_priorityorder";

const fmtMoney = (n: number | null): string =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const RequirementDetailsRankApp: React.FC<RequirementDetailsRankProps> = (props) => {
  const { dataset, webAPI, navigation, parentRequirementId } = props;

  const initial: Row[] = React.useMemo(() => {
    return dataset.sortedRecordIds
      .map((id) => dataset.records[id])
      .map((r) => {
        const itemRef = r.getValue("item") as ComponentFramework.EntityReference | null;
        return {
          id: r.getRecordId(),
          name: (r.getValue("name") as string | null) ?? "(unnamed)",
          priorityOrder: (r.getValue("priorityOrder") as number | null) ?? null,
          itemLabel: itemRef?.name ?? r.getFormattedValue("item") ?? null,
          category: r.getFormattedValue("category") ?? null,
          quantityType: r.getFormattedValue("quantityType") ?? null,
          tdc: (r.getValue("tdc") as number | null) ?? null,
        };
      })
      .sort((a, b) => {
        const pa = a.priorityOrder ?? Number.MAX_SAFE_INTEGER;
        const pb = b.priorityOrder ?? Number.MAX_SAFE_INTEGER;
        return pa - pb;
      });
  }, [dataset.sortedRecordIds.join("|")]);

  const [rows, setRows] = React.useState<Row[]>(initial);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const [savingIds, setSavingIds] = React.useState<Set<string>>(new Set());
  const [err, setErr] = React.useState<string | null>(null);
  const [parentPriority, setParentPriority] = React.useState<number | null>(null);

  React.useEffect(() => {
    setRows(initial);
  }, [initial]);

  React.useEffect(() => {
    if (!parentRequirementId) return;
    let cancelled = false;
    webAPI
      .retrieveRecord("book_requirements", parentRequirementId, "?$select=book_priority")
      .then((rec: any) => {
        if (!cancelled) setParentPriority(rec?.book_priority ?? null);
        return null;
      })
      .catch(() => {
        /* parent priority is decorative — fall back to bare order */
      });
    return () => {
      cancelled = true;
    };
  }, [parentRequirementId, webAPI]);

  const totalTdc = rows.reduce((s, r) => s + (r.tdc ?? 0), 0);

  const displayPriority = (idx: number): string => {
    const order = idx + 1;
    return parentPriority != null ? `${parentPriority}.${order}` : `${order}`;
  };

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

    const changes: { id: string; order: number }[] = next
      .map((r, i) => ({ id: r.id, order: i + 1 }))
      .filter((c, i) => next[i].priorityOrder !== c.order);

    setRows(next.map((r, i) => ({ ...r, priorityOrder: i + 1 })));
    setDragId(null);

    const saving = new Set<string>(changes.map((c) => c.id));
    setSavingIds(saving);
    try {
      await Promise.all(
        changes.map((c) =>
          webAPI.updateRecord(ENTITY, c.id, { [FIELD_ORDER]: c.order })
        )
      );
    } catch (ex: any) {
      setErr(ex?.message ?? "Reorder save failed");
    } finally {
      setSavingIds(new Set());
      dataset.refresh();
    }
  };

  const openDetail = (id: string): void => {
    void navigation.openForm({ entityName: ENTITY, entityId: id });
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-reqdetails-rank"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Requirement Details</span>
          <Badge appearance="outline" color="informative" size="medium">
            {rows.length} {rows.length === 1 ? "detail" : "details"}
          </Badge>
          {totalTdc > 0 && (
            <Badge appearance="tint" color="informative">
              TDC total: {fmtMoney(totalTdc)}
            </Badge>
          )}
          {parentPriority != null && (
            <Badge appearance="tint" color="brand">
              Parent priority: {parentPriority}
            </Badge>
          )}
          <span style={{ color: "#605E5C", fontSize: 12 }}>· Drag a card to reorder</span>
        </div>

        {err && (
          <MessageBar intent="error" style={{ marginBottom: 12 }}>
            <MessageBarBody>
              <strong>Save failed: </strong>
              {err}{" "}
              <Button size="small" appearance="transparent" onClick={() => setErr(null)}>
                Dismiss
              </Button>
            </MessageBarBody>
          </MessageBar>
        )}

        {rows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No requirement details yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((row, idx) => {
              const dragging = dragId === row.id;
              const hovering = hoverId === row.id && dragId !== row.id;
              return (
                <div
                  key={row.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, row.id)}
                  onDragOver={(e) => onDragOver(e, row.id)}
                  onDragEnd={onDragEnd}
                  onDrop={(e) => {
                    void onDrop(e, row.id);
                  }}
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
                      minWidth: 56,
                      height: 32,
                      padding: "0 8px",
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
                    title={`Priority ${displayPriority(idx)}`}
                  >
                    {displayPriority(idx)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 2,
                      }}
                    >
                      <strong
                        onClick={() => openDetail(row.id)}
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 480,
                          cursor: "pointer",
                          color: "#0078D4",
                        }}
                      >
                        {row.name}
                      </strong>
                      {row.itemLabel && (
                        <Badge appearance="outline" color="informative">
                          {row.itemLabel}
                        </Badge>
                      )}
                      {row.category && (
                        <Badge appearance="tint" color="informative">
                          {row.category}
                        </Badge>
                      )}
                      {row.quantityType && (
                        <Badge appearance="outline" color="informative">
                          {row.quantityType}
                        </Badge>
                      )}
                    </div>
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
                    title="TDC"
                  >
                    {fmtMoney(row.tdc)}
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
