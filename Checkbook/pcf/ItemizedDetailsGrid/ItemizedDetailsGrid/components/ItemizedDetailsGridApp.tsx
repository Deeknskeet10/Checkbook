import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  shorthands,
  tokens,
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Input,
  Textarea,
  Spinner,
  Text,
  Button,
  Tooltip,
  Link,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
} from "@fluentui/react-components";

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;
type Navigation = ComponentFramework.Navigation;

export interface ItemizedDetailsGridProps {
  dataset: DataSet;
  webAPI: WebApi;
  navigation: Navigation;
  isDisabled: boolean;
  width: number;
  /** Id of the parent Prioritization record (the form's record). */
  prioritizationId: string | null;
}

/** Property-set aliases declared in ControlManifest.Input.xml. */
const ALIAS = {
  requirementItem: "requirementItem",
  quantity: "quantity",
  requestedAmount: "requestedAmount",
  validatedAmount: "validatedAmount",
  fundedAmount: "fundedAmount",
  npmComment: "npmComment",
  stateComment: "stateComment",
} as const;

const ITEMIZED_DETAILS_ENTITY = "book_itemizeddetails";
const REQUIREMENT_DETAILS_ENTITY = "book_requirementdetails";
const ITEM_ENTITY = "book_item";
const TDC_ENTITY = "book_tdc";
const PRIORITIZATION_ENTITY = "book_prioritization";
const REQUIREMENT_FUNDING_ENTITY = "book_requirementfunding";

/** A Requirement Detail on the parent Requirement that is not yet itemized. */
interface CandidateRd {
  id: string;
  name: string;
  item: string;
  tdc: string;
}

type NumericField = "quantity" | "requestedAmount" | "validatedAmount" | "fundedAmount";
type TextField = "npmComment" | "stateComment";
type EditableField = NumericField | TextField;

const NUMERIC_FIELDS: NumericField[] = [
  "quantity",
  "requestedAmount",
  "validatedAmount",
  "fundedAmount",
];

type SaveState = "saving" | "saved" | "error";

/** Read-only context pulled from the linked Requirement Detail. */
interface RequirementItemContext {
  name: string;
  item: string;
  quantityType: string;
  tdc: string;
  tdcId: string | null;
  tdcLongName: string;
  category: string;
  lin: string;
  country: string;
}

interface GridRow {
  recordId: string;
  requirementItemId: string | null;
  requirementItemName: string;
  quantity: number | null;
  requestedAmount: number | null;
  validatedAmount: number | null;
  fundedAmount: number | null;
  npmComment: string;
  stateComment: string;
}

