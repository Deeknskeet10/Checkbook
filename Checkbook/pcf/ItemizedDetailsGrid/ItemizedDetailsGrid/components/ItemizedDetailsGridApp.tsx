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
} from "@fluentui/react-components";

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;

export interface ItemizedDetailsGridProps {
  dataset: DataSet;
  webAPI: WebApi;
  isDisabled: boolean;
  width: number;
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
  category: string;
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
  contextCell: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  numberInput: {
    minWidth: "96px",
    width: "96px",
  },
  qtyInput: {
    minWidth: "72px",
    width: "72px",
  },
  commentInput: {
    minWidth: "160px",
  },
  totalsRow: {
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  amount: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
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
  const { dataset, webAPI, isDisabled } = props;
  const styles = useStyles();

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
    const rdSelect = "?$select=book_name,_book_item_value,_book_tdc_value";
    const itemSelect = "?$select=_book_quantitytype_value,book_category";
    const fv = "@OData.Community.Display.V1.FormattedValue";

    missing.forEach((id) => {
      webAPI
        .retrieveRecord(REQUIREMENT_DETAILS_ENTITY, id, rdSelect)
        .then((rd: ComponentFramework.WebApi.Entity) => {
          setContexts((prev) => ({
            ...prev,
            [id]: {
              name: (rd.book_name as string) || "",
              item: (rd[`_book_item_value${fv}`] as string) || "",
              quantityType: "",
              tdc: (rd[`_book_tdc_value${fv}`] as string) || "",
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
      input={{ style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
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
          <Button
            size="small"
            appearance="subtle"
            disabled={dataset.loading}
            onClick={() => dataset.refresh()}
          >
            Refresh
          </Button>
        </div>

        {dataset.loading ? (
          <Spinner label="Loading Itemized Details…" />
        ) : datasetRows.length === 0 ? (
          <div className={styles.empty}>
            No Itemized Details yet. They are created automatically when
            Requirement Details are added to the Requirement.
          </div>
        ) : (
          <Table size="small" aria-label="Itemized Details">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Item</TableHeaderCell>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Quantity Type</TableHeaderCell>
                <TableHeaderCell>TDC</TableHeaderCell>
                <TableHeaderCell className={styles.amount}>Quantity</TableHeaderCell>
                <TableHeaderCell className={styles.amount}>Requested</TableHeaderCell>
                <TableHeaderCell className={styles.amount}>Validated</TableHeaderCell>
                <TableHeaderCell className={styles.amount}>Funded</TableHeaderCell>
                <TableHeaderCell>NPM Comment</TableHeaderCell>
                <TableHeaderCell>State Comment</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasetRows.map((row) => {
                const ctx = row.requirementItemId
                  ? contexts[row.requirementItemId]
                  : undefined;
                return (
                  <TableRow key={row.recordId}>
                    <TableCell>
                      {ctx?.item ?? row.requirementItemName}
                      {renderStatus(row.recordId)}
                    </TableCell>
                    <TableCell className={styles.contextCell}>
                      {ctx?.category ?? ""}
                    </TableCell>
                    <TableCell className={styles.contextCell}>
                      {ctx?.quantityType ?? ""}
                    </TableCell>
                    <TableCell className={styles.contextCell}>
                      {ctx?.tdc ?? ""}
                    </TableCell>
                    <TableCell className={styles.amount}>
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
                  </TableRow>
                );
              })}
              <TableRow className={styles.totalsRow}>
                <TableCell>Totals</TableCell>
                <TableCell />
                <TableCell />
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
              </TableRow>
            </TableBody>
          </Table>
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
      </div>
    </FluentProvider>
  );
};
