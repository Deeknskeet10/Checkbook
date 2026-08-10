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
  Dropdown,
  Combobox,
  Option,
  Badge,
} from "@fluentui/react-components";

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;
type Navigation = ComponentFramework.Navigation;

/** Shape of webAPI.retrieveMultipleRecords' resolved value, declared
 * locally since the ComponentFramework.WebApi namespace isn't resolvable
 * from a plain type-position reference in this project's tsconfig. */
interface RetrieveMultipleResult {
  entities: Record<string, unknown>[];
  nextLink?: string;
}

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
  fundCenter: "fundCenter",
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
const FUND_CENTER_ENTITY = "book_fundcenter";
const LIN_ENTITY = "book_lin";
const COUNTRY_ENTITY = "book_country";

/** Shown for a blank Fund Center — the amount rolls up to the state level. */
const STATE_LEVEL_LABEL = "State level";

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
}

interface GridRow {
  recordId: string;
  requirementItemId: string | null;
  requirementItemName: string;
  fundCenterId: string | null;
  fundCenterName: string;
  quantity: number | null;
  requestedAmount: number | null;
  validatedAmount: number | null;
  fundedAmount: number | null;
  npmComment: string;
  stateComment: string;
}

/** Whether the parent Prioritization (rolled up from its Requirement) gates
 * LIN/Country as required on every Itemized Detail row. */
interface PrioLinCountryFlags {
  linRequired: boolean;
  countryRequired: boolean;
}

/** book_lin or book_country reference option, keyed by id. */
interface ReferenceOption {
  id: string;
  name: string;
}

/** book_country adds a CCMD picklist alongside its name. */
interface CountryOption extends ReferenceOption {
  ccmd: string;
}

