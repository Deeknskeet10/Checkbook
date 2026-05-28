import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Badge,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
  Input,
} from "@fluentui/react-components";

export interface SuppliesGridProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  utils: ComponentFramework.Utility;
  parentPrioritizationId?: string;
  parentPrioritizationName?: string;
  requirementLookupField: string;
}

interface SupplyItemDetail {
  id: string;
  name: string;
  nsn: string | null;
  dodic: string | null;
  lincode: string | null;
  eic: string | null;
  ui: string | null;
  unitCost: number | null;
  supplyClassLabel: string | null;
  supplyClassValue: number | null;
  subclassLabel: string | null;
  isRequired: boolean;
}

function maskNSN(d: string | null | undefined): string {
  if (!d) return "";
  const s = (d + "").replace(/\D/g, "").slice(0, 13);
  const a = s.slice(0, 4);
  const b = s.slice(4, 6);
  const c = s.slice(6, 9);
  const e = s.slice(9, 13);
  return [a, b, c, e].filter(Boolean).join("-");
}

function getLookup(
  r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
  col: string
): { id: string; name: string } | null {
  const raw: any = r.getValue(col);
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const id = (v.id?.guid ?? v.id ?? "").toString().toLowerCase().replace(/[{}]/g, "");
  const name = v.name ?? r.getFormattedValue(col) ?? "";
  return id ? { id, name: name || "(no name)" } : null;
}

const fmtMoney = (n: number | null): string =>
  n == null
    ? ""
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

function shortClass(label: string | null | undefined): string {
  // Trim "I - Subsistence" → "I"; "VII - Major End Items" → "VII"
  if (!label) return "";
  const m = label.match(/^([IVX]+[A-Z]?|[A-Z])\b/);
  return m ? m[1] : label;
}

