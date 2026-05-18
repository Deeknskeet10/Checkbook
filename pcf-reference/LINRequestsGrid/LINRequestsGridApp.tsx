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

export interface LINRequestsGridProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  parentPrioritizationId?: string;
  parentPrioritizationName?: string;
}

interface LINDetail {
  id: string;
  name: string;
  nomenclature: string | null;
  branchLabel: string | null;
  portfolioLabel: string | null;
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
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const LINRequestsGridApp: React.FC<LINRequestsGridProps> = (props) => {
  const { dataset, webAPI, navigation, parentPrioritizationId, parentPrioritizationName } = props;

  const [linDetails, setLinDetails] = React.useState<Map<string, LINDetail>>(new Map());
  const [parentRequirementLin, setParentRequirementLin] = React.useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = React.useState(true);

  const referencedLinIds = React.useMemo(() => {
    const ids = new Set<string>();
    dataset.sortedRecordIds.forEach((rid) => {
      const lookup = getLookup(dataset.records[rid], "lin");
      if (lookup) ids.add(lookup.id);
    });
    return ids;
  }, [dataset.sortedRecordIds.join("|")]);

  React.useEffect(() => {
    (async () => {
      try {
        let parentLin: { id: string; name: string } | null = null;
        if (parentPrioritizationId) {
          // The parent Prioritization links to a Requirement; the Requirement has a LIN lookup.
          const priorit = await webAPI.retrieveRecord(
            "book_prioritization",
            parentPrioritizationId,
            "?$select=_book_requirement_value&$expand=book_Requirement($select=book_name,_book_lin_value)"
          );
          const reqExpanded: any = (priorit as any).book_Requirement;
          const linVal = reqExpanded?._book_lin_value as string | undefined;
          const linName = reqExpanded?.["_book_lin_value@OData.Community.Display.V1.FormattedValue"] as string | undefined;
          if (linVal) parentLin = { id: linVal.toLowerCase(), name: linName || "(LIN)" };
        }

        // Pull details for LIN ids referenced + the parent LIN
        const need = new Set<string>(referencedLinIds);
        if (parentLin) need.add(parentLin.id);
        const details = new Map<string, LINDetail>();
        if (need.size > 0) {
          const filter = Array.from(need).map((id) => `book_linid eq ${id}`).join(" or ");
          const res = await webAPI.retrieveMultipleRecords(
            "book_lin",
            `?$select=book_linid,book_name,book_nomenclature,book_branch,book_portfolio&$filter=${filter}`
          );
          for (const e of res.entities as any[]) {
            details.set(e.book_linid, {
              id: e.book_linid,
              name: e.book_name ?? "(unnamed)",
              nomenclature: e.book_nomenclature ?? null,
              branchLabel: e["book_branch@OData.Community.Display.V1.FormattedValue"] ?? null,
              portfolioLabel: e["book_portfolio@OData.Community.Display.V1.FormattedValue"] ?? null,
            });
          }
        }

        setParentRequirementLin(parentLin);
        setLinDetails(details);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[LINRequestsGrid] load failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [parentPrioritizationId, webAPI, Array.from(referencedLinIds).join("|")]);

  const records = dataset.sortedRecordIds.map((id) => dataset.records[id]);

  // "Completeness" heuristic for Class VII: if the parent Requirement has a LIN and there's no LINRequest for it, warn.
  const coveredLinIds = new Set(records.map((r) => getLookup(r, "lin")?.id).filter(Boolean) as string[]);
  const parentLinMissing = parentRequirementLin && !coveredLinIds.has(parentRequirementLin.id);

  const onEdit = (r: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord): void => {
    navigation
      .openForm({ entityName: "book_linrequests", entityId: r.getRecordId(), openInNewWindow: false })
      .then(() => dataset.refresh())
      .catch(() => {});
  };

  const onAdd = (preselectLinId?: string): void => {
    const defaults: { [key: string]: unknown } = {};
    if (parentPrioritizationId) {
      defaults["book_prioritization"] = parentPrioritizationId;
      if (parentPrioritizationName) {
        defaults["book_prioritizationname"] = parentPrioritizationName;
        defaults["book_prioritizationtype"] = "book_prioritization";
      }
    }
    if (preselectLinId) {
      const d = linDetails.get(preselectLinId);
      defaults["book_lin"] = preselectLinId;
      if (d?.name) {
        defaults["book_linname"] = d.name;
        defaults["book_lintype"] = "book_lin";
      }
    }
    navigation
      .openForm({ entityName: "book_linrequests" }, defaults as any)
      .then(() => dataset.refresh())
      .catch(() => {});
  };

  // --- Inline edit state ---
  const EDITABLE_COLS = {
    quantity: "book_quantity",
    requestedAmount: "book_requestedamount",
    validatedAmount: "book_validatedamount",
    fundedAmount: "book_fundedamount",
  } as const;
  type EditCol = keyof typeof EDITABLE_COLS;

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
    const raw = (draft || "").trim();
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
    const { rowId, col } = editing;
    setEditing(null);
    setSavingRowId(rowId);
    try {
      await webAPI.updateRecord("book_linrequests", rowId, {
        [EDITABLE_COLS[col]]: col === "quantity" ? Math.round(num) : num,
      });
      dataset.refresh();
    } catch (e: any) {
      setSaveError(e?.message || "Update failed");
    } finally {
      setSavingRowId(null);
    }
  };
  const cancelEdit = (): void => setEditing(null);

  const renderEditableNumber = (
    rowId: string,
    col: EditCol,
    current: number | null,
    options: { width: number; format: (n: number) => string; align?: "right" }
  ): React.ReactElement => {
    const isEditing = editing?.rowId === rowId && editing.col === col;
    return isEditing ? (
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
        style={{ width: options.width, textAlign: options.align ?? "right" }}
      />
    ) : (
      <span
        role="button"
        tabIndex={0}
        onClick={() => startEdit(rowId, col, current)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            startEdit(rowId, col, current);
          }
        }}
        title="Click to edit"
        style={{
          cursor: "text",
          padding: "2px 4px",
          borderRadius: 2,
          display: "inline-block",
          minWidth: options.width - 8,
          color: current != null ? "#323130" : "#A19F9D",
        }}
      >
        {current != null ? options.format(current) : "—"}
      </span>
    );
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-linrequests-grid"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>LIN Requests (Class VII)</span>
          {loading ? (
            <Spinner size="tiny" label="Loading..." />
          ) : (
            <Badge appearance="outline" color="informative" size="medium">
              {records.length} {records.length === 1 ? "row" : "rows"}
            </Badge>
          )}
          <div style={{ flex: 1 }} />
          <Button size="small" appearance="primary" onClick={() => onAdd()}>
            + Add row
          </Button>
        </div>

        {parentLinMissing && (
          <MessageBar intent="warning" style={{ marginBottom: 12 }}>
            <MessageBarBody>
              <strong>Parent Requirement LIN not requested: </strong>
              {parentRequirementLin!.name}.{" "}
              <Button
                size="small"
                appearance="transparent"
                onClick={() => onAdd(parentRequirementLin!.id)}
              >
                Add a request for it
              </Button>
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
            No LIN requests on this prioritization yet. Use <strong>+ Add row</strong>.
          </div>
        ) : (
          <Table size="small" aria-label="LIN Requests" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 100 }} />
              <col style={{ width: "auto" }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 90 }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>LIN</TableHeaderCell>
                <TableHeaderCell>Nomenclature</TableHeaderCell>
                <TableHeaderCell>Branch / Portfolio</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }}>Qty</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }}>Requested</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }}>Validated</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }}>Funded</TableHeaderCell>
                <TableHeaderCell style={{ textAlign: "right" }} aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => {
                const lookup = getLookup(r, "lin");
                const detail = lookup ? linDetails.get(lookup.id) ?? null : null;
                const qty = (r.getValue("quantity") as number | null) ?? null;
                const requested = (r.getValue("requestedAmount") as number | null) ?? null;
                const validated = (r.getValue("validatedAmount") as number | null) ?? null;
                const funded = (r.getValue("fundedAmount") as number | null) ?? null;
                return (
                  <TableRow key={r.getRecordId()}>
                    <TableCell style={{ fontFamily: "Consolas, Menlo, monospace" }}>
                      {detail?.name ?? lookup?.name ?? "(pick LIN)"}
                    </TableCell>
                    <TableCell style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {detail?.nomenclature ?? ""}
                    </TableCell>
                    <TableCell style={{ color: "#605E5C", fontSize: 11 }}>
                      {[detail?.branchLabel, detail?.portfolioLabel].filter(Boolean).join(" · ")}
                    </TableCell>
                    <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {renderEditableNumber(r.getRecordId(), "quantity", qty, {
                        width: 64,
                        format: (n) => n.toLocaleString(),
                      })}
                      {savingRowId === r.getRecordId() && (
                        <Spinner size="extra-tiny" style={{ marginLeft: 4, display: "inline-block" }} />
                      )}
                    </TableCell>
                    <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {renderEditableNumber(r.getRecordId(), "requestedAmount", requested, {
                        width: 90,
                        format: (n) => fmtMoney(n),
                      })}
                    </TableCell>
                    <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {renderEditableNumber(r.getRecordId(), "validatedAmount", validated, {
                        width: 90,
                        format: (n) => fmtMoney(n),
                      })}
                    </TableCell>
                    <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {renderEditableNumber(r.getRecordId(), "fundedAmount", funded, {
                        width: 90,
                        format: (n) => fmtMoney(n),
                      })}
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
