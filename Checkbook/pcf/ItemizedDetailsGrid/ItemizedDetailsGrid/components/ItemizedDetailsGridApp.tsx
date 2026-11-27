import * as React from "react";
import {
  FluentProvider,
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
  Spinner,
  Text,
  Button,
  Tooltip,
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
} from "@fluentui/react-components";
import {
  CB,
  checkbookTheme,
  AddIcon,
  DeleteIcon,
  RefreshIcon,
  SearchIcon,
  SortIcon,
  useChoiceStyles,
  MoneyInput,
  QuantityInput,
  formatMoney,
  ChipList,
  ChipData,
  ItemName,
  TagLabel,
  HyperlinkLabel,
  NoteCell,
  PortalRootContext,
} from "./designSystem";

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
  // minWidth: 0 + maxWidth keep the root at the form section's width. Without
  // them the root grows to the table's natural width, the form clips it, and
  // scrollContainer never gets a narrower box to scroll inside.
  root: {
    ...shorthands.padding("8px"),
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    fontFamily: tokens.fontFamilyBase,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: "4px",
    ...shorthands.padding("4px", "2px", "8px", "2px"),
  },
  // Grid (Design Documentation.md §7): 40px header band with 11px / 700 /
  // UPPERCASE labels, 56px rows, hairline dividers. Cell side padding is 8px
  // (the doc's 16px made this wide grid overflow the form). Capped/scrollable
  // both ways so long item lists don't push the rest of the form down; header
  // and totals stay pinned via sticky cells.
  scrollContainer: {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    maxHeight: "560px",
    overflowX: "auto",
    overflowY: "auto",
    "& th": {
      height: "40px",
      ...shorthands.padding("0", "8px"),
      position: "sticky",
      top: 0,
      zIndex: 2,
      backgroundColor: CB.tableHead,
      color: tokens.colorNeutralForeground2,
      fontSize: "11px",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      whiteSpace: "nowrap",
    },
    "& th:first-child": { borderTopLeftRadius: "8px", borderBottomLeftRadius: "8px" },
    "& th:last-child": { borderTopRightRadius: "8px", borderBottomRightRadius: "8px" },
    // The header row itself carries Fluent's bottom border — the band has none.
    "& thead tr": { borderBottomStyle: "none" },
    "& td": {
      // Minimum only — a td grows to its content (32px inputs, item name +
      // chips), so rows size to their tallest cell.
      height: "20px",
      ...shorthands.padding("6px", "8px"),
      maxWidth: "220px",
    },
    "& tbody tr": { borderBottomColor: CB.rowLine },
    "& tbody tr:hover": { backgroundColor: CB.rowHover },
  },
  // Fluent's Table defaults to table-layout: fixed, which sizes columns off
  // the header row alone and clips fixed-width body content (dropdowns,
  // numeric boxes, the comment Textarea). auto sizes every column off its
  // widest cell. minWidth keeps columns legible on narrow forms —
  // scrollContainer's overflowX scrolls past that point instead.
  tableAutoLayout: {
    tableLayout: "auto",
    minWidth: "760px",
  },
  // Checked rows (§7 "Selected"): blue-tinted so #f7f7f7 inputs stay visible.
  rowSelected: {
    backgroundColor: `${CB.rowSelected} !important`,
  },
  contextCell: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  // TDC TagLabel column — the pill ellipsizes past this cap.
  tdcCol: {
    minWidth: "120px",
    maxWidth: "180px",
  },
  // Identity column: item name + inline action badge, chips underneath
  // (§8). The chips wrap onto separate lines when narrow; the column wraps,
  // others don't.
  firstCol: {
    whiteSpace: "normal",
    wordBreak: "break-word",
    verticalAlign: "top",
    minWidth: "210px",
  },
  // Numeric boxes (§6.2) — the box itself comes from MoneyInput /
  // QuantityInput; these only size it.
  moneyBox: {
    width: "128px",
    minWidth: "112px",
  },
  qtyBox: {
    width: "88px",
    minWidth: "80px",
  },
  qtyCol: {
    textAlign: "right",
    justifyContent: "flex-end",
    minWidth: "96px",
  },
  // Fund Center column — wider than the dropdown so the cell has room.
  fcCol: {
    minWidth: "130px",
  },
  fcDropdown: {
    maxWidth: "150px",
    minWidth: "100px",
    height: "32px",
    backgroundColor: CB.inputFill,
    ":hover": {
      backgroundColor: "#fff",
      border: `2px solid ${CB.inputHover} !important`,
    },
  },
  // minWidth only (not a fixed width) so the closed field can grow to fit
  // longer LIN/Country names instead of clipping them.
  linCountryDropdown: {
    maxWidth: "160px",
    minWidth: "100px",
    height: "32px",
    backgroundColor: CB.inputFill,
    ":hover": {
      backgroundColor: "#fff",
      border: `2px solid ${CB.inputHover} !important`,
    },
    "& input": {
      maxWidth: "120px",
      minWidth: "80px",
    },
  },
  // Caps the visible option list to ~6 rows so long reference lists (LIN,
  // Country) don't blow out the popup.
  dropdownOptionScroll: {
    maxHeight: "200px",
    overflowY: "auto",
  },
  // The closed Combobox field is a native <input> — it can't wrap. Wrapping
  // is only possible in the open option list.
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
  // Totals (§7): 52px, sticky to the bottom, all-record totals.
  totalsRow: {
    fontWeight: 600,
    fontSize: "11px",
    textTransform: "capitalize",
    "& td": {
      fontWeight: 600,
      fontSize: "11px",
      textTransform: "capitalize",
      height: "52px",
      position: "sticky",
      bottom: "-1px", // -1px so the row's bottom border sits flush with the table's bottom
      zIndex: 2,
      backgroundColor: tokens.colorNeutralBackground2,
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
      verticalAlign: "middle", // beats firstCol's top alignment for the "Totals" label
    },
  },
  // Sits directly above the sticky totalsRow — its bottom offset must equal
  // that row's td height (52px) so the two stack flush with no gap/overlap.
  loadMoreRow: {
    "& td": {
      position: "sticky",
      bottom: "52px",
      zIndex: 2,
      height: "auto",
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  // Fills the row's full clickable area — the td itself gets padding:0 via
  // inline style in the JSX (a plain className can't reliably win against
  // scrollContainer's own "& td" padding rule at equal specificity).
  loadMoreButton: {
    width: "100%",
    minHeight: "40px",
    justifyContent: "center",
    textAlign: "center",
    fontWeight: 600,
    fontSize: "15px",
    padding: 0,
    margin: 0,
    borderRadius: 0,
    color: CB.link,
    backgroundImage:
      "linear-gradient(to bottom, transparent, rgba(255, 255, 255, 0.7))",
    ":hover": {
      color: CB.linkHover,
      backgroundImage:
        "linear-gradient(to bottom, transparent, rgba(255, 255, 255, 1))",
    },
  },
  // Numeric column sizing. Right-aligned body and header (headerJustifyEnd).
  amount: {
    textAlign: "right",
    justifyContent: "flex-end",
    fontVariantNumeric: "tabular-nums",
    minWidth: "120px",
  },
  amountBodyRight: {
    textAlign: "right",
    justifyContent: "flex-end",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  // TableHeaderCell's text sits in an inner flex "button" slot, so alignment
  // goes on that slot via the `button` prop, not on the <th>.
  headerJustifyEnd: {
    justifyContent: "end",
  },
  empty: {
    ...shorthands.padding("16px"),
    color: tokens.colorNeutralForeground3,
  },
  toolbarButtons: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
  },
  // Action buttons (§5): subtle, borderless, icon + 14px label. Disabled =
  // desaturated, never recolored — filter also greys the SVG's own fill.
  toolbarButtonText: {
    fontSize: "14px",
    color: tokens.colorNeutralForeground1,
    ...shorthands.padding("10px", "14px"),
    ":disabled": {
      opacity: 0.7,
      filter: "saturate(0)",
      cursor: "not-allowed",
    },
  },
  dialogSearch: {
    width: "100%",
    marginBottom: "8px",
  },
  addListScroll: {
    maxHeight: "360px",
    overflowY: "auto",
  },
  // Compact table (§7): dialogs and pick-lists only. Same header style as
  // the main grid, tighter rows.
  compactTable: {
    "& th": {
      height: "34px",
      ...shorthands.padding("0", "12px"),
      backgroundColor: CB.tableHead,
      color: tokens.colorNeutralForeground2,
      fontSize: "11px",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
    },
    "& td": {
      height: "44px",
      ...shorthands.padding("8px", "12px"),
    },
    "& tbody tr": { borderBottomColor: CB.rowLine },
  },
  candidateMeta: {
    display: "block",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
  dialogError: {
    color: tokens.colorPaletteRedForeground1,
  },
  // Its own block row between DialogContent and DialogActions, so the
  // count has room next to 2–3 footer buttons.
  addingCountLabel: {
    display: "block",
    color: "#333",
    fontWeight: 600,
    marginTop: "8px",
  },
  addingCountNumber: {
    color: tokens.colorPaletteGreenForeground1,
  },
  addDialogSurface: {
    maxWidth: "640px",
  },
  candidateItemLabel: {
    fontWeight: tokens.fontWeightSemibold,
  },
  candidateTdcCell: {
    width: "56px",
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  // Actions column (§7): last, right-aligned, labelled "Actions".
  actionCol: {
    width: "1%",
    whiteSpace: "nowrap",
    textAlign: "right",
    paddingRight: "12px",
  },
  actionButton: {
    minWidth: "30px",
    height: "30px",
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    columnGap: "10px",
  },
  // "● Selected (N)" — ties visually to Delete Selected, which it feeds.
  selectedIndicator: {
    display: "flex",
    alignItems: "center",
    columnGap: "6px",
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
  },
  selectedDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "black",
  },
  rowSearchInput: {
    minWidth: "180px",
    width: "400px",
    maxWidth: "100%",
    height: "35px",
    minHeight: "35px",
    backgroundColor: CB.inputFill,
    border: "2px solid transparent",
    ":hover": {
      backgroundColor: "#fff",
      border: `2px solid ${CB.inputHover} !important`,
    },
  },
  // Stays red at all times — disabled is conveyed with opacity + saturate(0)
  // instead of swapping the text color, which also desaturates DeleteIcon.
  deleteSelectedButtonText: {
    fontSize: "14px",
    ...shorthands.padding("10px", "14px"),
    color: CB.danger,
    ":disabled": {
      opacity: 0.7,
      filter: "saturate(0)",
      cursor: "not-allowed",
    },
  },
  selectCol: {
    width: "44px",
    minWidth: "44px",
    paddingLeft: "12px !important",
    paddingRight: "4px !important",
    textAlign: "center",
  },
  // Applied via TableHeaderCell's `button` slot — that's the element that
  // receives the click. The double chevron (SortIcon) is always visible.
  sortableHeaderButton: {
    cursor: "pointer",
    userSelect: "none",
    textTransform: "uppercase",
    ":hover": { color: tokens.colorNeutralForeground1 },
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

/** "$1,250.50" — read-only amounts and totals (Design Documentation.md §6.2). */
function formatCurrency(value: number): string {
  return formatMoney(value);
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
  const choice = useChoiceStyles();
  // Where NoteCell modals mount: inside the FluentProvider, so they inherit its theme.
  const [portalRoot, setPortalRoot] = React.useState<HTMLElement | null>(null);
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

  // ----- Effective display names — shared by the cell renderers below and
  // by search/sort, so what you search/sort on always matches what's shown. -----

  /** Item name shown in the first column. */
  const itemDisplayName = (row: GridRow): string => {
    const ctx = row.requirementItemId ? contexts[row.requirementItemId] : undefined;
    return ctx?.item?.trim() ? ctx.item : row.requirementItemName;
  };

  /** Effective Fund Center name, mirroring fundCenterCell's own resolution. */
  const fundCenterDisplayName = (row: GridRow): string => {
    const selectedId = fcEdits[row.recordId] ?? row.fundCenterId ?? "";
    const listedName = fundCenters?.find((fc) => fc.id === selectedId)?.name;
    return selectedId === ""
      ? STATE_LEVEL_LABEL
      : listedName ?? (row.fundCenterName !== "" ? row.fundCenterName : "(unknown)");
  };

  /** Effective LIN name, mirroring linCell's own resolution. */
  const linDisplayName = (row: GridRow): string => {
    const rowCtx = itemLinCountry[row.recordId];
    const selectedId = linEdits[row.recordId] ?? rowCtx?.linId ?? "";
    const listedName = linOptions?.find((l) => l.id === selectedId)?.name;
    return listedName ?? rowCtx?.linName ?? "";
  };

  /** Effective Country name, mirroring countryCell's own resolution. */
  const countryDisplayName = (row: GridRow): string => {
    const rowCtx = itemLinCountry[row.recordId];
    const selectedId = countryEdits[row.recordId] ?? rowCtx?.countryId ?? "";
    const listedName = countryOptions?.find((c) => c.id === selectedId)?.name;
    return listedName ?? rowCtx?.countryName ?? "";
  };

  // ----- Search (Item / Fund Center / Country / LIN) -----
  const [rowSearch, setRowSearch] = React.useState("");

  const searchedRows = React.useMemo(() => {
    const q = rowSearch.trim().toLowerCase();
    if (!q) return datasetRows;
    return datasetRows.filter((row) =>
      [
        itemDisplayName(row),
        fundCenterDisplayName(row),
        countryDisplayName(row),
        linDisplayName(row),
      ].some((v) => v.toLowerCase().includes(q))
    );
  }, [
    datasetRows,
    rowSearch,
    contexts,
    fcEdits,
    fundCenters,
    itemLinCountry,
    linEdits,
    linOptions,
    countryEdits,
    countryOptions,
  ]);

  // ----- Sort (Item / TDC / Fund Center / Country) -----
  type SortField = "item" | "tdc" | "fundCenter" | "country";
  const [sortField, setSortField] = React.useState<SortField | null>("item");
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("asc");

  const toggleSort = (field: SortField): void => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortedRows = React.useMemo(() => {
    if (!sortField) return searchedRows;
    const field = sortField;
    const dir = sortDirection === "asc" ? 1 : -1;
    const keyFor = (row: GridRow): string => {
      switch (field) {
        case "item":
          return itemDisplayName(row).toLowerCase();
        case "tdc":
          return (
            (row.requirementItemId ? contexts[row.requirementItemId]?.tdc : undefined) ?? ""
          ).toLowerCase();
        case "fundCenter":
          return fundCenterDisplayName(row).toLowerCase();
        case "country":
          return countryDisplayName(row).toLowerCase();
      }
    };
    return [...searchedRows].sort((a, b) => keyFor(a).localeCompare(keyFor(b)) * dir);
  }, [
    searchedRows,
    sortField,
    sortDirection,
    contexts,
    fcEdits,
    fundCenters,
    countryEdits,
    countryOptions,
    itemLinCountry,
  ]);

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

  /** Writes an update payload for one record, driving its save indicator. */
  const persist = (recordId: string, payload: Record<string, unknown>): void => {
    setSaveState((prev) => ({ ...prev, [recordId]: "saving" }));
    const touchesAmount = aliasToLogical[ALIAS.requestedAmount] in payload;
    webAPI
      .updateRecord(ITEMIZED_DETAILS_ENTITY, recordId, payload)
      .then(() => {
        // "Saved" badge clears itself after 3s (§8); "Error" stays until the
        // row's next save succeeds (this same branch replaces it).
        setSaveState((prev) => ({ ...prev, [recordId]: "saved" }));
        window.setTimeout(() => {
          setSaveState((prev) => {
            const next = { ...prev };
            if (next[recordId] === "saved") delete next[recordId];
            return next;
          });
        }, 3000);
        if (touchesAmount) fetchAllTotals();
        return;
      })
      .catch(() => {
        setSaveState((prev) => ({ ...prev, [recordId]: "error" }));
      });
  };

  /** Saves a comment from its modal ("" clears it) — only if it differs from what's shown. */
  const saveComment = (row: GridRow, field: TextField, text: string): void => {
    if (text === displayValue(row, field)) return; // no real change
    const logicalName = aliasToLogical[field];
    if (!logicalName) return;
    // Keeps the cell showing the new text while the save runs / until the grid refreshes.
    setEdits((prev) => ({
      ...prev,
      [row.recordId]: { ...prev[row.recordId], [field]: text },
    }));
    persist(row.recordId, { [logicalName]: text.trim() === "" ? null : text });
  };

  /** Effective number for a Money/Quantity box (pending edit wins), or null when empty. */
  const numericValue = (row: GridRow, field: NumericField): number | null => {
    const pending = edits[row.recordId]?.[field];
    return pending !== undefined ? toNumber(pending) : row[field];
  };

  /**
   * Commits a Money/Quantity box (§6.2). The box has already parsed and
   * validated the text and only calls this when the number changed; the
   * pending edit keeps totals and the display in step while the save runs.
   */
  const commitNumber = (row: GridRow, field: NumericField, value: number | null): void => {
    setEdits((prev) => ({
      ...prev,
      [row.recordId]: { ...prev[row.recordId], [field]: value === null ? "" : String(value) },
    }));
    const original = row[field] ?? null;
    if (value === original) return; // back to the stored value: nothing to save
    const logicalName = aliasToLogical[field];
    if (!logicalName) return;
    persist(row.recordId, { [logicalName]: value });
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
   * LIN/Country) pair. Duplicate combinations (same RD + LIN, or same RD +
   * Country, already itemized on this Prioritization) are not pre-filtered
   * client-side — the PrioritizationxRequirementxLIN/Country alternate key
   * rejects them server-side instead, and the rejected count is what drives
   * the "could not be added" message below. This avoids depending on
   * itemLinCountry (which loads one webAPI call per existing row) just to
   * predict what the server will do anyway. */
  const addPairs = (): void => {
    if (!prioritizationId || selected.size === 0 || selectedSecondary.size === 0) {
      return;
    }
    const isLin = addStep === "select-lin";
    const pairs: { rdId: string; secId: string }[] = [];
    selected.forEach((rdId) => {
      selectedSecondary.forEach((secId) => {
        pairs.push({ rdId, secId });
      });
    });
    setAddBusy(true);
    Promise.allSettled(
      pairs.map(({ rdId, secId }) =>
        webAPI.createRecord(ITEMIZED_DETAILS_ENTITY, {
          "book_Prioritization@odata.bind": `/book_prioritizations(${prioritizationId})`,
          "book_RequirementItem@odata.bind": `/book_requirementdetailses(${rdId})`,
          ...(isLin
            ? { "book_LIN@odata.bind": `/book_lins(${secId})` }
            : { "book_Country@odata.bind": `/book_countries(${secId})` }),
        })
      )
    ).then((results) => {
      setAddBusy(false);
      const skipped = results.filter((r) => r.status === "rejected").length;
      const created = results.length - skipped;
      if (created > 0) {
        dataset.refresh();
        fetchAllTotals();
      }
      if (skipped === 0) {
        setAddOpen(false);
        return;
      }
      setCandidateError(
        `${skipped} Detail${skipped === 1 ? "" : "s"} could not be added ` +
          `because ${skipped === 1 ? "its" : "their"} ${isLin ? "LIN" : "Country"} already existed.`
      );
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

  // ----- Bulk selection / bulk delete -----
  const [selectedRows, setSelectedRows] = React.useState<Set<string>>(
    new Set()
  );

  // Selection is scoped to what's currently visible under the search filter
  // — clear it whenever that filter changes rather than let it silently
  // keep hold of rows the user can no longer see.
  React.useEffect(() => {
    setSelectedRows(new Set());
  }, [rowSearch]);

  const toggleRowSelected = (recordId: string, checked: boolean): void => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (checked) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };

  const visibleRowIds = React.useMemo(
    () => sortedRows.map((r) => r.recordId),
    [sortedRows]
  );
  const allVisibleSelected =
    visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedRows.has(id));
  const someVisibleSelected = visibleRowIds.some((id) => selectedRows.has(id));

  const toggleSelectAllVisible = (checked: boolean): void => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      visibleRowIds.forEach((id) => (checked ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const [bulkRemoveOpen, setBulkRemoveOpen] = React.useState(false);
  const [bulkRemoveBusy, setBulkRemoveBusy] = React.useState(false);

  const confirmBulkRemove = (): void => {
    if (selectedRows.size === 0) return;
    const recordIds = Array.from(selectedRows);
    setBulkRemoveBusy(true);
    Promise.allSettled(
      recordIds.map((recordId) => webAPI.deleteRecord(ITEMIZED_DETAILS_ENTITY, recordId))
    )
      .then((results) => {
        setBulkRemoveBusy(false);
        setBulkRemoveOpen(false);
        setSelectedRows(new Set());
        // Rows that failed to delete stay in the grid after refresh — flag
        // them the same way a failed cell save is flagged, via saveState,
        // reusing the same floating status badge rather than a new one.
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            setSaveState((prev) => ({ ...prev, [recordIds[i]]: "error" }));
          }
        });
        dataset.refresh();
        fetchAllTotals();
        return;
      })
      .catch(() => {
        setBulkRemoveBusy(false);
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

  // The straight RD x LIN/Country product — not reduced by what's already
  // itemized. Computing that would mean waiting on itemLinCountry (loads one
  // webAPI call per existing row) before showing a number at all. Instead
  // addPairs below sends every combination and lets the
  // PrioritizationxRequirementxLIN/Country alternate key reject duplicates
  // server-side, then reports how many were skipped after the fact.
  const pendingPairCount = selected.size * selectedSecondary.size;

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

  /** Row action result for the inline badge after the item name (§8). */
  const actionResult = (recordId: string) => saveState[recordId];

  /**
   * Quantity (#) / Money ($) box (§6.2). When the control is locked the value
   * renders as plain text instead of a disabled box (§6 "Form locked").
   */
  const numericCell = (row: GridRow, field: NumericField): React.ReactNode => {
    const value = numericValue(row, field);
    const isQty = field === "quantity";
    if (isDisabled) {
      return (
        <span className={styles.amountBodyRight}>
          {value === null ? "" : isQty ? value.toLocaleString("en-US") : formatCurrency(value)}
        </span>
      );
    }
    const common = {
      value,
      onCommit: (v: number | null) => commitNumber(row, field, v),
      onInvalid: () => setSaveState((prev) => ({ ...prev, [row.recordId]: "error" })),
    };
    return isQty ? (
      <QuantityInput {...common} className={styles.qtyBox} aria-label="Quantity" />
    ) : (
      <MoneyInput {...common} className={styles.moneyBox} aria-label="Requested amount" />
    );
  };

  // Comments can run to a paragraph: a capped read-only preview that opens a
  // modal (NoteCell). State Comment is editable there unless the form is locked.
  /** Modal title: "State Comment for State Vehicles (TDC: 101)". */
  const noteTitle = (label: string, row: GridRow): string => {
    const tdc = row.requirementItemId ? contexts[row.requirementItemId]?.tdc : "";
    return `${label} for ${itemDisplayName(row)}${tdc ? ` (${tdc})` : ""}`;
  };

  const commentCell = (row: GridRow, field: TextField): React.ReactNode => (
    <NoteCell
      title={noteTitle("State Comment", row)}
      editable={!isDisabled}
      value={displayValue(row, field)}
      onSave={(text) => saveComment(row, field, text)}
    />
  );

  // NPM Comment is owned by the NPM on the Requirement Funding side — always read-only here.
  const npmCommentCell = (row: GridRow): React.ReactNode => (
    <NoteCell title={noteTitle("NPM Comment", row)} editable={false} value={row.npmComment} />
  );

  const fundCenterCell = (row: GridRow): React.ReactNode => {
    const selectedId = fcEdits[row.recordId] ?? row.fundCenterId ?? "";
    const selectedName = fundCenterDisplayName(row);
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
    const selectedName = linDisplayName(row);
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
    const selectedName = countryDisplayName(row);
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

  /** Clickable header cell for one of the sortable columns (Item, TDC, Fund
   * Center, Country). The double chevron is always visible; the active
   * direction darkens and aria-sort tells assistive tech (§7). */
  const renderSortableHeader = (
    label: string,
    field: SortField,
    cellClassName?: string
  ): React.ReactNode => {
    const active = sortField === field;
    return (
      <TableHeaderCell
        className={cellClassName}
        aria-sort={active ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
        button={{
          className: styles.sortableHeaderButton,
          onClick: () => toggleSort(field),
        }}
      >
        {label}
        <SortIcon direction={active ? sortDirection : null} />
      </TableHeaderCell>
    );
  };

  /** "101 — CONUS": TDC code plus its long name once that has loaded. */
  const tdcText = (ctx: RequirementItemContext): string =>
    ctx.tdcLongName ? `${ctx.tdc} — ${ctx.tdcLongName}` : ctx.tdc;

  /** Attribute chips under the item name (§8): "Label: Value", empty values skipped. */
  const rowChips = (ctx: RequirementItemContext | undefined): ChipData[] =>
    [
      { type: "category", label: "Category", value: ctx?.category ?? "" },
      { type: "qtyType", label: "Qty Type", value: ctx?.quantityType ?? "" },
    ].filter((c) => c.value);

  const hasNextPage = !!dataset.paging && dataset.paging.hasNextPage;

  // Item, TDC, Fund Center, Quantity, Requested, Validated, Funded, NPM
  // Comment, State Comment — plus whichever of LIN/Country/Select/Action are
  // showing. Used to span the sticky Load More row across every column.
  const columnCount =
    9 +
    (prioFlags?.linRequired ? 1 : 0) +
    (prioFlags?.countryRequired ? 1 : 0) +
    (!isDisabled ? 2 : 0); // select col + action col

  return (
    // The form's PCF container is a flexbox, so this provider is a flex item
    // whose default min-width:auto lets it grow to the table's full width —
    // the scroll container below then never overflows. minWidth: 0 lets it
    // shrink to the container, so the table scrolls inside scrollContainer.
    <FluentProvider
      theme={checkbookTheme}
      style={{ minWidth: 0, width: "100%", maxWidth: "100%" }}
    >
      <PortalRootContext.Provider value={portalRoot}>
      <div className={styles.root}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <Text weight="semibold">
              Itemized Details ({datasetRows.length})
            </Text>
            {selectedRows.size > 0 && (
              <span className={styles.selectedIndicator}>
                <span className={styles.selectedDot} />
                Selected ({selectedRows.size})
              </span>
            )}
          </div>
          <div className={styles.toolbarButtons}>
            <Input
              size="small"
              appearance="outline"
              className={styles.rowSearchInput}
              placeholder="Search Item, Fund Center, Country, LIN"
              contentBefore={<SearchIcon />}
              value={rowSearch}
              onChange={(_e, data) => setRowSearch(data.value)}
            />
            {!isDisabled && (
              <Button
                size="small"
                appearance="subtle"
                className={styles.deleteSelectedButtonText}
                icon={<DeleteIcon />}
                disabled={dataset.loading || selectedRows.size === 0}
                onClick={() => setBulkRemoveOpen(true)}
              >
                Delete Selected
              </Button>
            )}
            {!isDisabled && (
              <Button
                size="small"
                appearance="subtle"
                className={styles.toolbarButtonText}
                icon={<AddIcon />}
                disabled={dataset.loading}
                onClick={openAddDialog}
              >
                Add Items
              </Button>
            )}
            <Button
              size="small"
              appearance="subtle"
              className={styles.toolbarButtonText}
              icon={<RefreshIcon />}
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
        ) : sortedRows.length === 0 ? (
          <div className={styles.empty}>
            No Itemized Details match your search.
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
                  {!isDisabled && (
                    <TableHeaderCell className={styles.selectCol}>
                      <Checkbox
                        className={choice.checkboxBare}
                        indicator={{ className: choice.checkboxBox }}
                        checked={
                          allVisibleSelected ? true : someVisibleSelected ? "mixed" : false
                        }
                        onChange={(_e, data) =>
                          toggleSelectAllVisible(data.checked === true)
                        }
                        aria-label="Select all visible rows"
                      />
                    </TableHeaderCell>
                  )}
                  {renderSortableHeader("Item", "item", styles.firstCol)}
                  {renderSortableHeader("TDC", "tdc")}
                  {renderSortableHeader("Fund Center", "fundCenter", styles.fcCol)}
                  {prioFlags?.linRequired && <TableHeaderCell>LIN</TableHeaderCell>}
                  {prioFlags?.countryRequired &&
                    renderSortableHeader("Country", "country")}
                  <TableHeaderCell
                    className={styles.qtyCol}
                    button={{ className: styles.headerJustifyEnd }}
                  >
                    Quantity
                  </TableHeaderCell>
                  <TableHeaderCell
                    className={styles.amount}
                    button={{ className: styles.headerJustifyEnd }}
                  >
                    Requested
                  </TableHeaderCell>
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
                    <TableHeaderCell
                      className={styles.actionCol}
                      button={{ className: styles.headerJustifyEnd }}
                    >
                      Actions
                    </TableHeaderCell>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((row) => {
                  const ctx = row.requirementItemId
                    ? contexts[row.requirementItemId]
                    : undefined;
                  const isSelected = selectedRows.has(row.recordId);
                  return (
                    <TableRow
                      key={row.recordId}
                      aria-selected={isDisabled ? undefined : isSelected}
                      className={isSelected ? styles.rowSelected : undefined}
                    >
                      {!isDisabled && (
                        <TableCell className={styles.selectCol}>
                          <Checkbox
                            className={choice.checkboxBare}
                            indicator={{ className: choice.checkboxBox }}
                            checked={isSelected}
                            onChange={(_e, data) =>
                              toggleRowSelected(row.recordId, data.checked === true)
                            }
                            aria-label="Select row"
                          />
                        </TableCell>
                      )}
                      <TableCell className={styles.firstCol}>
                        <ItemName name={itemDisplayName(row)} result={actionResult(row.recordId)} />
                        <ChipList chips={rowChips(ctx)} />
                      </TableCell>
                      <TableCell className={styles.tdcCol}>
                        {ctx?.tdc ? (
                          ctx.tdcId ? (
                            <HyperlinkLabel
                              title={tdcText(ctx)}
                              onClick={() => {
                                // Always a new tab, so the user keeps their place in this grid.
                                void navigation.openForm({
                                  entityName: TDC_ENTITY,
                                  entityId: ctx.tdcId!,
                                  openInNewWindow: true,
                                });
                              }}
                            >
                              {tdcText(ctx)}
                            </HyperlinkLabel>
                          ) : (
                            <TagLabel title={tdcText(ctx)}>{tdcText(ctx)}</TagLabel>
                          )
                        ) : null}
                      </TableCell>
                      <TableCell className={styles.fcCol}>{fundCenterCell(row)}</TableCell>
                      {prioFlags?.linRequired && (
                        <TableCell>{linCell(row)}</TableCell>
                      )}
                      {prioFlags?.countryRequired && (
                        <TableCell>{countryCell(row)}</TableCell>
                      )}
                      <TableCell className={styles.qtyCol}>
                        {numericCell(row, "quantity")}
                      </TableCell>
                      <TableCell className={styles.amount}>
                        {numericCell(row, "requestedAmount")}
                      </TableCell>
                      <TableCell className={styles.amountBodyRight}>
                        {readOnlyAmount(row, "validatedAmount")}
                      </TableCell>
                      <TableCell className={styles.amountBodyRight}>
                        {readOnlyAmount(row, "fundedAmount")}
                      </TableCell>
                      <TableCell>{npmCommentCell(row)}</TableCell>
                      <TableCell>{commentCell(row, "stateComment")}</TableCell>
                      {!isDisabled && (
                        <TableCell className={styles.actionCol}>
                          <Tooltip
                            content="Delete Itemized Detail"
                            relationship="label"
                          >
                            <Button
                              size="small"
                              appearance="subtle"
                              className={styles.actionButton}
                              icon={<DeleteIcon size={16} />}
                              aria-label="Delete Itemized Detail"
                              onClick={() => setPendingRemove(row)}
                            />
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {hasNextPage && (
                  <TableRow className={styles.loadMoreRow}>
                    <TableCell colSpan={columnCount} style={{ padding: 0 }}>
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
                  {!isDisabled && <TableCell />}
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
                            <Table size="small" aria-label="Requirement Details" className={styles.compactTable}>
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
                                        className={choice.checkbox}
                                        indicator={{ className: choice.checkboxBox }}
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
                  {!prioFlags?.linRequired &&
                    !prioFlags?.countryRequired &&
                    selected.size > 0 && (
                      <span className={styles.addingCountLabel}>
                        Adding:{" "}
                        <span className={styles.addingCountNumber}>
                          {selected.size}
                        </span>{" "}
                        Items
                      </span>
                    )}
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
                        : "Add Selected"}
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
                              <Table size="small" aria-label="LIN" className={styles.compactTable}>
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
                                          className={choice.checkbox}
                                          indicator={{ className: choice.checkboxBox }}
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
                            <Table size="small" aria-label="Country" className={styles.compactTable}>
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
                                        className={choice.checkbox}
                                        indicator={{ className: choice.checkboxBox }}
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
                  {pendingPairCount > 0 && (
                    <span className={styles.addingCountLabel}>
                      Adding:{" "}
                      <span className={styles.addingCountNumber}>
                        {pendingPairCount}
                      </span>{" "}
                      Items
                    </span>
                  )}
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
                      {addBusy ? "Adding…" : "Add Items"}
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

        <Dialog
          open={bulkRemoveOpen}
          onOpenChange={(_e, data) => {
            if (!bulkRemoveBusy && !data.open) setBulkRemoveOpen(false);
          }}
        >
          <DialogSurface>
            <DialogBody>
              <DialogTitle>
                Remove {selectedRows.size} Itemized Detail
                {selectedRows.size === 1 ? "" : "s"}
              </DialogTitle>
              <DialogContent>
                <Text>
                  Remove {selectedRows.size} selected Itemized Detail
                  {selectedRows.size === 1 ? "" : "s"} from this
                  Prioritization? Their Requested amounts will no longer
                  count toward the total.
                </Text>
              </DialogContent>
              <DialogActions>
                <Button
                  appearance="secondary"
                  disabled={bulkRemoveBusy}
                  onClick={() => setBulkRemoveOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  appearance="primary"
                  disabled={bulkRemoveBusy}
                  onClick={confirmBulkRemove}
                >
                  {bulkRemoveBusy ? "Removing…" : "Remove"}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
        <div ref={setPortalRoot} />
      </div>
      </PortalRootContext.Provider>
    </FluentProvider>
  );
};