export const SuppliesGridApp: React.FC<SuppliesGridProps> = (props) => {
  const {
    dataset,
    webAPI,
    navigation,
    parentPrioritizationId,
    parentPrioritizationName,
    requirementLookupField,
  } = props;

  const [supplyItems, setSupplyItems] = React.useState<Map<string, SupplyItemDetail>>(new Map());
  const [requiredItems, setRequiredItems] = React.useState<SupplyItemDetail[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Collect all SupplyItem ids: required ones from parent Requirement + ones referenced by Supply rows.
  const referencedItemIds = React.useMemo(() => {
    const ids = new Set<string>();
    dataset.sortedRecordIds.forEach((rid) => {
      const r = dataset.records[rid];
      const lookup = getLookup(r, "item");
      if (lookup) ids.add(lookup.id);
    });
    return ids;
  }, [dataset.sortedRecordIds.join("|")]);

  React.useEffect(() => {
    (async () => {
      try {
        // 1. Pull required SupplyItems from parent Requirement.
        // Source of truth: M:N junction arsc_requirementsupplyitem (per-link arsc_isrequired flag).
        // Fallback: legacy book_supplyitems.book_requirement direct lookup.
        let required: SupplyItemDetail[] = [];
        if (parentPrioritizationId) {
          const priorit = await webAPI.retrieveRecord(
            "book_prioritization",
            parentPrioritizationId,
            `?$select=_${requirementLookupField}_value`
          );
          const reqId = (priorit as any)[`_${requirementLookupField}_value`] as string | null;
          if (reqId) {
            // Junction: items linked via arsc_requirementsupplyitem with isRequired != false.
            const junction = await webAPI.retrieveMultipleRecords(
              "arsc_requirementsupplyitem",
              `?$select=_arsc_supplyitem_value,arsc_isrequired&$filter=_arsc_requirement_value eq ${reqId} and statecode eq 0`
            );
            const junctionIds = junction.entities
              .filter((e: any) => e.arsc_isrequired !== false)
              .map((e: any) => (e._arsc_supplyitem_value as string)?.toLowerCase())
              .filter(Boolean);

            // Legacy: items via direct lookup.
            const legacy = await webAPI.retrieveMultipleRecords(
              "book_supplyitems",
              `?$select=book_supplyitemsid,book_name,arsc_nsn,arsc_dodic,arsc_lincode,arsc_eic,arsc_ui,arsc_supplyclass,arsc_subclass,arsc_isrequired,arsc_unitcost&$filter=_book_requirement_value eq ${reqId} and statecode eq 0`
            );
            const legacyById = new Map<string, any>(
              legacy.entities.map((e: any) => [e.book_supplyitemsid.toLowerCase(), e])
            );

            // Junction-only items: fetch their details
            const junctionOnly = junctionIds.filter((id) => !legacyById.has(id));
            if (junctionOnly.length > 0) {
              const filter = junctionOnly.map((id) => `book_supplyitemsid eq ${id}`).join(" or ");
              const extra = await webAPI.retrieveMultipleRecords(
                "book_supplyitems",
                `?$select=book_supplyitemsid,book_name,arsc_nsn,arsc_dodic,arsc_lincode,arsc_eic,arsc_ui,arsc_supplyclass,arsc_subclass,arsc_isrequired,arsc_unitcost&$filter=${filter}`
              );
              for (const e of extra.entities as any[]) {
                legacyById.set(e.book_supplyitemsid.toLowerCase(), e);
              }
            }

            // Required = union of junction items and legacy items where isRequired != false
            const allIds = new Set<string>([
              ...junctionIds,
              ...legacy.entities
                .filter((e: any) => e.arsc_isrequired !== false)
                .map((e: any) => e.book_supplyitemsid.toLowerCase()),
            ]);
            required = Array.from(allIds)
              .map((id) => legacyById.get(id))
              .filter(Boolean)
              .map((e: any) => mapSupplyItem(e));
          }
        }

        // 2. Pull any additional SupplyItems referenced by Supply rows but not in required (defensive)
        const need = Array.from(referencedItemIds).filter(
          (id) => !required.find((r) => r.id === id)
        );
        let extras: SupplyItemDetail[] = [];
        if (need.length > 0) {
          const filter = need.map((id) => `book_supplyitemsid eq ${id}`).join(" or ");
          const res = await webAPI.retrieveMultipleRecords(
            "book_supplyitems",
            `?$select=book_supplyitemsid,book_name,arsc_nsn,arsc_dodic,arsc_lincode,arsc_eic,arsc_ui,arsc_supplyclass,arsc_subclass,arsc_isrequired,arsc_unitcost&$filter=${filter}`
          );
          extras = res.entities.map((e: any) => mapSupplyItem(e));
        }

        const all = new Map<string, SupplyItemDetail>();
        [...required, ...extras].forEach((d) => all.set(d.id, d));
        setSupplyItems(all);
        setRequiredItems(required.filter((r) => r.isRequired));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[SuppliesGrid] load failed", e);
        setSupplyItems(new Map());
        setRequiredItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [parentPrioritizationId, requirementLookupField, webAPI, Array.from(referencedItemIds).join("|")]);

  const records = dataset.sortedRecordIds.map((id) => dataset.records[id]);
  // "Priced" means: row exists AND has a non-zero quantity AND a non-zero cost.
  // (Just having the item lookup set is not enough — auto-seeded skeletons have item but null qty/cost.)
  const pricedItemIds = new Set(
    records
      .filter((r) => {
        const q = (r.getValue("quantity") as number | null) ?? 0;
        const c = (r.getValue("estimatedCost") as number | null) ?? 0;
        return q > 0 && c > 0;
      })
      .map((r) => getLookup(r, "item")?.id)
      .filter(Boolean) as string[]
  );

  const required = requiredItems ?? [];
  const filledCount = required.filter((i) => pricedItemIds.has(i.id)).length;
  const requiredCount = required.length;
  const incomplete = requiredCount > 0 && filledCount < requiredCount;
  // For the "missing" callout, also account for items that have a row but aren't priced —
  // both should appear so the user knows what to fill in.
  const missing = required.filter((i) => !pricedItemIds.has(i.id));

  const onEdit = (r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord): void => {
    navigation
      .openForm({ entityName: "book_supplies", entityId: r.getRecordId(), openInNewWindow: false })
      .then(() => dataset.refresh())
      .catch(() => {});
  };

  const onAdd = (): void => {
    const defaults: { [key: string]: unknown } = {};
    if (parentPrioritizationId) {
      defaults["book_prioritization"] = parentPrioritizationId;
      if (parentPrioritizationName) {
        defaults["book_prioritizationname"] = parentPrioritizationName;
        defaults["book_prioritizationtype"] = "book_prioritization";
      }
    }
    navigation
      .openForm({ entityName: "book_supplies" }, defaults as any)
      .then(() => dataset.refresh())
      .catch(() => {});
  };

  // --- Inline edit state ---
  type EditCol = "quantity" | "estimatedCost";
  const COL_TO_FIELD: { [K in EditCol]: string } = {
    quantity: "book_quantity",
    estimatedCost: "book_estimatedcost",
  };
  const [editing, setEditing] = React.useState<{ rowId: string; col: EditCol } | null>(null);
  const [draft, setDraft] = React.useState<string>("");
  const [savingRowId, setSavingRowId] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const startEdit = (rowId: string, col: EditCol, currentVal: number | null): void => {
    setEditing({ rowId, col });
    setDraft(currentVal != null ? String(currentVal) : "");
    setSaveError(null);
  };

  const commit = async (): Promise<void> => {
    if (!editing) return;
    const { rowId, col } = editing;
    const raw = draft.trim();
    if (raw === "") {
      setEditing(null);
      return;
    }
    const num = Number(raw);
    if (Number.isNaN(num) || num < 0) {
      setSaveError(`"${raw}" is not a valid non-negative number`);
      setEditing(null);
      return;
    }
    setEditing(null);
    setSavingRowId(rowId);
    try {
      const update: { [k: string]: number } = {
        [COL_TO_FIELD[col]]: col === "quantity" ? Math.round(num) : num,
      };

      // Auto-fill estimated cost when the user enters a quantity AND
      // (a) cost is currently empty/zero AND (b) the linked SupplyItem has a unit cost.
      // Never overwrite a user-entered cost.
      if (col === "quantity") {
        const row = dataset.records[rowId];
        if (row) {
          const currentCost = (row.getValue("estimatedCost") as number | null) ?? 0;
          const lookup = getLookup(row, "item");
          const detail = lookup ? supplyItems.get(lookup.id) : null;
          if (currentCost <= 0 && detail?.unitCost != null && detail.unitCost > 0) {
            update.book_estimatedcost = Math.round(num) * detail.unitCost;
          }
        }
      }

      await webAPI.updateRecord("book_supplies", rowId, update);
      dataset.refresh();
    } catch (e: any) {
      setSaveError(e?.message || "Update failed");
    } finally {
      setSavingRowId(null);
    }
  };

  const autoFillCost = async (rowId: string): Promise<void> => {
    const row = dataset.records[rowId];
    if (!row) return;
    const qty = (row.getValue("quantity") as number | null) ?? 0;
    const lookup = getLookup(row, "item");
    const detail = lookup ? supplyItems.get(lookup.id) : null;
    if (qty <= 0 || !detail?.unitCost || detail.unitCost <= 0) {
      setSaveError("Auto-fill needs Qty > 0 and a SupplyItem unit cost set");
      return;
    }
    setSavingRowId(rowId);
    try {
      await webAPI.updateRecord("book_supplies", rowId, {
        book_estimatedcost: qty * detail.unitCost,
      });
      dataset.refresh();
    } catch (e: any) {
      setSaveError(e?.message || "Auto-fill failed");
    } finally {
      setSavingRowId(null);
    }
  };

  const cancelEdit = (): void => {
    setEditing(null);
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-supplies-grid"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Supplies</span>
          {loading ? (
            <Spinner size="tiny" label="Loading..." />
          ) : requiredCount > 0 ? (
            <Badge appearance="filled" color={incomplete ? "danger" : "success"} size="medium">
              {filledCount} / {requiredCount} priced
            </Badge>
          ) : (
            <Badge appearance="outline" color="informative" size="medium">
              {records.length} {records.length === 1 ? "row" : "rows"}
            </Badge>
          )}
          <div style={{ flex: 1 }} />
          <Button size="small" appearance="primary" onClick={onAdd}>
            + Add row
          </Button>
        </div>

        {incomplete && missing.length > 0 && (
          <MessageBar intent="warning" style={{ marginBottom: 12 }}>
            <MessageBarBody>
              <strong>Missing supply rows for: </strong>
              {missing.map((m) => m.name).join(", ")}
            </MessageBarBody>
          </MessageBar>
        )}

        {saveError && (
          <MessageBar intent="error" style={{ marginBottom: 12 }}>
            <MessageBarBody>
              <strong>Save failed: </strong>{saveError}
              <Button size="small" appearance="transparent" onClick={() => setSaveError(null)}>
                Dismiss
              </Button>
            </MessageBarBody>
          </MessageBar>
        )}

        {records.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No supply rows on this prioritization yet. Use <strong>+ Add row</strong>.
          </div>
        ) : (
          <Table size="small" aria-label="Supplies" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 60 }} />
              <col style={{ width: "auto" }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 80 }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>SLC</TableHeaderCell>
                <TableHeaderCell>Item</TableHeaderCell>
                <TableHeaderCell>NSN / DODIC / LIN</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }}>Qty</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }}>Est. Cost</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }} aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => {
                const lookup = getLookup(r, "item");
                const detail = lookup ? supplyItems.get(lookup.id) ?? null : null;
                const itemName = detail?.name ?? lookup?.name ?? "(pick item)";
                const qty = (r.getValue("quantity") as number | null) ?? null;
                const cost = (r.getValue("estimatedCost") as number | null) ?? null;
                const rowOk = !!lookup && (qty ?? 0) > 0 && (cost ?? 0) > 0;
                const code = detail?.dodic
                  ? `DODIC ${detail.dodic}`
                  : detail?.lincode
                  ? `LIN ${detail.lincode}`
                  : detail?.nsn
                  ? maskNSN(detail.nsn)
                  : "";
                return (
                  <TableRow key={r.getRecordId()}>
                    <TableCell>
                      {detail?.supplyClassLabel ? (
                        <Badge appearance="tint" color="informative" title={detail.supplyClassLabel}>
                          {shortClass(detail.supplyClassLabel)}
                        </Badge>
                      ) : (
                        <span style={{ color: "#A19F9D" }}>—</span>
                      )}
                    </TableCell>
                    <TableCell style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {itemName}
                      {detail?.subclassLabel && (
                        <span style={{ color: "#605E5C", marginLeft: 6, fontSize: 11 }}>
                          ({shortClass(detail.subclassLabel)})
                        </span>
                      )}
                    </TableCell>
                    <TableCell style={{ fontFamily: "Consolas, Menlo, monospace", fontSize: 12, color: "#323130" }}>
                      {code}
                    </TableCell>
                    <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {editing?.rowId === r.getRecordId() && editing.col === "quantity" ? (
                        <Input
                          value={draft}
                          type="number"
                          size="small"
                          appearance="underline"
                          autoFocus
                          onChange={(_, d) => setDraft(d.value)}
                          onBlur={() => { void commit(); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); void commit(); }
                            if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                          }}
                          style={{ width: 64, textAlign: "right" }}
                        />
                      ) : (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => startEdit(r.getRecordId(), "quantity", qty)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              startEdit(r.getRecordId(), "quantity", qty);
                            }
                          }}
                          title="Click to edit"
                          style={{
                            cursor: "text",
                            padding: "2px 4px",
                            borderRadius: 2,
                            display: "inline-block",
                            minWidth: 36,
                            color: qty != null ? "#323130" : "#A19F9D",
                          }}
                        >
                          {qty != null ? qty.toLocaleString() : "—"}
                          {detail?.ui && qty != null && (
                            <span style={{ color: "#605E5C", marginLeft: 4, fontSize: 11 }}>{detail.ui}</span>
                          )}
                        </span>
                      )}
                      {savingRowId === r.getRecordId() && (
                        <Spinner size="extra-tiny" style={{ marginLeft: 4, display: "inline-block" }} />
                      )}
                    </TableCell>
                    <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {editing?.rowId === r.getRecordId() && editing.col === "estimatedCost" ? (
                        <Input
                          value={draft}
                          type="number"
                          size="small"
                          appearance="underline"
                          autoFocus
                          onChange={(_, d) => setDraft(d.value)}
                          onBlur={() => { void commit(); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); void commit(); }
                            if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                          }}
                          style={{ width: 96, textAlign: "right" }}
                        />
                      ) : (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => startEdit(r.getRecordId(), "estimatedCost", cost)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              startEdit(r.getRecordId(), "estimatedCost", cost);
                            }
                          }}
                          title="Click to edit"
                          style={{
                            cursor: "text",
                            padding: "2px 4px",
                            borderRadius: 2,
                            display: "inline-block",
                            minWidth: 60,
                            color: cost != null ? "#323130" : "#A19F9D",
                          }}
                        >
                          {cost != null ? fmtMoney(cost) : "—"}
                        </span>
                      )}
                      {detail?.unitCost != null && detail.unitCost > 0 && qty != null && qty > 0 && (
                        <div style={{ fontSize: 10, color: "#605E5C", marginTop: 2 }}>
                          @ {fmtMoney(detail.unitCost)}/{detail.ui || "ea"}
                          {(cost == null || cost === 0) && (
                            <Button
                              size="small"
                              appearance="transparent"
                              onClick={() => { void autoFillCost(r.getRecordId()); }}
                              style={{ marginLeft: 4, padding: "0 4px", height: 16, minWidth: 0, fontSize: 10 }}
                              title={`Fill cost = ${qty.toLocaleString()} × ${fmtMoney(detail.unitCost)}`}
                            >
                              auto-fill
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge appearance="tint" color={rowOk ? "success" : "warning"}>
                        {rowOk ? "OK" : "Incomplete"}
                      </Badge>
                    </TableCell>
                    <TableCell style={{ textAlign: "right" }}>
                      <Button size="small" appearance="secondary" onClick={() => onEdit(r)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </FluentProvider>
  );
};

function mapSupplyItem(e: any): SupplyItemDetail {
  return {
    id: e.book_supplyitemsid,
    name: e.book_name ?? "(unnamed)",
    nsn: e.arsc_nsn ?? null,
    dodic: e.arsc_dodic ?? null,
    lincode: e.arsc_lincode ?? null,
    eic: e.arsc_eic ?? null,
    ui: e.arsc_ui ?? null,
    unitCost: e.arsc_unitcost != null ? Number(e.arsc_unitcost) : null,
    supplyClassValue: e.arsc_supplyclass ?? null,
    supplyClassLabel: e["arsc_supplyclass@OData.Community.Display.V1.FormattedValue"] ?? null,
    subclassLabel: e["arsc_subclass@OData.Community.Display.V1.FormattedValue"] ?? null,
    isRequired: e.arsc_isrequired !== false,
  };
}