/** The LIN/Country currently set on one Itemized Details row. */
interface RowLinCountry {
  linId: string | null;
  linName: string;
  countryId: string | null;
  countryName: string;
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
  // squeezing every column into the visible area. Capped/scrollable
  // vertically so long item lists don't push the rest of the form down —
  // the header stays pinned via sticky th below.
  scrollContainer: {
    width: "100%",
    maxHeight: "500px",
    overflowX: "auto",
    overflowY: "auto",
    "& td": {
      ...shorthands.padding("5px"),
      maxWidth: "180px",
    },
    "& tr:hover": {
      backgroundColor: "#fbfbfb"
    },
    "& th": {
      paddingBottom: "8px",
      fontWeight: 600,
      position: "sticky",
      top: 0,
      zIndex: 2,
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  // Fluent's Table defaults to table-layout: fixed, which sizes columns off
  // the header row alone — columns with no explicit header width (Fund
  // Center, LIN, Country, State Comment, …) get squeezed to an arbitrary
  // share of the table's width, so their fixed-width body content (the
  // dropdowns, the comment Textarea) overflows past its own padding and
  // gets clipped at the cell edge. auto sizes every column off its widest
  // cell instead, so padding always has room. minWidth keeps the table from
  // squeezing columns illegibly on narrow forms — scrollContainer's
  // overflowX scrolls the pane horizontally past that point instead.
  tableAutoLayout: {
    tableLayout: "auto",
    minWidth: "700px",
  },
  contextCell: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  tdcLink: {
    maxWidth: "170px",
    minWidth: "100px",
    textWrap: "auto"
  },
  // First column stacks Item name / Category / Quantity Type; Item names can
  // be long, so this is the one column that wraps rather than nowraps.
  // No min/max width of its own — a minWidth here bigger than the blanket
  // 150px td cap above would win over it (min-width always beats max-width
  // in the box calc) and force the column wide even with no content, which
  // is exactly the bug that used to make this column ignore the cap.
  firstCol: {
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
  // Category/Qty Type chips — one line, wrapping to a second only if they
  // don't both fit.
  metaChipRow: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: "4px",
    rowGap: "2px",
    marginTop: "4px",
  },
  // Toolbar legend explaining what the chip colors mean.
  legend: {
    display: "flex",
    alignItems: "center",
    columnGap: "12px",
    marginRight: "4px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    columnGap: "4px",
  },
  legendPip: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
  },
  // Matches the Category/Qty Type Badges' own tint background/foreground
  // exactly (see the Badge usages below) rather than independently-picked
  // colors, so the legend swatch and the chip it explains never drift apart.
  legendPipCategory: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    border: `1px solid ${tokens.colorPaletteGreenBackground2}`,
  },
  legendPipQtyType: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandBackground2Pressed}`,
  },
  numberInput: {
    minWidth: "100px",
    width: "100px",
    maxWidth: "140px",
    backgroundColor: "#f7f7f7",
    ":hover": {
      backgroundColor: "#fff",
      border: "2px solid #b2c3f4",
    },
  },
  qtyCol: {
    textAlign: "center",
    justifyContent: "center",
    minWidth: "90px",
    width: "90px",
  },
  qtyInput: {
    minWidth: "80px",
    width: "80px",
    maxWidth: "140px",
    backgroundColor: "#f7f7f7",
    ":hover": {
      backgroundColor: "#fff",
      border: "2px solid #b2c3f4",
    },
  },
  commentInput: {
    minWidth: "160px",
    width: "160px",
    maxWidth: "200px",
    backgroundColor: "#f7f7f7",
    ":hover": {
      backgroundColor: "#fff",
      border: "2px solid #b2c3f4",
    },
  },
  // Fund Center *column* — kept wider than the dropdown's own minWidth
  // below so the cell has breathing room around it; applied to both the
  // TableHeaderCell and TableCell for this column.
  fcCol: {
    minWidth: "170px",
  },
  // The dropdown itself is capped to the shared 150px td max-width (see
  // scrollContainer's "& td" rule) — it used to have a fixed 170px width,
  // wider than that cap, which overflowed the cell.
  fcDropdown: {
    maxWidth: "150px",
    minWidth: "100px",
    height: "30px",
    backgroundColor: "#f7f7f7",
    ":hover": {
      backgroundColor: "#fff",
      border: "2px solid #b2c3f4",
    },
  },
  // minWidth only (not a fixed width) so the closed field can grow to fit
  // longer LIN/Country names instead of clipping them.
  linCountryDropdown: {
    maxWidth: "150px",
    minWidth: "100px",
    height: "30px",
    backgroundColor: "#f7f7f7",
    ":hover": {
      backgroundColor: "#fff",
      border: "2px solid #b2c3f4",
    },
  },
  // Caps the visible option list to ~6 rows so long reference lists (LIN,
  // Country) don't blow out the popup.
  dropdownOptionScroll: {
    maxHeight: "200px",
    overflowY: "auto",
  },
  // The closed Combobox field is a native <input> — it can never wrap text,
  // only scroll/clip a single line, no matter what CSS is applied to it.
  // Wrapping is only achievable for the open option list, where entries are
  // plain elements, not an input — some country names run long.
  dropdownOptionWrap: {
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
  dropdownNoMatches: {
    display: "block",
    ...shorthands.padding("8px"),
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  secondaryCcmdCell: {
    width: "90px",
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  totalsRow: {
    fontWeight: 600,
    "& td": {
      // Explicit height (rather than relying on Fluent's default small-row
      // height) so loadMoreRow's sticky offset below has a fixed, known
      // value to stack against instead of guessing at internals.
      height: "44px",
      position: "sticky",
      bottom: 0,
      zIndex: 2,
      backgroundColor: tokens.colorNeutralBackground2,
    },
  },
  // Sits directly above the sticky totalsRow — its bottom offset must equal
  // that row's td height (44px) so the two stack flush with no gap/overlap.
  loadMoreRow: {
    "& td": {
      position: "sticky",
      bottom: "44px",
      zIndex: 2,
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  loadMoreButton: {
    width: "100%",
    justifyContent: "center",
    textAlign: "center",
    color: tokens.colorPaletteBlueForeground2,
    fontWeight: 600,
    fontSize: "15px",
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
  // Validated/Funded body cells — right-aligned to match their headers
  // (headerJustifyEnd below). Applied to both the TableCell and the <span>
  // readOnlyAmount renders inside it.
  amountBodyRight: {
    textAlign: "right",
    justifyContent: "flex-end",
    fontVariantNumeric: "tabular-nums",
    minWidth: "120px",
    width: "120px",
  },
  // TableHeaderCell's own text sits in an inner flex "button" slot (a div,
  // not the <th> itself), so aligning it needs justifyContent on that slot
  // — text-align/justifyContent on the <th> root has no effect since a
  // table-cell isn't a flex container. Applied via the `button` slot prop,
  // not `className`. Validated/Funded only — Requested stays centered with
  // its Input.
  headerJustifyEnd: {
    justifyContent: "end",
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
  dialogSearch: {
    width: "100%",
    marginBottom: "8px",
  },
  addListScroll: {
    maxHeight: "360px",
    overflowY: "auto",
  },
  candidateMeta: {
    display: "block",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  dialogError: {
    color: tokens.colorPaletteRedForeground1,
  },
  addDialogSurface: {
    maxWidth: "640px",
  },
  candidateItemLabel: {
    fontWeight: tokens.fontWeightSemibold,
  },
  candidateTdcCell: {
    width: "56px",
    ...shorthands.padding(0, 0, 0, "16px"),
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
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

/** Combobox with a height-capped, scrollable option list — used for
 * LIN/Country pickers whose reference lists run to 100+ entries. Typing
 * directly into the field filters the list; a plain Dropdown can't host a
 * separate focusable search box in its popup because it keeps real keyboard
 * focus pinned on the closed trigger the whole time it's open. */
const SearchableOptionDropdown: React.FC<{
  className: string;
  selectedId: string;
  selectedName: string;
  options: ReferenceOption[];
  /** Currently-selected option missing from `options` (e.g. deactivated
   * after being set) — always shown so the Combobox can render it selected. */
  orphan?: ReferenceOption | null;
  searchPlaceholder: string;
  onSelect: (id: string) => void;
}> = ({
  className,
  selectedId,
  selectedName,
  options,
  orphan,
  searchPlaceholder,
  onSelect,
}) => {
  const styles = useStyles();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(selectedName);

  // Mirror the committed selection into the field whenever the popup is
  // closed — reverts stray typed text that was never turned into a
  // selection, and picks up edits made elsewhere (e.g. a row's LIN/Country
  // set by a Fund Center cascade).
  React.useEffect(() => {
    if (!open) setQuery(selectedName);
  }, [selectedName, open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.name.toLowerCase().includes(q))
    : options;

  return (
    <Combobox
      size="small"
      appearance="filled-lighter"
      className={className}
      placeholder={searchPlaceholder}
      freeform
      // Combobox normally portals its popup to document.body, which lands
      // outside this control's <FluentProvider> — the popup then has no
      // access to the theme's CSS variables and renders with a transparent
      // background. inlinePopup keeps it a normal DOM child (still
      // positioned via Floating UI, so it still floats over the row) so it
      // stays inside the themed subtree.
      inlinePopup
      value={query}
      selectedOptions={selectedId ? [selectedId] : []}
      listbox={{ className: styles.dropdownOptionScroll }}
      onChange={(e) => setQuery(e.target.value)}
      onOptionSelect={(_e, data) => onSelect(data.optionValue ?? "")}
      onOpenChange={(_e, data) => setOpen(data.open)}
    >
      {orphan && (
        <Option className={styles.dropdownOptionWrap} value={orphan.id}>
          {orphan.name}
        </Option>
      )}
      {filtered.length === 0 ? (
        <Text className={styles.dropdownNoMatches}>No matches</Text>
      ) : (
        filtered.map((o) => (
          <Option
            key={o.id}
            className={styles.dropdownOptionWrap}
            value={o.id}
          >
            {o.name}
          </Option>
        ))
      )}
    </Combobox>
  );
};

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
        fundCenterId: extractLookupId(record.getValue(ALIAS.fundCenter)),
        fundCenterName: record.getFormattedValue(ALIAS.fundCenter) || "",
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
      "?$select=book_name,_book_item_value,_book_tdc_value";
    const itemSelect = "?$select=_book_quantitytype_value,book_category";
    const tdcSelect = "?$select=book_tdcname";
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

  // ----- Fund Center choices (filtered to the Prioritization's state) -----
  // null while loading; [] when the Prio has no state or the query fails, in
  // which case rows can still be set back to state level but not to an FC.
  const [fundCenters, setFundCenters] = React.useState<
    { id: string; name: string }[] | null
  >(null);
  // recordId -> committed FC id ("" = state level). Mirrors `edits`: overrides
  // the dataset value until the grid refreshes.
  const [fcEdits, setFcEdits] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!prioritizationId) {
      setFundCenters([]);
      return;
    }
    let cancelled = false;
    webAPI
      .retrieveRecord(
        PRIORITIZATION_ENTITY,
        prioritizationId,
        "?$select=_book_state_value"
      )
      .then((prio: ComponentFramework.WebApi.Entity) => {
        const stateId = prio._book_state_value as string | undefined;
        if (!stateId) return null;
        return webAPI.retrieveMultipleRecords(
          FUND_CENTER_ENTITY,
          "?$select=book_name" +
            `&$filter=_book_state_value eq ${stateId} and statecode eq 0` +
            "&$orderby=book_name asc"
        );
      })
      .then((result) => {
        if (cancelled) return;
        setFundCenters(
          result
            ? result.entities.map((e) => ({
                id: (e.book_fundcenterid as string) ?? "",
                name: (e.book_name as string) || "(unnamed)",
              }))
            : []
        );
        return;
      })
      .catch(() => {
        if (!cancelled) setFundCenters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [prioritizationId, webAPI]);

  // ----- LIN / Country requirement gate (rolled up from the Requirement) -----
  const [prioFlags, setPrioFlags] = React.useState<PrioLinCountryFlags | null>(
    null
  );

  React.useEffect(() => {
    if (!prioritizationId) {
      setPrioFlags({ linRequired: false, countryRequired: false });
      return;
    }
    let cancelled = false;
    webAPI
      .retrieveRecord(
        PRIORITIZATION_ENTITY,
        prioritizationId,
        "?$select=book_linrequired,book_countryrequired"
      )
      .then((prio: ComponentFramework.WebApi.Entity) => {
        if (cancelled) return;
        setPrioFlags({
          linRequired: !!prio.book_linrequired,
          countryRequired: !!prio.book_countryrequired,
        });
        return;
      })
      .catch(() => {
        if (!cancelled) setPrioFlags({ linRequired: false, countryRequired: false });
      });
    return () => {
      cancelled = true;
    };
  }, [prioritizationId, webAPI]);

  // LIN/Country reference lists, loaded once each only when the corresponding
  // flag is set — most Prioritizations need neither.
  const [linOptions, setLinOptions] = React.useState<ReferenceOption[] | null>(
    null
  );
  const [countryOptions, setCountryOptions] = React.useState<
    CountryOption[] | null
  >(null);

  React.useEffect(() => {
    if (!prioFlags?.linRequired || linOptions !== null) return;
    let cancelled = false;
    webAPI
      .retrieveMultipleRecords(
        LIN_ENTITY,
        "?$select=book_name&$filter=statecode eq 0&$orderby=book_name asc"
      )
      .then((result) => {
        if (cancelled) return;
        setLinOptions(
          result.entities.map((e) => ({
            id: (e.book_linid as string) ?? "",
            name: (e.book_name as string) || "(unnamed)",
          }))
        );
        return;
      })
      .catch(() => {
        if (!cancelled) setLinOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [prioFlags, linOptions, webAPI]);

  React.useEffect(() => {
    if (!prioFlags?.countryRequired || countryOptions !== null) return;
    let cancelled = false;
    const fv = "@OData.Community.Display.V1.FormattedValue";
    webAPI
      .retrieveMultipleRecords(
        COUNTRY_ENTITY,
        "?$select=book_name,book_ccmd&$filter=statecode eq 0&$orderby=book_name asc"
      )
      .then((result) => {
        if (cancelled) return;
        setCountryOptions(
          result.entities.map((e) => ({
            id: (e.book_countryid as string) ?? "",
            name: (e.book_name as string) || "(unnamed)",
            ccmd: (e[`book_ccmd${fv}`] as string) || "",
          }))
        );
        return;
      })
      .catch(() => {
        if (!cancelled) setCountryOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [prioFlags, countryOptions, webAPI]);

  // Current LIN/Country on each existing Itemized Details row — these live
  // directly on book_itemizeddetails, not on the linked Requirement Detail,
  // so they're fetched per row rather than via the `contexts` lookup above.
  const [itemLinCountry, setItemLinCountry] = React.useState<
    Record<string, RowLinCountry>
  >({});

  React.useEffect(() => {
    if (!prioFlags || (!prioFlags.linRequired && !prioFlags.countryRequired)) {
      return;
    }
    const missing = datasetRows
      .map((r) => r.recordId)
      .filter((id) => !itemLinCountry[id]);
    if (missing.length === 0) return;

    const fv = "@OData.Community.Display.V1.FormattedValue";
    missing.forEach((id) => {
      webAPI
        .retrieveRecord(
          ITEMIZED_DETAILS_ENTITY,
          id,
          "?$select=_book_lin_value,_book_country_value"
        )
        .then((e: ComponentFramework.WebApi.Entity) => {
          setItemLinCountry((prev) => ({
            ...prev,
            [id]: {
              linId: (e._book_lin_value as string | undefined) ?? null,
              linName: (e[`_book_lin_value${fv}`] as string) || "",
              countryId: (e._book_country_value as string | undefined) ?? null,
              countryName: (e[`_book_country_value${fv}`] as string) || "",
            },
          }));
          return;
        })
        .catch(() => {
          /* leave LIN/Country blank on failure */
        });
    });
  }, [datasetRows, itemLinCountry, webAPI, prioFlags]);

  // recordId -> committed LIN/Country id. Mirrors `fcEdits`, but neither can
  // be cleared back to blank once set — both are required whenever shown.
  const [linEdits, setLinEdits] = React.useState<Record<string, string>>({});
  const [countryEdits, setCountryEdits] = React.useState<Record<string, string>>(
    {}
  );

  const commitLin = (row: GridRow, linId: string): void => {
    const current = linEdits[row.recordId] ?? itemLinCountry[row.recordId]?.linId ?? "";
    if (!linId || linId === current) return;
    setLinEdits((prev) => ({ ...prev, [row.recordId]: linId }));
    persist(row.recordId, { "book_LIN@odata.bind": `/book_lins(${linId})` });
  };

  const commitCountry = (row: GridRow, countryId: string): void => {
    const current =
      countryEdits[row.recordId] ?? itemLinCountry[row.recordId]?.countryId ?? "";
    if (!countryId || countryId === current) return;
    setCountryEdits((prev) => ({ ...prev, [row.recordId]: countryId }));
    persist(row.recordId, {
      "book_Country@odata.bind": `/book_countries(${countryId})`,
    });
  };

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

  /** Writes an update payload for one record, driving its save indicator. */
  const persist = (recordId: string, payload: Record<string, unknown>): void => {
    setSaveState((prev) => ({ ...prev, [recordId]: "saving" }));
    const touchesAmount = aliasToLogical[ALIAS.requestedAmount] in payload;
    webAPI
      .updateRecord(ITEMIZED_DETAILS_ENTITY, recordId, payload)
      .then(() => {
        setSaveState((prev) => ({ ...prev, [recordId]: "saved" }));
        window.setTimeout(() => {
          setSaveState((prev) => {
            const next = { ...prev };
            if (next[recordId] === "saved") delete next[recordId];
            return next;
          });
        }, 2500);
        if (touchesAmount) fetchAllTotals();
        return;
      })
      .catch(() => {
        setSaveState((prev) => ({ ...prev, [recordId]: "error" }));
      });
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

    persist(row.recordId, { [logicalName]: newValue });
  };

  /** Persists a Fund Center pick immediately ("" clears back to state level). */
  const commitFundCenter = (row: GridRow, fcId: string): void => {
    const current = fcEdits[row.recordId] ?? row.fundCenterId ?? "";
    if (fcId === current) return;
    setFcEdits((prev) => ({ ...prev, [row.recordId]: fcId }));
    persist(row.recordId, {
      "book_FundCenter@odata.bind": fcId ? `/book_fundcenters(${fcId})` : null,
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
  const [candidateSearch, setCandidateSearch] = React.useState("");
  // Second screen of the flow, shown only when the Prioritization requires a
  // LIN or Country pick per row — see Scenarios 2/3 below.
  const [addStep, setAddStep] = React.useState<
    "select-rd" | "select-lin" | "select-country"
  >("select-rd");
  const [selectedSecondary, setSelectedSecondary] = React.useState<
    Set<string>
  >(new Set());
  const [secondarySearch, setSecondarySearch] = React.useState("");

  const existingRdIds = React.useMemo(() => {
    const ids = new Set<string>();
    datasetRows.forEach((r) => {
      if (r.requirementItemId) ids.add(r.requirementItemId);
    });
    return ids;
  }, [datasetRows]);

  // requirementItemId::linId / ::countryId pairs already itemized on this
  // Prioritization — Scenarios 2/3 let the same Requirement Detail repeat, but
  // each LIN or Country combination may only appear once (book_TempKey).
  const existingLinPairs = React.useMemo(() => {
    const pairs = new Set<string>();
    datasetRows.forEach((r) => {
      const linId = itemLinCountry[r.recordId]?.linId;
      if (r.requirementItemId && linId) pairs.add(`${r.requirementItemId}::${linId}`);
    });
    return pairs;
  }, [datasetRows, itemLinCountry]);

  const existingCountryPairs = React.useMemo(() => {
    const pairs = new Set<string>();
    datasetRows.forEach((r) => {
      const countryId = itemLinCountry[r.recordId]?.countryId;
      if (r.requirementItemId && countryId) {
        pairs.add(`${r.requirementItemId}::${countryId}`);
      }
    });
    return pairs;
  }, [datasetRows, itemLinCountry]);

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
          "?$select=book_name,_book_item_value,_book_tdc_value" +
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
    setCandidateSearch("");
    setAddStep("select-rd");
    setSelectedSecondary(new Set());
    setSecondarySearch("");
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

  const toggleSecondary = (id: string, checked: boolean): void => {
    setSelectedSecondary((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  /** Scenario 1 (neither LIN nor Country required) — creates directly. */
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
        fetchAllTotals();
        return;
      })
      .catch(() => {
        setAddBusy(false);
        setCandidateError(
          "Some items could not be added — close the dialog and check the grid."
        );
      });
  };

  /** From the Requirement Details step: either creates directly (Scenario 1)
   * or advances to the LIN/Country picker (Scenarios 2/3). Both required
   * (Scenario 4) never happens on a real Prioritization — LIN wins if it did. */
  const proceedFromRdStep = (): void => {
    if (selected.size === 0) return;
    if (prioFlags?.linRequired) {
      setSelectedSecondary(new Set());
      setSecondarySearch("");
      setAddStep("select-lin");
      return;
    }
    if (prioFlags?.countryRequired) {
      setSelectedSecondary(new Set());
      setSecondarySearch("");
      setAddStep("select-country");
      return;
    }
    addSelected();
  };

  /** Scenarios 2/3 — creates one Itemized Detail per (Requirement Detail x
   * LIN/Country) pair, skipping any combination already itemized. */
  const addPairs = (): void => {
    if (!prioritizationId || selected.size === 0 || selectedSecondary.size === 0) {
      return;
    }
    const isLin = addStep === "select-lin";
    const existingPairs = isLin ? existingLinPairs : existingCountryPairs;
    const pairs: { rdId: string; secId: string }[] = [];
    selected.forEach((rdId) => {
      selectedSecondary.forEach((secId) => {
        if (!existingPairs.has(`${rdId}::${secId}`)) pairs.push({ rdId, secId });
      });
    });
    if (pairs.length === 0) {
      setCandidateError(
        "Every selected combination is already itemized on this Prioritization."
      );
      return;
    }
    setAddBusy(true);
    Promise.all(
      pairs.map(({ rdId, secId }) =>
        webAPI.createRecord(ITEMIZED_DETAILS_ENTITY, {
          "book_Prioritization@odata.bind": `/book_prioritizations(${prioritizationId})`,
          "book_RequirementItem@odata.bind": `/book_requirementdetailses(${rdId})`,
          ...(isLin
            ? { "book_LIN@odata.bind": `/book_lins(${secId})` }
            : { "book_Country@odata.bind": `/book_countries(${secId})` }),
        })
      )
    )
      .then(() => {
        setAddBusy(false);
        setAddOpen(false);
        dataset.refresh();
        fetchAllTotals();
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
        fetchAllTotals();
        return;
      })
      .catch(() => {
        setRemoveBusy(false);
        setPendingRemove(null);
        setSaveState((prev) => ({ ...prev, [recordId]: "error" }));
      });
  };

  // Scenario 1 (neither LIN nor Country required) still hides an already-
  // itemized Requirement Detail, since it can only be itemized once. Once
  // either is required, the same Requirement Detail may repeat — the actual
  // duplicate check is per (RD, LIN/Country) pair, done in addPairs.
  const availableCandidates = React.useMemo(() => {
    if (prioFlags?.linRequired || prioFlags?.countryRequired) {
      return candidates ?? [];
    }
    return (candidates ?? []).filter((c) => !existingRdIds.has(c.id));
  }, [candidates, existingRdIds, prioFlags]);

  const filteredCandidates = React.useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    if (!q) return availableCandidates;
    return availableCandidates.filter((c) =>
      [c.item || c.name, c.tdc].some((v) =>
        v.toLowerCase().includes(q)
      )
    );
  }, [availableCandidates, candidateSearch]);

  const filteredLinOptions = React.useMemo(() => {
    const q = secondarySearch.trim().toLowerCase();
    const opts = linOptions ?? [];
    if (!q) return opts;
    return opts.filter((o) => o.name.toLowerCase().includes(q));
  }, [linOptions, secondarySearch]);

  const filteredCountryOptions = React.useMemo(() => {
    const q = secondarySearch.trim().toLowerCase();
    const opts = countryOptions ?? [];
    if (!q) return opts;
    return opts.filter(
      (o) =>
        o.name.toLowerCase().includes(q) || o.ccmd.toLowerCase().includes(q)
    );
  }, [countryOptions, secondarySearch]);

  /** How many new Itemized Details the current secondary selection would
   * actually create, after skipping combinations that already exist. */
  const pendingPairCount = React.useMemo(() => {
    if (selected.size === 0 || selectedSecondary.size === 0) return 0;
    const existingPairs =
      addStep === "select-lin" ? existingLinPairs : existingCountryPairs;
    let count = 0;
    selected.forEach((rdId) => {
      selectedSecondary.forEach((secId) => {
        if (!existingPairs.has(`${rdId}::${secId}`)) count += 1;
      });
    });
    return count;
  }, [selected, selectedSecondary, addStep, existingLinPairs, existingCountryPairs]);

  // Visible-page-only totals — always accurate for whatever's currently
  // loaded/edited, used as the immediate/fallback figure.
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

  // True totals across every Itemized Detail on this Prioritization, not
  // just the page(s) currently paged into the grid — fetched straight from
  // the Web API (bypassing dataset paging) since PCF datasets only expose
  // one page of sortedRecordIds at a time. Falls back to the visible-page
  // totals above while loading or if the fetch fails.
  const [allTotals, setAllTotals] = React.useState<{
    requested: number;
    validated: number;
    funded: number;
  } | null>(null);

  const fetchAllTotals = React.useCallback(() => {
    if (!prioritizationId) {
      setAllTotals(null);
      return;
    }
    const requestedField = aliasToLogical[ALIAS.requestedAmount];
    const validatedField = aliasToLogical[ALIAS.validatedAmount];
    const fundedField = aliasToLogical[ALIAS.fundedAmount];
    if (!requestedField || !validatedField || !fundedField) return;

    let cancelled = false;
    const acc = { requested: 0, validated: 0, funded: 0 };

    function fetchPage(options: string): Promise<void> {
      return webAPI
        .retrieveMultipleRecords(ITEMIZED_DETAILS_ENTITY, options, 5000)
        .then((result: RetrieveMultipleResult) => {
          for (const entity of result.entities) {
            acc.requested += Number(entity[requestedField]) || 0;
            acc.validated += Number(entity[validatedField]) || 0;
            acc.funded += Number(entity[fundedField]) || 0;
          }
          if (result.nextLink) {
            return fetchPage(result.nextLink.slice(result.nextLink.indexOf("?")));
          }
          return undefined;
        });
    }

    fetchPage(
      `?$select=${requestedField},${validatedField},${fundedField}` +
        `&$filter=_book_prioritization_value eq ${prioritizationId}`
    )
      .then(() => {
        if (!cancelled) setAllTotals({ ...acc });
        return;
      })
      .catch(() => {
        if (!cancelled) setAllTotals(null);
      });

    return () => {
      cancelled = true;
    };
  }, [prioritizationId, aliasToLogical, webAPI]);

  React.useEffect(() => fetchAllTotals(), [fetchAllTotals]);

  const displayTotals = allTotals ?? totals;

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

  const fundCenterCell = (row: GridRow): React.ReactNode => {
    const selectedId = fcEdits[row.recordId] ?? row.fundCenterId ?? "";
    const listedName = fundCenters?.find((fc) => fc.id === selectedId)?.name;
    const selectedName =
      selectedId === ""
        ? STATE_LEVEL_LABEL
        : listedName ??
          (row.fundCenterName !== "" ? row.fundCenterName : "(unknown)");
    if (isDisabled) {
      return <span className={styles.contextCell}>{selectedName}</span>;
    }
    // An FC from outside the state's list (or set before the list loaded)
    // still needs an option so the Dropdown can display it as selected.
    const orphan =
      selectedId !== "" && !fundCenters?.some((fc) => fc.id === selectedId);
    return (
      <Dropdown
        size="small"
        appearance="filled-lighter"
        className={styles.fcDropdown}
        value={selectedName}
        selectedOptions={[selectedId]}
        onOptionSelect={(_e, data) =>
          commitFundCenter(row, data.optionValue ?? "")
        }
      >
        <Option value="">{STATE_LEVEL_LABEL}</Option>
        {orphan && <Option value={selectedId}>{selectedName}</Option>}
        {(fundCenters ?? []).map((fc) => (
          <Option key={fc.id} value={fc.id}>
            {fc.name}
          </Option>
        ))}
      </Dropdown>
    );
  };

  // LIN and Country are required whenever shown — unlike Fund Center there is
  // no blank option, so a value can be changed but never cleared.
  const linCell = (row: GridRow): React.ReactNode => {
    const rowCtx = itemLinCountry[row.recordId];
    const selectedId = linEdits[row.recordId] ?? rowCtx?.linId ?? "";
    const listedName = linOptions?.find((l) => l.id === selectedId)?.name;
    const selectedName = listedName ?? rowCtx?.linName ?? "";
    if (isDisabled) {
      return <span className={styles.contextCell}>{selectedName}</span>;
    }
    const orphan =
      selectedId !== "" && !linOptions?.some((l) => l.id === selectedId)
        ? { id: selectedId, name: selectedName }
        : null;
    return (
      <SearchableOptionDropdown
        className={styles.linCountryDropdown}
        selectedId={selectedId}
        selectedName={selectedName}
        options={linOptions ?? []}
        orphan={orphan}
        searchPlaceholder="Search LIN"
        onSelect={(id) => commitLin(row, id)}
      />
    );
  };

  const countryCell = (row: GridRow): React.ReactNode => {
    const rowCtx = itemLinCountry[row.recordId];
    const selectedId = countryEdits[row.recordId] ?? rowCtx?.countryId ?? "";
    const listedName = countryOptions?.find((c) => c.id === selectedId)?.name;
    const selectedName = listedName ?? rowCtx?.countryName ?? "";
    if (isDisabled) {
      return <span className={styles.contextCell}>{selectedName}</span>;
    }
    const orphan =
      selectedId !== "" && !countryOptions?.some((c) => c.id === selectedId)
        ? { id: selectedId, name: selectedName }
        : null;
    return (
      <SearchableOptionDropdown
        className={styles.linCountryDropdown}
        selectedId={selectedId}
        selectedName={selectedName}
        options={countryOptions ?? []}
        orphan={orphan}
        searchPlaceholder="Search Country"
        onSelect={(id) => commitCountry(row, id)}
      />
    );
  };

  // Validated / Funded / NPM Comment are owned by the NPM on the Requirement
  // Funding side (ValidateAndFundGrid) — read-only here on the Prioritization form.
  const readOnlyAmount = (row: GridRow, field: NumericField): React.ReactNode => (
    <span className={styles.amountBodyRight}>
      {formatCurrency(effectiveNumber(row, field))}
    </span>
  );

  const hasNextPage = !!dataset.paging && dataset.paging.hasNextPage;

  // Item, TDC, Fund Center, Quantity, Requested, Validated, Funded, NPM
  // Comment, State Comment — plus whichever of LIN/Country/Action are
  // showing. Used to span the sticky Load More row across every column.
  const columnCount =
    9 +
    (prioFlags?.linRequired ? 1 : 0) +
    (prioFlags?.countryRequired ? 1 : 0) +
    (!isDisabled ? 1 : 0);

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
        <div className={styles.toolbar}>
          <Text weight="semibold">
            Itemized Details ({datasetRows.length})
          </Text>
          <div className={styles.toolbarButtons}>
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span
                  className={`${styles.legendPip} ${styles.legendPipCategory}`}
                />
                Category
              </span>
              <span className={styles.legendItem}>
                <span
                  className={`${styles.legendPip} ${styles.legendPipQtyType}`}
                />
                Qty Type
              </span>
            </div>
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
              onClick={() => {
                dataset.refresh();
                fetchAllTotals();
              }}
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
            <Table
              size="small"
              aria-label="Itemized Details"
              className={styles.tableAutoLayout}
            >
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={styles.firstCol}>Item</TableHeaderCell>
                  <TableHeaderCell>TDC</TableHeaderCell>
                  <TableHeaderCell className={styles.fcCol}>Fund Center</TableHeaderCell>
                  {prioFlags?.linRequired && <TableHeaderCell>LIN</TableHeaderCell>}
                  {prioFlags?.countryRequired && (
                    <TableHeaderCell>Country</TableHeaderCell>
                  )}
                  <TableHeaderCell className={styles.qtyCol}>Quantity</TableHeaderCell>
                  <TableHeaderCell className={styles.amount}>Requested</TableHeaderCell>
                  <TableHeaderCell
                    className={styles.amount}
                    button={{ className: styles.headerJustifyEnd }}
                  >
                    Validated
                  </TableHeaderCell>
                  <TableHeaderCell
                    className={styles.amount}
                    button={{ className: styles.headerJustifyEnd }}
                  >
                    Funded
                  </TableHeaderCell>
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
                          <span>{ctx?.item?.trim() ? ctx.item : row.requirementItemName}</span>
                          {renderStatus(row.recordId)}
                        </div>
                        <div className={styles.metaChipRow}>
                          {ctx?.category && (
                            <Badge appearance="tint" color="success" size="small">
                              {ctx.category}
                            </Badge>
                          )}
                          {ctx?.quantityType && (
                            // "informative" renders as neutral gray in
                            // Fluent's theme, not blue — "brand" is this
                            // theme's actual blue, matching legendPipQtyType.
                            <Badge appearance="tint" color="brand" size="small">
                              {ctx.quantityType}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={styles.contextCell}>
                        {ctx?.tdcId ? (
                          <Link
                            as="button"
                            className={styles.tdcLink}
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
                      <TableCell className={styles.fcCol}>{fundCenterCell(row)}</TableCell>
                      {prioFlags?.linRequired && (
                        <TableCell>{linCell(row)}</TableCell>
                      )}
                      {prioFlags?.countryRequired && (
                        <TableCell>{countryCell(row)}</TableCell>
                      )}
                      <TableCell className={styles.qtyCol}>
                        {numericCell(row, "quantity", styles.qtyInput)}
                      </TableCell>
                      <TableCell className={styles.amount}>
                        {numericCell(row, "requestedAmount", styles.numberInput)}
                      </TableCell>
                      <TableCell className={styles.amountBodyRight}>
                        {readOnlyAmount(row, "validatedAmount")}
                      </TableCell>
                      <TableCell className={styles.amountBodyRight}>
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
                {hasNextPage && (
                  <TableRow className={styles.loadMoreRow}>
                    <TableCell colSpan={columnCount}>
                      <Button
                        size="small"
                        appearance="subtle"
                        className={styles.loadMoreButton}
                        onClick={() => dataset.paging.loadNextPage()}
                      >
                        Load more
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
                <TableRow className={styles.totalsRow}>
                  <TableCell className={styles.firstCol}>Totals</TableCell>
                  <TableCell />
                  <TableCell />
                  {prioFlags?.linRequired && <TableCell />}
                  {prioFlags?.countryRequired && <TableCell />}
                  <TableCell />
                  <TableCell className={styles.amount}>
                    {formatCurrency(displayTotals.requested)}
                  </TableCell>
                  <TableCell className={styles.amountBodyRight}>
                    {formatCurrency(displayTotals.validated)}
                  </TableCell>
                  <TableCell className={styles.amountBodyRight}>
                    {formatCurrency(displayTotals.funded)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  {!isDisabled && <TableCell />}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog
          open={addOpen}
          onOpenChange={(_e, data) => {
            if (!addBusy) setAddOpen(data.open);
          }}
        >
          <DialogSurface className={styles.addDialogSurface}>
            <DialogBody>
              {addStep === "select-rd" ? (
                <>
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
                      <>
                        <Input
                          className={styles.dialogSearch}
                          appearance="outline"
                          placeholder="Search by Item Name or TDC"
                          value={candidateSearch}
                          onChange={(_e, data) => setCandidateSearch(data.value)}
                        />
                        {filteredCandidates.length === 0 ? (
                          <Text className={styles.candidateMeta}>
                            No Requirement Details match that search.
                          </Text>
                        ) : (
                          <div className={styles.addListScroll}>
                            <Table size="small" aria-label="Requirement Details">
                              <TableHeader>
                                <TableRow>
                                  <TableHeaderCell>Item Name</TableHeaderCell>
                                  <TableHeaderCell className={styles.candidateTdcCell}>
                                    TDC
                                  </TableHeaderCell>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredCandidates.map((c) => (
                                  <TableRow key={c.id}>
                                    <TableCell>
                                      <Checkbox
                                        checked={selected.has(c.id)}
                                        onChange={(_e, data) =>
                                          toggleSelected(c.id, data.checked === true)
                                        }
                                        label={
                                          <span className={styles.candidateItemLabel}>
                                            {c.item || c.name}
                                          </span>
                                        }
                                      />
                                    </TableCell>
                                    <TableCell className={styles.candidateTdcCell}>
                                      {c.tdc}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </>
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
                      onClick={proceedFromRdStep}
                    >
                      {prioFlags?.linRequired || prioFlags?.countryRequired
                        ? "Next"
                        : `Add ${selected.size > 0 ? selected.size + " " : ""}selected`}
                    </Button>
                  </DialogActions>
                </>
              ) : (
                <>
                  <DialogTitle>
                    {addStep === "select-lin" ? "Select LIN" : "Select Country"}
                  </DialogTitle>
                  <DialogContent>
                    {candidateError ? (
                      <Text className={styles.dialogError}>{candidateError}</Text>
                    ) : addStep === "select-lin" && linOptions === null ? (
                      <Spinner label="Loading LIN…" />
                    ) : addStep === "select-country" && countryOptions === null ? (
                      <Spinner label="Loading Country…" />
                    ) : (
                      <>
                        <Input
                          className={styles.dialogSearch}
                          appearance="outline"
                          placeholder={
                            addStep === "select-lin"
                              ? "Search by LIN"
                              : "Search by Partner or CCMD"
                          }
                          value={secondarySearch}
                          onChange={(_e, data) => setSecondarySearch(data.value)}
                        />
                        {addStep === "select-lin" ? (
                          filteredLinOptions.length === 0 ? (
                            <Text className={styles.candidateMeta}>
                              No LIN match that search.
                            </Text>
                          ) : (
                            <div className={styles.addListScroll}>
                              <Table size="small" aria-label="LIN">
                                <TableHeader>
                                  <TableRow>
                                    <TableHeaderCell>LIN</TableHeaderCell>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {filteredLinOptions.map((o) => (
                                    <TableRow key={o.id}>
                                      <TableCell>
                                        <Checkbox
                                          checked={selectedSecondary.has(o.id)}
                                          onChange={(_e, data) =>
                                            toggleSecondary(o.id, data.checked === true)
                                          }
                                          label={
                                            <span className={styles.candidateItemLabel}>
                                              {o.name}
                                            </span>
                                          }
                                        />
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )
                        ) : filteredCountryOptions.length === 0 ? (
                          <Text className={styles.candidateMeta}>
                            No Country match that search.
                          </Text>
                        ) : (
                          <div className={styles.addListScroll}>
                            <Table size="small" aria-label="Country">
                              <TableHeader>
                                <TableRow>
                                  <TableHeaderCell>Partner</TableHeaderCell>
                                  <TableHeaderCell className={styles.secondaryCcmdCell}>
                                    CCMD
                                  </TableHeaderCell>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredCountryOptions.map((o) => (
                                  <TableRow key={o.id}>
                                    <TableCell>
                                      <Checkbox
                                        checked={selectedSecondary.has(o.id)}
                                        onChange={(_e, data) =>
                                          toggleSecondary(o.id, data.checked === true)
                                        }
                                        label={
                                          <span className={styles.candidateItemLabel}>
                                            {o.name}
                                          </span>
                                        }
                                      />
                                    </TableCell>
                                    <TableCell className={styles.secondaryCcmdCell}>
                                      {o.ccmd}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </>
                    )}
                  </DialogContent>
                  <DialogActions>
                    <Button
                      appearance="secondary"
                      disabled={addBusy}
                      onClick={() => {
                        setCandidateError(null);
                        setAddStep("select-rd");
                      }}
                    >
                      Back
                    </Button>
                    <Button
                      appearance="secondary"
                      disabled={addBusy}
                      onClick={() => setAddOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      appearance="primary"
                      disabled={addBusy || pendingPairCount === 0}
                      onClick={addPairs}
                    >
                      {addBusy
                        ? "Adding…"
                        : `Add ${pendingPairCount > 0 ? pendingPairCount + " " : ""}item${pendingPairCount === 1 ? "" : "s"}`}
                    </Button>
                  </DialogActions>
                </>
              )}
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