const useStyles = makeStyles({
  root: {
    ...shorthands.padding("8px"),
    fontFamily: tokens.fontFamilyBase,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    ...shorthands.padding("4px", "2px", "8px", "2px"),
  },
  // Lets the table extend past the form's width on narrow screens instead of
  // squeezing every column into the visible area.
  scrollContainer: {
    width: "100%",
    overflowX: "auto",
  },
  contextCell: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  // First column stacks Item name / Category / Quantity Type; Item names can
  // be long, so this is the one column that wraps rather than nowraps.
  firstCol: {
    minWidth: "220px",
    maxWidth: "280px",
    whiteSpace: "normal",
    wordBreak: "break-word",
    verticalAlign: "top",
  },
  firstColName: {
    fontWeight: tokens.fontWeightSemibold,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: "4px",
  },
  firstColMeta: {
    display: "block",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginTop: "2px",
  },
  numberInput: {
    minWidth: "110px",
    width: "110px",
  },
  qtyCol: {
    textAlign: "center",
    justifyContent: "center",
    minWidth: "90px",
    width: "90px",
  },
  qtyInput: {
    minWidth: "72px",
    width: "72px",
  },
  commentInput: {
    minWidth: "160px",
    width: "160px",
  },
  totalsRow: {
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  // Numeric columns: TableCell/TableHeaderCell render their children inside a
  // flex container, so plain text-align centers the literal text node but
  // doesn't position child elements (the <Input> in edit cells, the <span>
  // wrapping read-only amounts). justifyContent centers those flex children
  // so headers and values share the same axis. Width is sized for "$32,000.00"
  // with the Fluent Input's ~22px of internal padding.
  amount: {
    textAlign: "center",
    justifyContent: "center",
    fontVariantNumeric: "tabular-nums",
    minWidth: "120px",
    width: "120px",
  },
  status: {
    marginLeft: "6px",
    fontSize: tokens.fontSizeBase200,
  },
  statusError: {
    color: tokens.colorPaletteRedForeground1,
  },
  statusSaved: {
    color: tokens.colorPaletteGreenForeground1,
  },
  empty: {
    ...shorthands.padding("16px"),
    color: tokens.colorNeutralForeground3,
  },
  toolbarButtons: {
    display: "flex",
    columnGap: "8px",
  },
  addList: {
    display: "flex",
    flexDirection: "column",
    rowGap: "4px",
    maxHeight: "320px",
    overflowY: "auto",
  },
  candidateMeta: {
    display: "block",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginLeft: "28px",
  },
  dialogError: {
    color: tokens.colorPaletteRedForeground1,
  },
  actionCol: {
    width: "80px",
  },
});

/** Strips braces and lower-cases a GUID from a dataset lookup value. */
function extractLookupId(value: unknown): string | null {
  if (!value) return null;
  const v = value as { id?: { guid?: string } | string; guid?: string };
  const raw =
    (typeof v.id === "object" ? v.id?.guid : v.id) ?? v.guid ?? null;
  return raw ? String(raw).replace(/[{}]/g, "").toLowerCase() : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export const ItemizedDetailsGridApp: React.FC<ItemizedDetailsGridProps> = (
  props
) => {
  const { dataset, webAPI, navigation, isDisabled } = props;
  const styles = useStyles();
  const prioritizationId = props.prioritizationId
    ? props.prioritizationId.replace(/[{}]/g, "").toLowerCase()
    : null;

  // alias (property-set name) -> real column logical name, e.g. "book_requestedamount".
  const aliasToLogical = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const col of dataset.columns) {
      if (col.alias) map[col.alias] = col.name;
    }
    return map;
  }, [dataset.columns]);

  // Rows straight from the dataset.
  const datasetRows = React.useMemo<GridRow[]>(() => {
    return dataset.sortedRecordIds.map((id) => {
      const record = dataset.records[id];
      const lookupRaw = record.getValue(ALIAS.requirementItem);
      return {
        recordId: id,
        requirementItemId: extractLookupId(lookupRaw),
        requirementItemName:
          record.getFormattedValue(ALIAS.requirementItem) || "(unnamed)",
        quantity: toNumber(record.getValue(ALIAS.quantity)),
        requestedAmount: toNumber(record.getValue(ALIAS.requestedAmount)),
        validatedAmount: toNumber(record.getValue(ALIAS.validatedAmount)),
        fundedAmount: toNumber(record.getValue(ALIAS.fundedAmount)),
        npmComment: (record.getValue(ALIAS.npmComment) as string) ?? "",
        stateComment: (record.getValue(ALIAS.stateComment) as string) ?? "",
      };
    });
  }, [dataset.sortedRecordIds, dataset.records]);

  // Local edits override dataset values for fields the user has touched.
  const [edits, setEdits] = React.useState<
    Record<string, Partial<Record<EditableField, string>>>
  >({});
  const [saveState, setSaveState] = React.useState<Record<string, SaveState>>(
    {}
  );
  const [contexts, setContexts] = React.useState<
    Record<string, RequirementItemContext>
  >({});

  // Fetch the read-only Requirement Detail context for each distinct lookup.
  React.useEffect(() => {
    const ids = Array.from(
      new Set(
        datasetRows
          .map((r) => r.requirementItemId)
          .filter((id): id is string => !!id)
      )
    );
    const missing = ids.filter((id) => !contexts[id]);
    if (missing.length === 0) return;

    // Quantity Type and Category live on book_item now, not on the
    // Requirement Detail — so we fetch the RD for Item/TDC/name, then chain
    // a second retrieve on the linked Item for quantitytype/category.
    const rdSelect =
      "?$select=book_name,_book_item_value,_book_tdc_value,_book_lin_value,_book_country_value";
    const itemSelect = "?$select=_book_quantitytype_value,book_category";
    const tdcSelect = "?$select=book_tdcname";
    const countrySelect = "?$select=book_name";
    const linSelect = "?$select=book_name";
    const fv = "@OData.Community.Display.V1.FormattedValue";

    missing.forEach((id) => {
      let tdcId: string | null = null;
      webAPI
        .retrieveRecord(REQUIREMENT_DETAILS_ENTITY, id, rdSelect)
        .then((rd: ComponentFramework.WebApi.Entity) => {
          tdcId = (rd._book_tdc_value as string | undefined) ?? null;
          setContexts((prev) => ({
            ...prev,
            [id]: {
              name: (rd.book_name as string) || "",
              item: (rd[`_book_item_value${fv}`] as string) || "",
              quantityType: "",
              tdc: (rd[`_book_tdc_value${fv}`] as string) || "",
              lin: (rd[`_book_lin_value${fv}`] as string) || "",
              country: (rd[`_book_country_value${fv}`] as string) || "",
              tdcId,
              tdcLongName: "",
              category: "",
            },
          }));
          return (rd._book_item_value as string | undefined) ?? null;
        })
        .then((itemId) =>
          itemId
            ? webAPI.retrieveRecord(ITEM_ENTITY, itemId, itemSelect)
            : null
        )
        .then((item: ComponentFramework.WebApi.Entity | null) => {
          if (!item) return null;
          setContexts((prev) => {
            const cur = prev[id];
            if (!cur) return prev;
            return {
              ...prev,
              [id]: {
                ...cur,
                quantityType:
                  (item[`_book_quantitytype_value${fv}`] as string) || "",
                category: (item[`book_category${fv}`] as string) || "",
              },
            };
          });
          return null;
        })
        .then(() =>
          tdcId ? webAPI.retrieveRecord(TDC_ENTITY, tdcId, tdcSelect) : null
        )
        .then((tdc: ComponentFramework.WebApi.Entity | null) => {
          if (!tdc) return null;
          setContexts((prev) => {
            const cur = prev[id];
            if (!cur) return prev;
            return {
              ...prev,
              [id]: {
                ...cur,
                tdcLongName: (tdc.book_tdcname as string) || "",
              },
            };
          });
          return null;
        })
        .catch(() => {
          /* leave context blank on failure */
        });
    });
  }, [datasetRows, contexts, webAPI]);

  /** Effective string value shown in an editable cell. */
  const displayValue = (row: GridRow, field: EditableField): string => {
    const pending = edits[row.recordId]?.[field];
    if (pending !== undefined) return pending;
    const raw = row[field];
    if (raw === null || raw === undefined) return "";
    return String(raw);
  };

  /** Effective number used for the totals footer. */
  const effectiveNumber = (row: GridRow, field: NumericField): number => {
    const pending = edits[row.recordId]?.[field];
    const value = pending !== undefined ? toNumber(pending) : row[field];
    return value ?? 0;
  };

  const onCellChange = (
    recordId: string,
    field: EditableField,
    value: string
  ): void => {
    setEdits((prev) => ({
      ...prev,
      [recordId]: { ...prev[recordId], [field]: value },
    }));
  };

  /** Persists a single cell via the Web API on blur, if it actually changed. */
  const commitCell = (row: GridRow, field: EditableField): void => {
    const pending = edits[row.recordId]?.[field];
    if (pending === undefined) return;

    const isNumeric = (NUMERIC_FIELDS as string[]).includes(field);
    const newValue: number | string | null = isNumeric
      ? toNumber(pending)
      : pending.trim() === ""
        ? null
        : pending;

    const original = row[field];
    const originalNorm =
      original === null || original === undefined || original === ""
        ? null
        : original;
    if (newValue === originalNorm) return; // no real change

    const logicalName = aliasToLogical[field];
    if (!logicalName) return;

    setSaveState((prev) => ({ ...prev, [row.recordId]: "saving" }));
    webAPI
      .updateRecord(ITEMIZED_DETAILS_ENTITY, row.recordId, {
        [logicalName]: newValue,
      })
      .then(() => {
        setSaveState((prev) => ({ ...prev, [row.recordId]: "saved" }));
        window.setTimeout(() => {
          setSaveState((prev) => {
            const next = { ...prev };
            if (next[row.recordId] === "saved") delete next[row.recordId];
            return next;
          });
        }, 2500);
        return;
      })
      .catch(() => {
        setSaveState((prev) => ({ ...prev, [row.recordId]: "error" }));
      });
  };

  // ----- Add from Requirement Details (user-selected itemization) -----
  const [addOpen, setAddOpen] = React.useState(false);
  const [candidates, setCandidates] = React.useState<CandidateRd[] | null>(
    null
  );
  const [candidateError, setCandidateError] = React.useState<string | null>(
    null
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [addBusy, setAddBusy] = React.useState(false);

  const existingRdIds = React.useMemo(() => {
    const ids = new Set<string>();
    datasetRows.forEach((r) => {
      if (r.requirementItemId) ids.add(r.requirementItemId);
    });
    return ids;
  }, [datasetRows]);

  const loadCandidates = React.useCallback((): void => {
    if (!prioritizationId) {
      setCandidateError(
        "Save the Prioritization first, then add items from its Requirement."
      );
      return;
    }
    const fv = "@OData.Community.Display.V1.FormattedValue";
    webAPI
      .retrieveRecord(
        PRIORITIZATION_ENTITY,
        prioritizationId,
        "?$select=_book_requirement_value,_book_requirementfunding_value"
      )
      .then((prio: ComponentFramework.WebApi.Entity) => {
        const direct = prio._book_requirement_value as string | undefined;
        if (direct) return direct;
        const rfId = prio._book_requirementfunding_value as string | undefined;
        if (!rfId) return null;
        return webAPI
          .retrieveRecord(
            REQUIREMENT_FUNDING_ENTITY,
            rfId,
            "?$select=_book_requirement_value"
          )
          .then(
            (rf: ComponentFramework.WebApi.Entity) =>
              (rf._book_requirement_value as string | undefined) ?? null
          );
      })
      .then((requirementId: string | null) => {
        if (!requirementId) {
          setCandidateError(
            "This Prioritization has no Requirement — there are no Requirement Details to add."
          );
          return null;
        }
        return webAPI.retrieveMultipleRecords(
          REQUIREMENT_DETAILS_ENTITY,
          "?$select=book_name,_book_item_value,_book_tdc_value,_book_lin_value,_book_country_value" +
            `&$filter=_book_requirement_value eq ${requirementId} and statecode eq 0` +
            "&$orderby=book_name asc"
        );
      })
      .then((result) => {
        if (!result) return;
        setCandidates(
          result.entities.map((e) => ({
            id: (e.book_requirementdetailsid as string) ?? "",
            name: (e.book_name as string) || "(unnamed)",
            item: (e[`_book_item_value${fv}`] as string) || "",
            tdc: (e[`_book_tdc_value${fv}`] as string) || "",
          }))
        );
        return;
      })
      .catch(() => {
        setCandidateError(
          "Could not load the Requirement's Details — close and try again."
        );
      });
  }, [prioritizationId, webAPI]);

  const openAddDialog = (): void => {
    setCandidates(null);
    setCandidateError(null);
    setSelected(new Set());
    setAddOpen(true);
    loadCandidates();
  };

  const toggleSelected = (rdId: string, checked: boolean): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(rdId);
      else next.delete(rdId);
      return next;
    });
  };

  const addSelected = (): void => {
    if (!prioritizationId || selected.size === 0) return;
    setAddBusy(true);
    Promise.all(
      Array.from(selected).map((rdId) =>
        webAPI.createRecord(ITEMIZED_DETAILS_ENTITY, {
          "book_Prioritization@odata.bind": `/book_prioritizations(${prioritizationId})`,
          "book_RequirementItem@odata.bind": `/book_requirementdetailses(${rdId})`,
        })
      )
    )
      .then(() => {
        setAddBusy(false);
        setAddOpen(false);
        dataset.refresh();
        return;
      })
      .catch(() => {
        setAddBusy(false);
        setCandidateError(
          "Some items could not be added — close the dialog and check the grid."
        );
      });
  };

  // ----- Per-row remove -----
  const [pendingRemove, setPendingRemove] = React.useState<GridRow | null>(
    null
  );
  const [removeBusy, setRemoveBusy] = React.useState(false);

  const confirmRemove = (): void => {
    if (!pendingRemove) return;
    const recordId = pendingRemove.recordId;
    setRemoveBusy(true);
    webAPI
      .deleteRecord(ITEMIZED_DETAILS_ENTITY, recordId)
      .then(() => {
        setRemoveBusy(false);
        setPendingRemove(null);
        dataset.refresh();
        return;
      })
      .catch(() => {
        setRemoveBusy(false);
        setPendingRemove(null);
        setSaveState((prev) => ({ ...prev, [recordId]: "error" }));
      });
  };

  const availableCandidates = React.useMemo(
    () => (candidates ?? []).filter((c) => !existingRdIds.has(c.id)),
    [candidates, existingRdIds]
  );

  const totals = React.useMemo(() => {
    return datasetRows.reduce(
      (acc, row) => ({
        requested: acc.requested + effectiveNumber(row, "requestedAmount"),
        validated: acc.validated + effectiveNumber(row, "validatedAmount"),
        funded: acc.funded + effectiveNumber(row, "fundedAmount"),
      }),
      { requested: 0, validated: 0, funded: 0 }
    );
  }, [datasetRows, edits]);

  const renderStatus = (recordId: string): React.ReactNode => {
    const state = saveState[recordId];
    if (!state) return null;
    if (state === "saving")
      return <Spinner size="extra-tiny" className={styles.status} />;
    if (state === "saved")
      return (
        <span className={`${styles.status} ${styles.statusSaved}`}>Saved</span>
      );
    return (
      <Tooltip content="Save failed — re-check the value" relationship="label">
        <span className={`${styles.status} ${styles.statusError}`}>Error</span>
      </Tooltip>
    );
  };

  const numericCell = (
    row: GridRow,
    field: NumericField,
    className: string
  ): React.ReactNode => (
    <Input
      type="number"
      appearance="filled-lighter"
      className={className}
      disabled={isDisabled}
      value={displayValue(row, field)}
      onChange={(_e, data) => onCellChange(row.recordId, field, data.value)}
      onBlur={() => commitCell(row, field)}
      input={{ style: { textAlign: "center", fontVariantNumeric: "tabular-nums" } }}
    />
  );

  const commentCell = (row: GridRow, field: TextField): React.ReactNode => (
    <Textarea
      appearance="filled-lighter"
      className={styles.commentInput}
      disabled={isDisabled}
      resize="vertical"
      value={displayValue(row, field)}
      onChange={(_e, data) => onCellChange(row.recordId, field, data.value)}
      onBlur={() => commitCell(row, field)}
    />
  );

  // Validated / Funded / NPM Comment are owned by the NPM on the Requirement
  // Funding side (ValidateAndFundGrid) — read-only here on the Prioritization form.
  const readOnlyAmount = (row: GridRow, field: NumericField): React.ReactNode => (
    <span className={styles.amount}>
      {formatCurrency(effectiveNumber(row, field))}
    </span>
  );

  const hasNextPage = !!dataset.paging && dataset.paging.hasNextPage;

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
        <div className={styles.toolbar}>
          <Text weight="semibold">
            Itemized Details ({datasetRows.length})
          </Text>
          <div className={styles.toolbarButtons}>
            {!isDisabled && (
              <Button
                size="small"
                appearance="primary"
                disabled={dataset.loading}
                onClick={openAddDialog}
              >
                Add Items
              </Button>
            )}
            <Button
              size="small"
              appearance="subtle"
              disabled={dataset.loading}
              onClick={() => dataset.refresh()}
            >
              Refresh
            </Button>
          </div>
        </div>

        {dataset.loading ? (
          <Spinner label="Loading Itemized Details…" />
        ) : datasetRows.length === 0 ? (
          <div className={styles.empty}>
            No Itemized Details yet. Use Add Items to select which of the
            Requirement&apos;s Details to itemize on this Prioritization.
          </div>
        ) : (
          <div className={styles.scrollContainer}>
            <Table size="small" aria-label="Itemized Details">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={styles.firstCol}>Item</TableHeaderCell>
                  <TableHeaderCell>TDC</TableHeaderCell>
                  <TableHeaderCell className={styles.qtyCol}>Quantity</TableHeaderCell>
                  <TableHeaderCell className={styles.amount}>Requested</TableHeaderCell>
                  <TableHeaderCell className={styles.amount}>Validated</TableHeaderCell>
                  <TableHeaderCell className={styles.amount}>Funded</TableHeaderCell>
                  <TableHeaderCell>NPM Comment</TableHeaderCell>
                  <TableHeaderCell>State Comment</TableHeaderCell>
                  {!isDisabled && (
                    <TableHeaderCell className={styles.actionCol} />
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasetRows.map((row) => {
                  const ctx = row.requirementItemId
                    ? contexts[row.requirementItemId]
                    : undefined;
                  return (
                    <TableRow key={row.recordId}>
                      <TableCell className={styles.firstCol}>
                        <div className={styles.firstColName}>
                          <span>{ctx?.item?.trim() ? ctx.item : row.requirementItemName}{ctx?.country ? " - " + ctx?.country: ""}</span>
                          {renderStatus(row.recordId)}
                        </div>
                        {ctx?.lin ? (
                          <span className={styles.firstColMeta}>
                            LIN: {ctx?.lin ?? ""}
                          </span> 
                        ) : ""}
                        <span className={styles.firstColMeta}>
                          Cat: {ctx?.category ?? ""}
                        </span>
                        <span className={styles.firstColMeta}>
                          Qty Type: {ctx?.quantityType ?? ""}
                        </span>
                      </TableCell>
                      <TableCell className={styles.contextCell}>
                        {ctx?.tdcId ? (
                          <Link
                            as="button"
                            onClick={() => {
                              void navigation.openForm({
                                entityName: TDC_ENTITY,
                                entityId: ctx.tdcId!,
                                openInNewWindow: false,
                              });
                            }}
                          >
                            {ctx.tdc}
                            {ctx.tdcLongName ? ` — ${ctx.tdcLongName}` : ""}
                          </Link>
                        ) : (
                          ctx?.tdc ?? ""
                        )}
                      </TableCell>
                      <TableCell className={styles.qtyCol}>
                        {numericCell(row, "quantity", styles.qtyInput)}
                      </TableCell>
                      <TableCell className={styles.amount}>
                        {numericCell(row, "requestedAmount", styles.numberInput)}
                      </TableCell>
                      <TableCell className={styles.amount}>
                        {readOnlyAmount(row, "validatedAmount")}
                      </TableCell>
                      <TableCell className={styles.amount}>
                        {readOnlyAmount(row, "fundedAmount")}
                      </TableCell>
                      <TableCell className={styles.contextCell}>
                        {row.npmComment}
                      </TableCell>
                      <TableCell>{commentCell(row, "stateComment")}</TableCell>
                      {!isDisabled && (
                        <TableCell className={styles.actionCol}>
                          <Button
                            size="small"
                            appearance="subtle"
                            onClick={() => setPendingRemove(row)}
                          >
                            Remove
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                <TableRow className={styles.totalsRow}>
                  <TableCell className={styles.firstCol}>Totals</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className={styles.amount}>
                    {formatCurrency(totals.requested)}
                  </TableCell>
                  <TableCell className={styles.amount}>
                    {formatCurrency(totals.validated)}
                  </TableCell>
                  <TableCell className={styles.amount}>
                    {formatCurrency(totals.funded)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  {!isDisabled && <TableCell />}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}

        {hasNextPage && (
          <Button
            size="small"
            appearance="subtle"
            onClick={() => dataset.paging.loadNextPage()}
          >
            Load more
          </Button>
        )}

        <Dialog
          open={addOpen}
          onOpenChange={(_e, data) => {
            if (!addBusy) setAddOpen(data.open);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Add Items from Requirement Details</DialogTitle>
              <DialogContent>
                {candidateError ? (
                  <Text className={styles.dialogError}>{candidateError}</Text>
                ) : candidates === null ? (
                  <Spinner label="Loading Requirement Details…" />
                ) : availableCandidates.length === 0 ? (
                  <Text>
                    Every Requirement Detail on this Requirement is already
                    itemized on this Prioritization.
                  </Text>
                ) : (
                  <div className={styles.addList}>
                    {availableCandidates.map((c) => (
                      <div key={c.id}>
                        <Checkbox
                          checked={selected.has(c.id)}
                          onChange={(_e, data) =>
                            toggleSelected(c.id, data.checked === true)
                          }
                          label={c.item || c.name}
                        />
                        {c.tdc && (
                          <span className={styles.candidateMeta}>
                            TDC: {c.tdc}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  disabled={addBusy}
                  onClick={() => setAddOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  appearance="primary"
                  disabled={addBusy || selected.size === 0}
                  onClick={addSelected}
                >
                  {addBusy
                    ? "Adding…"
                    : `Add ${selected.size > 0 ? selected.size + " " : ""}selected`}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>

        <Dialog
          open={pendingRemove !== null}
          onOpenChange={(_e, data) => {
            if (!removeBusy && !data.open) setPendingRemove(null);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Remove Itemized Detail</DialogTitle>
              <DialogContent>
                <Text>
                  Remove &quot;
                  {pendingRemove
                    ? contexts[pendingRemove.requirementItemId ?? ""]?.item ||
                      pendingRemove.requirementItemName
                    : ""}
                  &quot; from this Prioritization? Its Requested amount will no
                  longer count toward the total.
                </Text>
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  disabled={removeBusy}
                  onClick={() => setPendingRemove(null)}
                >
                  Cancel
                </Button>
                <Button
                  appearance="primary"
                  disabled={removeBusy}
                  onClick={confirmRemove}
                >
                  {removeBusy ? "Removing…" : "Remove"}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      </div>
    </FluentProvider>
  );
};
