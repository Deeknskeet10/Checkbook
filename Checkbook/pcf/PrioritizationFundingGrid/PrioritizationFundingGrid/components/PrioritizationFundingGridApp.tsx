import * as React from "react";
import {
  FluentProvider,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  Button,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  Tooltip,
  Link,
} from "@fluentui/react-components";
import {
  CB,
  STATUS,
  checkbookTheme,
  useButtonStyles,
  AddIcon,
  AllocateIcon,
  ChevronIcon,
  CloseIcon,
  DeleteIcon,
  EditIcon,
  RefreshIcon,
  SaveIcon,
  UndoIcon,
  MoneyInput,
  ChipList,
  ChipData,
  ItemName,
  ActionResult,
  StatusLabel,
  StatusKind,
  TagLabel,
  NoteCell,
  PortalRootContext,
} from "./designSystem";
type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;
type Navigation = ComponentFramework.Navigation;
type UserSettings = ComponentFramework.UserSettings;

export interface PrioRow {
  id: string;
  name: string;
  statePriority: number | null;
  approvalStatus: string | null;
  fiscalYear: number | null;
  fiscalYearLabel: string | null;
  stateName: string | null;
  fundingMode: number | null;
  fundingModeLabel: string | null;
  requestedAmount: number;
  fundedAmount: number;
  validatedAmount: number;
  requirementId: string | null;
  requirementName: string | null;
}

export interface PrioritizationFundingGridProps {
  dataset?: DataSet;
  webAPI: WebApi;
  navigation: Navigation;
  userSettings: UserSettings;
  isDisabled: boolean;
  width: number;
  /** Container override: pass pre-fetched Prio rows instead of relying on the dataset binding. */
  prioRowsOverride?: PrioRow[];
  /** Container override: lock the FY filter to this value (and hide the internal picker). */
  fyFilterOverride?: number | "all";
  /** Container override: hide the toolbar's FY picker without locking the value. */
  hideFyPicker?: boolean;
  /** Container override: hide the section title in the toolbar. */
  hideTitle?: boolean;
  /** Called after a successful save or refresh, in addition to dataset.refresh(). */
  onAfterSave?: () => void;
}

/** Property-set aliases declared in ControlManifest.Input.xml. */
const ALIAS = {
  name: "name",
  statePriority: "statePriority",
  approvalStatus: "approvalStatus",
  fiscalYear: "fiscalYear",
  fundingMode: "fundingMode",
  requestedAmount: "requestedAmount",
  fundedAmount: "fundedAmount",
  validatedAmount: "validatedAmount",
  requirement: "requirement",
  state: "state",
} as const;

const PRIORITIZATION_ENTITY = "book_prioritization";
const PRIORITIZATION_FUNDING_ENTITY = "book_prioritizationfunding";
const REQUIREMENT_FUNDING_ENTITY = "book_requirementfunding";
const ITEMIZED_DETAILS_ENTITY = "book_itemizeddetails";

/** Prioritization decimal fields. */
const PRIO_VALIDATED = "book_validatedamount";
// V&F historically wrote PRIO_FUNDED as book_newfundedamounttdp; FY27 plugin
// rollup writes both. Keep the V&F field for compatibility with mid-cycle Reqs.
const PRIO_FUNDED = "book_newfundedamounttdp";
/** Itemized Details decimal fields. */
const ITEM_VALIDATED = "book_validatedamount";
const ITEM_FUNDED = "book_fundedamount";
const ITEM_NPM_COMMENT = "book_npmcomment";

const FV = "@OData.Community.Display.V1.FormattedValue";

// book_fundingmode option values
const FUNDING_MODE_DIRECT = 0;
const FUNDING_MODE_ITEMIZED = 1;

const FY_FILTER_ALL = "all" as const;
type FYFilter = number | typeof FY_FILTER_ALL;

/**
 * Fiscal Year per the federal calendar: Oct–Sept, named for the ending year.
 * Oct 2025 → "FY 2026", Sep 2026 → "FY 2026", Oct 2026 → "FY 2027".
 */
function currentFiscalYear(now: Date = new Date()): number {
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

interface ItemRow {
  id: string;
  prioritizationId: string;
  label: string;
  /** TDC name of the linked Requirement Detail; empty when not set. */
  tdc: string;
  /** LIN code on this Itemized Detail; empty when not set. */
  lin: string;
  /** Country on this Itemized Detail; empty when not set. */
  country: string;
  /** Fund Center name of the Itemized Detail; empty = state level. */
  fundCenter: string;
  requested: number;
  validated: number;
  funded: number;
  npmComment: string;
}

interface JunctionRow {
  id: string;
  name: string;
  prioritizationId: string;
  rfId: string;
  rfName: string;
  rfFiscalYear: number | null;
  fundedAmount: number;
  validatedAmount: number;
}

interface RFOption {
  id: string;
  name: string;
  tdp: number | null;
  fiscalYear: number | null;
  fiscalYearLabel: string | null;
}

type JunctionField = "fundedAmount" | "validatedAmount";

// Dataverse subgrids default to ~4–25 rows per page. Bump so the NPM doesn't
// see a tiny default page before scrolling — users can still click Load more.
const PAGE_SIZE = 100;

// Design Documentation.md §5 (buttons), §7 (spacious grid / compact variant),
// §8 (tags), §9 (toolbar & dialogs). Header/cell rules use explicit classes
// (not "& th") so the nested Itemized Details table keeps its compact spec.
const headBand = {
  backgroundColor: CB.tableHead,
  color: tokens.colorNeutralForeground2,
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
  textAlign: "left",
  borderBottomStyle: "none",
} as const;

const fillInput = {
  backgroundColor: CB.inputFill,
  border: "1px solid transparent",
  ":hover": {
    backgroundColor: "#fff",
    ...shorthands.borderColor(`${CB.inputHover} !important`),
  },
} as const;

const useStyles = makeStyles({
  root: {
    ...shorthands.padding("8px"),
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
  },

  // ── Toolbar (§9): Title (count) · FY ‖ Edit / Cancel · Save · Refresh ──
  toolbar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: "12px",
    rowGap: "8px",
    ...shorthands.padding("4px", "2px", "8px", "2px"),
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    columnGap: "16px",
    rowGap: "8px",
    flexWrap: "wrap",
    flexGrow: 1,
  },
  title: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
  },
  count: {
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    marginLeft: "6px",
  },
  toolbarButtons: {
    display: "flex",
    alignItems: "center",
    columnGap: "4px",
  },
  fyFilter: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
    color: tokens.colorNeutralForeground3,
  },
  combo: {
    ...fillInput,
    minWidth: "140px",
    "::after": { display: "none" },
  },

  // ── TDP guardrail cards ──
  statStrip: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: "12px",
    rowGap: "12px",
    marginBottom: "12px",
  },
  stat: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: "160px",
    boxSizing: "border-box",
    ...shorthands.padding("12px", "16px"),
    borderRadius: "8px",
    backgroundColor: CB.tableHead,
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    marginBottom: "4px",
  },
  statValue: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: "20px",
    lineHeight: "28px",
    fontVariantNumeric: "tabular-nums",
  },
  // Tinted like the success / danger status labels (§8).
  statGood: {
    backgroundColor: STATUS.success.bg,
    "& > div": { color: STATUS.success.fg },
  },
  statBad: {
    backgroundColor: STATUS.danger.bg,
    "& > div": { color: STATUS.danger.fg },
  },
  banner: {
    marginBottom: "12px",
  },

  // ── Main grid (§7). Cell side padding is 8px, rows size to content (20px
  // minimum) — the same compact spec as the Itemized Details grid. ──
  scrollContainer: {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    maxHeight: "560px",
    overflowX: "auto",
    overflowY: "auto",
  },
  table: {
    width: "100%",
    minWidth: "980px",
    borderCollapse: "separate",
    borderSpacing: 0,
  },
  th: {
    ...headBand,
    height: "40px",
    ...shorthands.padding("0", "8px"),
    position: "sticky",
    top: 0,
    zIndex: 2,
    // Plain header text has none of the inset the body's pills / buttons /
    // expander bring, so it read as flush. First column lines up with the
    // Prioritization name (8px cell + 30px expander slot + 6px gap); last
    // lines up with the Allocate button's text (8px cell + 10px button padding).
    ":first-child": {
      borderTopLeftRadius: "8px",
      borderBottomLeftRadius: "8px",
      paddingLeft: "44px",
    },
    ":last-child": {
      borderTopRightRadius: "8px",
      borderBottomRightRadius: "8px",
      paddingRight: "18px",
    },
  },
  num: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  row: {
    ":hover": { backgroundColor: CB.rowHover },
  },
  rowOpen: {
    backgroundColor: `${CB.rowSelected} !important`,
  },
  td: {
    // Minimum only — a row grows to its tallest cell (32px inputs, name + chips).
    height: "20px",
    ...shorthands.padding("6px", "8px"),
    verticalAlign: "middle",
    borderBottom: `1px solid ${CB.rowLine}`,
    whiteSpace: "nowrap",
  },
  // Identity column: expander · name + badge, chips underneath (§7/§8).
  firstCol: {
    minWidth: "240px",
    whiteSpace: "normal",
    verticalAlign: "top",
  },
  identity: {
    display: "flex",
    alignItems: "flex-start",
    columnGap: "6px",
  },
  expanderSlot: {
    width: "30px",
    flexShrink: 0,
    marginTop: "-3px",
  },
  prioLink: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    textAlign: "left",
  },
  unfunded: {
    color: tokens.colorPaletteRedForeground1,
  },
  muted: {
    color: tokens.colorNeutralForeground3,
  },
  moneyBox: {
    width: "128px",
    minWidth: "112px",
  },
  actionsCol: {
    width: "1%",
    textAlign: "right",
  },
  // "Allocate": brand-blue text + icon, so the icon's meaning is spelled out.
  // CB.brandHover (#1a74e0, 4.5:1 on white) rather than CB.brand, for AA text.
  // Disabled keeps btn.action's desaturate + opacity.
  allocateBtn: {
    columnGap: "6px",
    minWidth: 0,
    fontSize: "12px",
    fontWeight: 600,
    color: CB.brandHover,
    ...shorthands.padding("4px", "10px"),
    ":hover": { color: CB.brandPressed },
    ":hover:active": { color: CB.brandPressed },
  },

  // Load more (§7): sticky right above the 52px totals row.
  loadMoreRow: {
    "& td": {
      position: "sticky",
      bottom: "52px",
      zIndex: 2,
      ...shorthands.padding("0"),
      backgroundColor: tokens.colorNeutralBackground1,
    },
  },
  // Footer: 52px, 11px / 600 / capitalized — matches the Itemized Details totals.
  totalsRow: {
    "& td": {
      height: "52px",
      ...shorthands.padding("0", "8px"),
      position: "sticky",
      bottom: "-1px",
      zIndex: 2,
      fontWeight: 600,
      fontSize: "11px",
      textTransform: "capitalize",
      verticalAlign: "middle",
      backgroundColor: tokens.colorNeutralBackground2,
      borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
      whiteSpace: "nowrap",
    },
    // Same insets as the header (th:first-child / th:last-child) so "Total"
    // lines up with the names above it and the header above it.
    "& td:first-child": { paddingLeft: "44px" },
    "& td:last-child": { paddingRight: "18px" },
  },

  // ── Itemized Details sub-table (§7 compact variant) ──
  subCell: {
    ...shorthands.padding("4px", "16px", "16px", "52px"),
    backgroundColor: CB.rowSelected,
    borderBottom: `1px solid ${CB.rowLine}`,
  },
  subTable: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: "8px",
  },
  subTh: {
    ...headBand,
    height: "34px",
    ...shorthands.padding("0", "8px"),
    ":first-child": { borderTopLeftRadius: "8px", borderBottomLeftRadius: "8px" },
    ":last-child": { borderTopRightRadius: "8px", borderBottomRightRadius: "8px" },
  },
  subTd: {
    height: "20px",
    ...shorthands.padding("6px", "8px"),
    verticalAlign: "middle",
    borderBottom: `1px solid ${CB.rowLine}`,
    whiteSpace: "nowrap",
  },
  subFirst: {
    minWidth: "200px",
    whiteSpace: "normal",
    fontWeight: tokens.fontWeightSemibold,
  },
  empty: {
    ...shorthands.padding("16px"),
    color: tokens.colorNeutralForeground3,
  },
  footNote: {
    marginTop: "8px",
  },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },

  // ── Allocate-to-RFs dialog (§9) ──
  dialogSurface: {
    maxWidth: "640px",
    width: "95vw",
  },
  intro: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    marginBottom: "12px",
  },
  dialogScroll: {
    maxHeight: "360px",
    overflowY: "auto",
  },
  dialogTh: {
    ...headBand,
    height: "34px",
    ...shorthands.padding("0", "12px"),
    position: "sticky",
    top: 0,
    zIndex: 1,
    ":first-child": { borderTopLeftRadius: "8px", borderBottomLeftRadius: "8px" },
    ":last-child": { borderTopRightRadius: "8px", borderBottomRightRadius: "8px" },
  },
  rfCell: {
    whiteSpace: "normal",
    width: "100%",
  },
  rfFy: {
    display: "block",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  dialogMoneyBox: {
    width: "128px",
    minWidth: "112px",
  },
  addRow: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
    rowGap: "8px",
    marginTop: "8px",
    flexWrap: "wrap",
  },
  dialogNote: {
    marginTop: "12px",
  },
  dialogError: {
    display: "block",
    marginTop: "8px",
    color: tokens.colorPaletteRedForeground1,
  },
  dialogWarn: {
    display: "block",
    marginTop: "8px",
    color: STATUS.warning.fg,
  },
  summaryRow: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: "12px",
    rowGap: "12px",
    marginTop: "16px",
  },
});

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

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Approval status → status-label variant, by meaning (§8). */
function approvalKind(label: string | null): StatusKind {
  const t = (label ?? "").toLowerCase();
  if (t.includes("approved") || t.includes("funded")) return "success";
  if (t.includes("reject") || t.includes("kick") || t.includes("denied")) return "danger";
  if (t.includes("review") || t.includes("submit")) return "info";
  if (t.includes("pending") || t.includes("return")) return "warning";
  return "neutral"; // draft, planning, closed, unknown
}

// A Prioritization is only fundable once it reaches NPM Review; below that the
// funding roll-up (FinalApproved-only) ignores it, so the grid keeps earlier
// stages visible but read-only. Matched on the formatted status label so the
// same check works for both the dataset and container-override data paths.
const NPM_REVIEW_LABEL = "NPM Review";
function isFundable(prio: PrioRow): boolean {
  return (prio.approvalStatus ?? "").trim().toLowerCase() === NPM_REVIEW_LABEL.toLowerCase();
}

export const PrioritizationFundingGridApp: React.FC<PrioritizationFundingGridProps> = (
  props
) => {
  const {
    dataset,
    webAPI,
    navigation,
    userSettings,
    isDisabled,
    prioRowsOverride,
    fyFilterOverride,
    hideFyPicker,
    hideTitle,
    onAfterSave,
  } = props;
  const styles = useStyles();
  const btn = useButtonStyles();
  // Where NoteCell modals mount: inside the FluentProvider, so they inherit its theme.
  const [portalRoot, setPortalRoot] = React.useState<HTMLElement | null>(null);

  // ---- Per-row action result badge (§8): Saved clears after 3s; Error stays
  // until that row's next successful save. Keyed by Prioritization id. ----
  const [rowResult, setRowResult] = React.useState<Record<string, ActionResult>>({});
  const savedTimers = React.useRef<Record<string, number>>({});
  React.useEffect(
    () => () => Object.values(savedTimers.current).forEach((t) => window.clearTimeout(t)),
    []
  );
  const setResults = React.useCallback(
    (ids: Iterable<string>, result: ActionResult | null): void => {
      const list = Array.from(ids);
      if (list.length === 0) return;
      setRowResult((prev) => {
        const next = { ...prev };
        for (const id of list) {
          if (result) next[id] = result;
          else delete next[id];
        }
        return next;
      });
      if (result !== "saved") return;
      for (const id of list) {
        window.clearTimeout(savedTimers.current[id]);
        savedTimers.current[id] = window.setTimeout(() => {
          setRowResult((prev) => {
            if (prev[id] !== "saved") return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }, 3000);
      }
    },
    []
  );

  // ---- Current user's security roles (gates the RF allocation delete button) ----
  const [userRoles, setUserRoles] = React.useState<Set<string>>(new Set());
  const loadRoles = React.useCallback(async () => {
    const userId = (userSettings.userId || "").replace(/[{}]/g, "");
    if (!userId) return;
    try {
      // Mirrors UserRoleHelper: direct assignments (systemuserroles_association)
      // OR team-derived roles (teamroles_association -> teammembership_association).
      const roleFilter =
        `systemuserroles_association/any(o:o/systemuserid eq ${userId})` +
        ` or teamroles_association/any(t:t/teammembership_association/any(m:m/systemuserid eq ${userId}))`;
      const rolesResp = await webAPI.retrieveMultipleRecords(
        "role",
        `?$select=name&$filter=${roleFilter}`
      );
      const names = new Set<string>();
      for (const r of rolesResp.entities) {
        if (r.name) names.add(r.name as string);
      }
      setUserRoles(names);
    } catch {
      setUserRoles(new Set());
    }
  }, [userSettings.userId, webAPI]);
  React.useEffect(() => {
    void loadRoles();
  }, [loadRoles]);
  const canDeleteAllocation = React.useMemo(
    () =>
      userRoles.has("Book - Checkbook Administrator") ||
      userRoles.has("System Administrator"),
    [userRoles]
  );

  // Bump the dataset page size once. Without this Dataverse hands us only the
  // subgrid's default page (often ~4), which surprised users in 0.1.x.
  const pageSizeApplied = React.useRef(false);
  React.useEffect(() => {
    if (pageSizeApplied.current) return;
    if (dataset?.paging && typeof dataset.paging.setPageSize === "function") {
      try {
        dataset.paging.setPageSize(PAGE_SIZE);
        pageSizeApplied.current = true;
      } catch {
        // host may throw if setPageSize is called before the first load
      }
    }
  }, [dataset?.paging]);

  // ---- Materialise the Prios from the dataset (or the container override) ----
  const overrideKey = prioRowsOverride?.map((p) => p.id).join("|") ?? "";
  const refresh = React.useCallback(() => {
    if (dataset) dataset.refresh();
    onAfterSave?.();
  }, [dataset, onAfterSave]);
  const initialPrioRows = React.useMemo<PrioRow[]>(() => {
    if (prioRowsOverride) {
      return [...prioRowsOverride].sort((a, b) => {
        const sa = a.stateName ?? "￿";
        const sb = b.stateName ?? "￿";
        const cmp = sa.localeCompare(sb);
        if (cmp !== 0) return cmp;
        const pa = a.statePriority ?? Number.MAX_SAFE_INTEGER;
        const pb = b.statePriority ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      });
    }
    if (!dataset) return [];
    return dataset.sortedRecordIds
      .map((id) => {
        const r = dataset.records[id];
        const reqLookup = r.getValue(ALIAS.requirement);
        const fundingModeRaw = r.getValue(ALIAS.fundingMode);
        const fiscalYearRaw = r.getValue(ALIAS.fiscalYear);
        return {
          id,
          name: (r.getValue(ALIAS.name) as string | null) ?? "(unnamed)",
          statePriority: (r.getValue(ALIAS.statePriority) as number | null) ?? null,
          approvalStatus: r.getFormattedValue(ALIAS.approvalStatus) ?? null,
          fiscalYear:
            typeof fiscalYearRaw === "object" && fiscalYearRaw !== null
              ? ((fiscalYearRaw as { Value?: number }).Value ?? null)
              : toNumber(fiscalYearRaw),
          fiscalYearLabel: r.getFormattedValue(ALIAS.fiscalYear) ?? null,
          fundingMode:
            typeof fundingModeRaw === "object" && fundingModeRaw !== null
              ? ((fundingModeRaw as { Value?: number }).Value ?? null)
              : toNumber(fundingModeRaw),
          fundingModeLabel: r.getFormattedValue(ALIAS.fundingMode) ?? null,
          requestedAmount: num(r.getValue(ALIAS.requestedAmount)),
          fundedAmount: num(r.getValue(ALIAS.fundedAmount)),
          validatedAmount: num(r.getValue(ALIAS.validatedAmount)),
          requirementId: extractLookupId(reqLookup),
          requirementName: r.getFormattedValue(ALIAS.requirement) ?? null,
          stateName: r.getFormattedValue(ALIAS.state) ?? null,
        };
      })
      // Sort by State first (alpha; null states sink), then State Priority.
      .sort((a, b) => {
        const sa = a.stateName ?? "￿";
        const sb = b.stateName ?? "￿";
        const cmp = sa.localeCompare(sb);
        if (cmp !== 0) return cmp;
        const pa = a.statePriority ?? Number.MAX_SAFE_INTEGER;
        const pb = b.statePriority ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      });
  }, [dataset?.sortedRecordIds, dataset?.records, overrideKey]);

  // ---- FY filter (over the Prios — same UX as 0.1.x) ----
  const fyOptions = React.useMemo<{ value: number; label: string }[]>(() => {
    const seen = new Map<number, string>();
    for (const p of initialPrioRows) {
      if (p.fiscalYear == null) continue;
      if (!seen.has(p.fiscalYear)) {
        seen.set(p.fiscalYear, p.fiscalYearLabel ?? `FY ${p.fiscalYear}`);
      }
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => b.value - a.value);
  }, [initialPrioRows]);

  const fyLabelFor = (value: number | null): string => {
    if (value == null) return "";
    const hit = fyOptions.find((o) => o.value === value);
    return hit?.label ?? `FY ${value}`;
  };

  const [internalFyFilter, setFyFilter] = React.useState<FYFilter>(FY_FILTER_ALL);
  const fyFilter: FYFilter = fyFilterOverride ?? internalFyFilter;
  const fyControlledByContainer = fyFilterOverride !== undefined;
  const fyDefaultApplied = React.useRef(false);

  React.useEffect(() => {
    if (fyControlledByContainer) return;
    if (fyOptions.length === 0) return;
    if (!fyDefaultApplied.current) {
      // Prefer the option whose label corresponds to the current calendar FY
      // ("FY 2026" today). Fall back to the newest option when the current FY
      // isn't represented in the data.
      const cur = currentFiscalYear();
      const match = fyOptions.find((o) => o.label.includes(String(cur)));
      setFyFilter(match ? match.value : fyOptions[0].value);
      fyDefaultApplied.current = true;
      return;
    }
    if (internalFyFilter !== FY_FILTER_ALL && !fyOptions.some((o) => o.value === internalFyFilter)) {
      setFyFilter(FY_FILTER_ALL);
    }
  }, [fyOptions, internalFyFilter, fyControlledByContainer]);

  const visiblePrios = React.useMemo<PrioRow[]>(() => {
    if (fyFilter === FY_FILTER_ALL) return initialPrioRows;
    return initialPrioRows.filter((p) => p.fiscalYear === fyFilter);
  }, [initialPrioRows, fyFilter]);

  // ---- Editable V&F state (batch Edit/Save mode for the main grid) ----
  const [prioRows, setPrioRows] = React.useState<PrioRow[]>(initialPrioRows);
  const [baselinePrio, setBaselinePrio] = React.useState<PrioRow[]>(initialPrioRows);
  const [itemRows, setItemRows] = React.useState<ItemRow[]>([]);
  const [baselineItems, setBaselineItems] = React.useState<ItemRow[]>([]);
  const [editMode, setEditMode] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [vfError, setVfError] = React.useState<string | null>(null);
  const [loadingItems, setLoadingItems] = React.useState(true);
  const [expandedItems, setExpandedItems] = React.useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = React.useState(0);

  // Reseed the editable rows/baseline from the dataset only when it genuinely
  // changes identity (a real refresh) and never while an edit is in flight.
  // A dataset.refresh() queued by a prior save resolves asynchronously; if that
  // late updateView lands mid-edit, an unguarded reseed wipes the user's
  // in-progress change — the reason only the first save "took" until you
  // navigated away and back.
  const lastSeenInitialRef = React.useRef<PrioRow[]>(initialPrioRows);
  React.useEffect(() => {
    if (lastSeenInitialRef.current === initialPrioRows) return;
    lastSeenInitialRef.current = initialPrioRows;
    if (editMode || saving) return;
    setPrioRows(initialPrioRows);
    setBaselinePrio(initialPrioRows);
  }, [initialPrioRows, editMode, saving]);

  // ---- Itemized Details fetch (one query across all visible Prios) ----
  React.useEffect(() => {
    // Don't refetch while an edit is in flight: a mid-edit refetch resets both
    // itemRows and baselineItems, discarding the user's in-progress line-item
    // edits (same failure mode as the main-grid reseed above). The post-save
    // reload still fires because onSave clears editMode before bumping
    // reloadKey.
    if (editMode) return;
    let cancelled = false;
    const ids = initialPrioRows.map((r) => r.id);
    if (ids.length === 0) {
      setItemRows([]);
      setBaselineItems([]);
      setLoadingItems(false);
      return;
    }
    setLoadingItems(true);
    const filter = ids
      .map((id) => `_book_prioritization_value eq ${id}`)
      .join(" or ");
    const options =
      "?$select=_book_prioritization_value,_book_requirementitem_value,_book_fundcenter_value," +
      `_book_lin_value,_book_country_value,` +
      `book_requestedamount,${ITEM_VALIDATED},${ITEM_FUNDED},${ITEM_NPM_COMMENT}` +
      "&$expand=book_RequirementItem($select=_book_item_value,_book_tdc_value)" +
      `&$filter=(${filter})`;

    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          ITEMIZED_DETAILS_ENTITY,
          options
        );
        if (cancelled) return;
        const rows: ItemRow[] = res.entities.map((e) => {
          const rd = e.book_RequirementItem as
            | Record<string, unknown>
            | undefined;
          const itemName =
            (rd?.[`_book_item_value${FV}`] as string | undefined) ?? null;
          const tdc = rd?.[`_book_tdc_value${FV}`];
          const lin = e[`_book_lin_value${FV}`];
          const country = e[`_book_country_value${FV}`];
          return {
          id: e.book_itemizeddetailsid as string,
          prioritizationId: ((e._book_prioritization_value as string) ?? "")
            .replace(/[{}]/g, "")
            .toLowerCase(),
          label:
            itemName ??
            (e[`_book_requirementitem_value${FV}`] as string | undefined) ??
            "(unnamed line item)",
          tdc: typeof tdc === "string" ? tdc : "",
          lin: typeof lin === "string" ? lin : "",
          country: typeof country === "string" ? country : "",
          fundCenter:
            (e[`_book_fundcenter_value${FV}`] as string | undefined) ?? "",
          requested: num(e.book_requestedamount),
          validated: num(e[ITEM_VALIDATED]),
          funded: num(e[ITEM_FUNDED]),
          npmComment: (e[ITEM_NPM_COMMENT] as string) ?? "",
          };
        });
        setItemRows(rows);
        setBaselineItems(rows);
      } catch {
        if (!cancelled) setVfError("Could not load Itemized Details.");
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialPrioRows, webAPI, reloadKey, editMode]);

  // ---- Junction rows per Prio (for the per-Prio "Allocate to RFs" dialog) ----
  const [junctions, setJunctions] = React.useState<Record<string, JunctionRow[]>>({});
  const [junctionsLoading, setJunctionsLoading] = React.useState<boolean>(false);
  const [junctionsError, setJunctionsError] = React.useState<string | null>(null);

  const reloadJunctions = React.useCallback(
    (prioIds: string[]) => {
      if (prioIds.length === 0) {
        setJunctions({});
        return;
      }
      setJunctionsLoading(true);
      setJunctionsError(null);

      const orClause = prioIds
        .map((id) => `_book_prioritization_value eq ${id}`)
        .join(" or ");
      const select =
        "?$select=book_name,book_fundedamount,book_validatedamount," +
        "_book_prioritization_value,_book_requirementfunding_value" +
        "&$expand=book_RequirementFunding($select=book_name,book_newfiscalyear)" +
        `&$filter=statecode eq 0 and (${orClause})`;

      webAPI
        .retrieveMultipleRecords(PRIORITIZATION_FUNDING_ENTITY, select)
        .then((res) => {
          const byPrio: Record<string, JunctionRow[]> = {};
          for (const id of prioIds) byPrio[id] = [];
          for (const e of res.entities) {
            const prioId = ((e._book_prioritization_value as string) ?? "")
              .replace(/[{}]/g, "")
              .toLowerCase();
            const rfId = ((e._book_requirementfunding_value as string) ?? "")
              .replace(/[{}]/g, "")
              .toLowerCase();
            const rf = e.book_RequirementFunding as
              | { book_name?: string; book_newfiscalyear?: number }
              | undefined;
            const row: JunctionRow = {
              id: e.book_prioritizationfundingid as string,
              name: (e.book_name as string) ?? "",
              prioritizationId: prioId,
              rfId,
              rfName: rf?.book_name ?? "(RF)",
              rfFiscalYear: rf?.book_newfiscalyear ?? null,
              fundedAmount: num(e.book_fundedamount),
              validatedAmount: num(e.book_validatedamount),
            };
            if (!byPrio[prioId]) byPrio[prioId] = [];
            byPrio[prioId].push(row);
          }
          for (const id of Object.keys(byPrio)) {
            byPrio[id].sort((a, b) => a.rfName.localeCompare(b.rfName));
          }
          setJunctions(byPrio);
          setJunctionsLoading(false);
          return;
        })
        .catch((err: unknown) => {
          setJunctionsError(
            err instanceof Error ? err.message : "Failed to load Prioritization Fundings."
          );
          setJunctionsLoading(false);
        });
    },
    [webAPI]
  );

  const prioIdsKey = initialPrioRows.map((p) => p.id).join("|");
  React.useEffect(() => {
    reloadJunctions(initialPrioRows.map((p) => p.id));
  }, [prioIdsKey, reloadJunctions]);

  // ---- Eligible RFs for the parent Requirement (drives Add-from-RF + TDP) ----
  const parentRequirementId = React.useMemo<string | null>(() => {
    for (const p of initialPrioRows) if (p.requirementId) return p.requirementId;
    return null;
  }, [initialPrioRows]);

  const [rfs, setRfs] = React.useState<RFOption[] | null>(null);
  const [rfsLoading, setRfsLoading] = React.useState<boolean>(false);

  const ensureRFs = React.useCallback((): void => {
    if (!parentRequirementId) return;
    if (rfs !== null || rfsLoading) return;
    setRfsLoading(true);

    const select =
      "?$select=book_name,book_newtdp,book_newfiscalyear,book_newwithholding" +
      `&$filter=_book_requirement_value eq ${parentRequirementId}` +
      " and statecode eq 0";

    webAPI
      .retrieveMultipleRecords(REQUIREMENT_FUNDING_ENTITY, select)
      .then((res) => {
        const options: RFOption[] = res.entities.map((e) => ({
          id: e.book_requirementfundingid as string,
          name: (e.book_name as string) ?? "(RF)",
          tdp: toNumber(e.book_newtdp),
          fiscalYear: (e.book_newfiscalyear as number | null) ?? null,
          fiscalYearLabel:
            (e[`book_newfiscalyear${FV}`] as string) ?? null,
        }));
        options.sort((a, b) => a.name.localeCompare(b.name));
        setRfs(options);
        setRfsLoading(false);
        return;
      })
      .catch(() => {
        setRfs([]);
        setRfsLoading(false);
      });
  }, [parentRequirementId, rfs, rfsLoading, webAPI]);

  React.useEffect(() => {
    ensureRFs();
  }, [ensureRFs]);

  // Total TDP across the Requirement's RFs (FY-filter-aware).
  const totalTDP = React.useMemo(() => {
    if (rfs == null) return null;
    const pool = rfs.filter((rf) =>
      fyFilter === FY_FILTER_ALL ? true : rf.fiscalYear === fyFilter
    );
    return pool.reduce((s, rf) => s + (rf.tdp ?? 0), 0);
  }, [rfs, fyFilter]);

  // ---- V&F helpers (derived totals from Items when present) ----
  const itemsFor = React.useCallback(
    (prioId: string) => itemRows.filter((i) => i.prioritizationId === prioId),
    [itemRows]
  );
  const hasItemized = React.useCallback(
    (prioId: string) => itemsFor(prioId).length > 0,
    [itemsFor]
  );

  const effective = React.useCallback(
    (prio: PrioRow): { validated: number; funded: number; derived: boolean } => {
      const items = itemsFor(prio.id);
      if (items.length > 0) {
        return {
          validated: items.reduce((s, i) => s + i.validated, 0),
          funded: items.reduce((s, i) => s + i.funded, 0),
          derived: true,
        };
      }
      return { validated: prio.validatedAmount, funded: prio.fundedAmount, derived: false };
    },
    [itemsFor]
  );

  const totals = React.useMemo(() => {
    let requested = 0,
      validated = 0,
      funded = 0,
      unfunded = 0;
    // Pending edits count, so the totals and the TDP guardrail warn before Save.
    const edited = new Map(prioRows.map((r) => [r.id, r]));
    for (const vp of visiblePrios) {
      const p = edited.get(vp.id) ?? vp;
      const eff = effective(p);
      requested += p.requestedAmount;
      validated += eff.validated;
      funded += eff.funded;
      unfunded += Math.max(p.requestedAmount - eff.funded, 0);
    }
    return { requested, validated, funded, unfunded };
  }, [visiblePrios, prioRows, effective]);

  // Whole-cent comparison: totals.funded is a running JS-float sum, so a total
  // that exactly equals TDP can land a sub-cent epsilon high and trip a strict
  // `>`. The plugin validates with exact C# decimals, so equal-to-the-cent is
  // fine — round both sides to avoid a phantom "exceeds by $0.00" false positive.
  const overAllocated =
    totalTDP != null &&
    Math.round(totals.funded * 100) > Math.round(totalTDP * 100);
  const withholdAvailable =
    totalTDP != null ? totalTDP - totals.funded : null;

  // ---- V&F editing ----
  const updatePrioMoney = (
    id: string,
    field: "validatedAmount" | "fundedAmount",
    value: number
  ): void => {
    setPrioRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const updateItemMoney = (
    id: string,
    field: "validated" | "funded",
    value: number
  ): void => {
    setItemRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const updateItemComment = (id: string, raw: string): void => {
    setItemRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, npmComment: raw } : r))
    );
  };

  const onCancel = (): void => {
    setPrioRows(baselinePrio);
    setItemRows(baselineItems);
    setEditMode(false);
    setVfError(null);
    // Reverted rows no longer carry the failed value.
    setRowResult((prev) => {
      const next: Record<string, ActionResult> = {};
      for (const [id, r] of Object.entries(prev)) if (r !== "error") next[id] = r;
      return next;
    });
  };

  // Every changed write, tagged with its Prio (for the row badge) and its
  // Funded delta (for ordering). Drives both onSave and the Save (N) count.
  interface PendingWrite {
    prioId: string;
    fundedDelta: number;
    run: () => Promise<unknown>;
  }
  const collectWrites = (): PendingWrite[] => {
    const writes: PendingWrite[] = [];

    // Direct Prios (no Itemized Details) that changed.
    const prioBase = new Map(baselinePrio.map((r) => [r.id, r]));
    for (const r of prioRows) {
      if (hasItemized(r.id)) continue;
      const base = prioBase.get(r.id);
      if (
        base &&
        base.validatedAmount === r.validatedAmount &&
        base.fundedAmount === r.fundedAmount
      )
        continue;
      writes.push({
        prioId: r.id,
        fundedDelta: r.fundedAmount - (base?.fundedAmount ?? 0),
        run: () =>
          webAPI.updateRecord(PRIORITIZATION_ENTITY, r.id, {
            [PRIO_VALIDATED]: r.validatedAmount,
            [PRIO_FUNDED]: r.fundedAmount,
          }),
      });
    }

    // Itemized Details that changed.
    const itemBase = new Map(baselineItems.map((r) => [r.id, r]));
    for (const it of itemRows) {
      const base = itemBase.get(it.id);
      if (
        base &&
        base.validated === it.validated &&
        base.funded === it.funded &&
        base.npmComment === it.npmComment
      )
        continue;
      writes.push({
        prioId: it.prioritizationId,
        fundedDelta: it.funded - (base?.funded ?? 0),
        run: () =>
          webAPI.updateRecord(ITEMIZED_DETAILS_ENTITY, it.id, {
            [ITEM_VALIDATED]: it.validated,
            [ITEM_FUNDED]: it.funded,
            [ITEM_NPM_COMMENT]:
              it.npmComment.trim() === "" ? null : it.npmComment,
          }),
      });
    }
    return writes;
  };
  const pendingCount = editMode ? collectWrites().length : 0;

  const onSave = async (): Promise<void> => {
    setVfError(null);
    // Collect every changed write tagged with its Funded delta, then run
    // reductions before increases. Each write is awaited so it commits (and,
    // for Itemized Details, rolls up onto its Prio) before the next is
    // validated. The cap plugins (PrioritizationFundingValidator /
    // JunctionGuard) only enforce the RF TDP cap on an *increase*, so landing
    // all decreases first frees the headroom an increase needs. This lets a
    // single save rebalance multiple rows around the cap — reducing some to
    // make room for others — even though no individual row is valid mid-save
    // and the RF may currently be over-cap (e.g. negative Withholding from a
    // Turn-In). Both Prio-level and Item-level writes share the RF's sibling
    // aggregate, so they are ordered together in one list.
    const writes = collectWrites();
    if (writes.length === 0) {
      setEditMode(false);
      return;
    }
    const touched = new Set(writes.map((w) => w.prioId));
    const done = new Set<string>();
    let current: string | null = null;
    setResults(touched, "saving");
    setSaving(true);
    try {
      // Reductions (and Funded-unchanged rows) first, increases last.
      writes.sort((a, b) => a.fundedDelta - b.fundedDelta);
      for (const w of writes) {
        current = w.prioId;
        await w.run();
        done.add(w.prioId);
      }
      current = null;

      // Reseed baselines from what we just committed so the *next* Edit/Save
      // cycle diffs against current values immediately — even if the host hands
      // back a stable dataset snapshot on refresh (common for subgrids), in
      // which case the reseed effect above never fires. Without this a second
      // save could diff against stale values and write nothing.
      setBaselinePrio(prioRows);
      setBaselineItems(itemRows);

      setResults(touched, "saved");
      setEditMode(false);
      refresh();
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setVfError(msg ?? "Save failed. Please try again or contact support.");
      // The failing row shows Error; rows fully written before it show Saved;
      // rows never reached drop their spinner (they're still pending edits).
      const failed = current;
      setResults([...done].filter((id) => id !== failed), "saved");
      setResults([...touched].filter((id) => id !== failed && !done.has(id)), null);
      if (failed) setResults([failed], "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleExpandItems = (id: string): void =>
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }));

  // ---- Allocate-to-RFs dialog ----
  const [allocPrioId, setAllocPrioId] = React.useState<string | null>(null);
  const [allocAddOpen, setAllocAddOpen] = React.useState<boolean>(false);
  const [allocAddRFId, setAllocAddRFId] = React.useState<string>("");
  const [allocBusy, setAllocBusy] = React.useState<boolean>(false);
  const [allocError, setAllocError] = React.useState<string | null>(null);
  // Junction id awaiting the inline "Remove?" confirmation (§9).
  const [allocConfirmDeleteId, setAllocConfirmDeleteId] = React.useState<string | null>(null);
  // Pending in-dialog edits keyed by junction id.
  const [allocEdits, setAllocEdits] = React.useState<
    Record<string, Partial<Record<JunctionField, number>>>
  >({});

  // Last resolved Prio snapshot for the open dialog. Every in-dialog write
  // (add/save/delete) calls refresh() -> dataset.refresh(), and while the PCF
  // host reloads the dataset the row transiently drops out of initialPrioRows.
  // Without this fallback the lookup below would go null mid-refresh and the
  // dialog (gated on allocPrio) would tear down after every action. Retaining
  // the last snapshot keeps the modal open until the user actually closes it.
  const lastAllocPrioRef = React.useRef<PrioRow | null>(null);
  const allocPrio = React.useMemo<PrioRow | null>(() => {
    if (!allocPrioId) return null;
    const found = initialPrioRows.find((p) => p.id === allocPrioId);
    if (found) {
      lastAllocPrioRef.current = found;
      return found;
    }
    // Dataset mid-refresh: fall back to the last snapshot for this same Prio.
    return lastAllocPrioRef.current?.id === allocPrioId
      ? lastAllocPrioRef.current
      : null;
  }, [allocPrioId, initialPrioRows]);

  const openAllocate = (prio: PrioRow): void => {
    setAllocPrioId(prio.id);
    setAllocAddOpen(false);
    setAllocAddRFId("");
    setAllocBusy(false);
    setAllocError(null);
    setAllocEdits({});
    setAllocConfirmDeleteId(null);
    ensureRFs();
  };

  const closeAllocate = (): void => {
    setAllocPrioId(null);
    setAllocAddOpen(false);
    setAllocAddRFId("");
    setAllocBusy(false);
    setAllocError(null);
    setAllocEdits({});
    setAllocConfirmDeleteId(null);
  };

  const allocJunctionValue = (row: JunctionRow, field: JunctionField): number => {
    const pending = allocEdits[row.id]?.[field];
    return pending ?? row[field];
  };

  const setAllocJunctionValue = (
    id: string,
    field: JunctionField,
    value: number
  ): void => {
    setAllocEdits((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const saveAllocations = async (): Promise<void> => {
    if (!allocPrioId) return;
    const list = junctions[allocPrioId] ?? [];
    // Funding reconciliation: the per-RF allocations must total exactly the Prio
    // Funded amount (mirror of the PrioritizationFundingGuard server cap — blocks
    // under- AND over-allocation before the round-trip). Validated is NOT reconciled
    // (it may exceed Funded), so only the funded sum is checked.
    const target = allocPrio ? effective(allocPrio).funded : 0;
    const finalFundedSum = list.reduce(
      (s, j) => s + allocJunctionValue(j, "fundedAmount"),
      0
    );
    if (Math.abs(finalFundedSum - target) >= 0.005) {
      setAllocError(
        `Allocations must total the Prioritization Funded amount (${formatCurrency(
          target
        )}). Current total is ${formatCurrency(finalFundedSum)} — ` +
          `allocate the remaining ${formatCurrency(
            target - finalFundedSum
          )} before saving.`
      );
      return;
    }
    setAllocBusy(true);
    setAllocError(null);
    try {
      // Same ordering rule as onSave: land junction reductions before
      // increases so the RF TDP cap (JunctionGuard.EnforceTDPCap, increase-only)
      // sees the freed headroom. Lets a save that reallocates across RFs —
      // pulling funding off one to add it to another — go through even when the
      // RF is momentarily at or over cap between rows.
      interface PendingAlloc {
        fundedDelta: number;
        run: () => Promise<unknown>;
      }
      const allocWrites: PendingAlloc[] = [];
      for (const j of list) {
        const e = allocEdits[j.id];
        if (!e) continue;
        const newFunded = e.fundedAmount ?? j.fundedAmount;
        const newValidated = e.validatedAmount ?? j.validatedAmount;
        if (newFunded === j.fundedAmount && newValidated === j.validatedAmount)
          continue;
        allocWrites.push({
          fundedDelta: newFunded - j.fundedAmount,
          run: () =>
            webAPI.updateRecord(PRIORITIZATION_FUNDING_ENTITY, j.id, {
              book_fundedamount: newFunded,
              book_validatedamount: newValidated,
            }),
        });
      }
      allocWrites.sort((a, b) => a.fundedDelta - b.fundedDelta);
      for (const w of allocWrites) await w.run();
      setAllocEdits({});
      setResults([allocPrioId], "saved");
      reloadJunctions(initialPrioRows.map((p) => p.id));
      refresh();
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setAllocError(msg ?? "Could not save allocations.");
    } finally {
      setAllocBusy(false);
    }
  };

  const addJunction = async (): Promise<void> => {
    if (!allocPrioId || !allocAddRFId) return;
    setAllocBusy(true);
    setAllocError(null);
    try {
      const payload: Record<string, unknown> = {
        [`book_Prioritization@odata.bind`]: `/${PRIORITIZATION_ENTITY}s(${allocPrioId})`,
        [`book_RequirementFunding@odata.bind`]: `/${REQUIREMENT_FUNDING_ENTITY}s(${allocAddRFId})`,
        book_fundedamount: 0,
        book_validatedamount: 0,
      };

      // Scope the junction to the state that owns the parent Prio, not the NPM
      // creating it here. Requires "record ownership across business units" so
      // owningbusinessunit is settable independently of owner; states then read
      // their own via Business-Unit-depth read without an org-wide leak.
      try {
        const prioRec = await webAPI.retrieveRecord(
          PRIORITIZATION_ENTITY,
          allocPrioId,
          "?$select=_owningbusinessunit_value"
        );
        const prioBu = (prioRec as { _owningbusinessunit_value?: string })
          ._owningbusinessunit_value;
        if (prioBu) {
          payload[`owningbusinessunit@odata.bind`] = `/businessunits(${prioBu})`;
        }
      } catch {
        // Non-fatal: fall back to default (creator's BU) ownership rather than
        // block the allocation. Backfill can re-scope any that slip through.
      }

      await webAPI.createRecord(PRIORITIZATION_FUNDING_ENTITY, payload);
      // Keep the add panel open (just clear the selection) so the user can add
      // several RFs back-to-back without re-opening it each time. The just-added
      // RF drops out of eligibleRFs; the panel collapses on its own once none
      // remain, or the user closes it with Cancel / the dialog with Close.
      setAllocAddRFId("");
      setResults([allocPrioId], "saved");
      reloadJunctions(initialPrioRows.map((p) => p.id));
      refresh();
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setAllocError(msg ?? "Could not add RF allocation.");
    } finally {
      setAllocBusy(false);
    }
  };

  const deleteJunction = async (row: JunctionRow): Promise<void> => {
    setAllocBusy(true);
    setAllocError(null);
    try {
      await webAPI.deleteRecord(PRIORITIZATION_FUNDING_ENTITY, row.id);
      setAllocEdits((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setResults([row.prioritizationId], "saved");
      reloadJunctions(initialPrioRows.map((p) => p.id));
      refresh();
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setAllocError(msg ?? "Could not delete RF allocation.");
    } finally {
      setAllocBusy(false);
    }
  };

  // ---- Render helpers ----
  const renderStat = (
    label: string,
    value: string,
    tone: "neutral" | "good" | "bad" = "neutral"
  ): React.ReactElement => (
    <div
      className={mergeClasses(
        styles.stat,
        tone === "good" && styles.statGood,
        tone === "bad" && styles.statBad
      )}
    >
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );

  const renderAllocDialog = (): React.ReactNode => {
    if (!allocPrio) return null;
    const list = junctions[allocPrio.id] ?? [];
    const allRFs = rfs ?? [];
    const usedIds = new Set(list.map((j) => j.rfId));
    const eligibleRFs = allRFs.filter((rf) => !usedIds.has(rf.id));
    const eff = effective(allocPrio);
    const allocFundedSum = list.reduce(
      (s, j) => s + allocJunctionValue(j, "fundedAmount"),
      0
    );
    const allocValidatedSum = list.reduce(
      (s, j) => s + allocJunctionValue(j, "validatedAmount"),
      0
    );
    const fundedDelta = allocFundedSum - eff.funded;
    const balanced = Math.abs(fundedDelta) < 0.005;
    const dirty = Object.keys(allocEdits).length > 0;
    const pendingDelete = list.find((j) => j.id === allocConfirmDeleteId) ?? null;

    return (
      <Dialog
        open
        onOpenChange={(_e, data) => {
          // Block dismiss while a write is in flight (§9).
          if (!data.open && !allocBusy) closeAllocate();
        }}
        modalType="modal"
      >
        <DialogSurface className={styles.dialogSurface}>
          <DialogBody>
            <DialogTitle>Allocate to RFs — {allocPrio.stateName ?? allocPrio.name}</DialogTitle>
            <DialogContent>
              <div className={styles.intro}>
                Split the Prioritization&apos;s Funded total across one or more
                Requirement Fundings. Allocations must total the Prio Funded
                amount before you can save. Validated may exceed Funded and is
                not reconciled.
              </div>

              {list.length === 0 ? (
                <div className={styles.empty}>
                  No RF allocations yet. Use <strong>Add from RF</strong> to
                  pick the source Requirement Fundings.
                </div>
              ) : (
                <div className={styles.dialogScroll}>
                  <table className={styles.subTable}>
                    <thead>
                      <tr>
                        <th className={styles.dialogTh}>Requirement Funding</th>
                        <th className={mergeClasses(styles.dialogTh, styles.num)}>Validated</th>
                        <th className={mergeClasses(styles.dialogTh, styles.num)}>Funded</th>
                        <th className={mergeClasses(styles.dialogTh, styles.actionsCol)}>
                          <span className={styles.srOnly}>Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((j) => (
                        <tr key={j.id}>
                          <td className={mergeClasses(styles.subTd, styles.rfCell)}>
                            <Link
                              as="button"
                              onClick={() =>
                                void navigation.openForm({
                                  entityName: REQUIREMENT_FUNDING_ENTITY,
                                  entityId: j.rfId,
                                  openInNewWindow: false,
                                })
                              }
                            >
                              {j.rfName}
                            </Link>
                            {j.rfFiscalYear != null && (
                              <span className={styles.rfFy}>{fyLabelFor(j.rfFiscalYear)}</span>
                            )}
                          </td>
                          <td className={mergeClasses(styles.subTd, styles.num)}>
                            <MoneyInput
                              live
                              className={styles.dialogMoneyBox}
                              aria-label={`Validated for ${j.rfName}`}
                              value={allocJunctionValue(j, "validatedAmount")}
                              disabled={isDisabled || allocBusy}
                              onCommit={(n) =>
                                setAllocJunctionValue(j.id, "validatedAmount", n ?? 0)
                              }
                            />
                          </td>
                          <td className={mergeClasses(styles.subTd, styles.num)}>
                            <MoneyInput
                              live
                              className={styles.dialogMoneyBox}
                              aria-label={`Funded for ${j.rfName}`}
                              value={allocJunctionValue(j, "fundedAmount")}
                              disabled={isDisabled || allocBusy}
                              onCommit={(n) =>
                                setAllocJunctionValue(j.id, "fundedAmount", n ?? 0)
                              }
                            />
                          </td>
                          <td className={mergeClasses(styles.subTd, styles.actionsCol)}>
                            <Tooltip
                              content={
                                canDeleteAllocation
                                  ? "Remove allocation"
                                  : "Insufficient Permission - Contact System Admin"
                              }
                              relationship="label"
                            >
                              <Button
                                appearance="subtle"
                                className={btn.icon}
                                disabled={isDisabled || allocBusy}
                                disabledFocusable={!canDeleteAllocation}
                                onClick={() => setAllocConfirmDeleteId(j.id)}
                                icon={<DeleteIcon size={16} />}
                              />
                            </Tooltip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Destructive actions confirm, naming what goes (§9). */}
              {pendingDelete && (
                <MessageBar intent="warning" className={styles.dialogNote}>
                  <MessageBarBody>
                    Remove the allocation from <strong>{pendingDelete.rfName}</strong> (
                    {formatCurrency(pendingDelete.fundedAmount)} funded)?
                  </MessageBarBody>
                  <MessageBarActions>
                    <Button
                      appearance="subtle"
                      className={btn.destructive}
                      icon={<DeleteIcon size={16} />}
                      disabled={allocBusy}
                      onClick={() => {
                        setAllocConfirmDeleteId(null);
                        void deleteJunction(pendingDelete);
                      }}
                    >
                      Remove
                    </Button>
                    <Button
                      appearance="subtle"
                      className={btn.action}
                      disabled={allocBusy}
                      onClick={() => setAllocConfirmDeleteId(null)}
                    >
                      Keep
                    </Button>
                  </MessageBarActions>
                </MessageBar>
              )}

              {/* Add from RF */}
              {!isDisabled && (
                <div className={styles.addRow}>
                  {!allocAddOpen ? (
                    <Button
                      appearance="subtle"
                      className={btn.action}
                      icon={<AddIcon size={16} />}
                      disabled={allocBusy}
                      onClick={() => {
                        setAllocAddOpen(true);
                        ensureRFs();
                      }}
                    >
                      Add from RF
                    </Button>
                  ) : rfsLoading ? (
                    <Spinner size="extra-tiny" label="Loading RFs…" labelPosition="after" />
                  ) : eligibleRFs.length === 0 ? (
                    <Text size={200} className={styles.muted}>
                      No additional Requirement Fundings available for this Requirement.
                    </Text>
                  ) : (
                    <>
                      <Combobox
                        className={styles.combo}
                        placeholder="Select a Requirement Funding"
                        aria-label="Requirement Funding to add"
                        value={eligibleRFs.find((rf) => rf.id === allocAddRFId)?.name ?? ""}
                        selectedOptions={allocAddRFId ? [allocAddRFId] : []}
                        onOptionSelect={(_e, data) => setAllocAddRFId(data.optionValue ?? "")}
                        disabled={allocBusy}
                      >
                        {eligibleRFs.map((rf) => (
                          <Option key={rf.id} value={rf.id} text={rf.name}>
                            {rf.name}
                            {rf.fiscalYearLabel ? ` — ${rf.fiscalYearLabel}` : ""}
                            {rf.tdp != null ? ` — TDP ${formatCurrency(rf.tdp)}` : ""}
                          </Option>
                        ))}
                      </Combobox>
                      <Button
                        appearance="subtle"
                        className={btn.action}
                        icon={allocBusy ? <Spinner size="extra-tiny" /> : <AddIcon size={16} />}
                        disabled={allocBusy || !allocAddRFId}
                        onClick={() => void addJunction()}
                      >
                        {allocBusy ? "Adding…" : "Add"}
                      </Button>
                      <Tooltip content="Cancel" relationship="label">
                        <Button
                          appearance="subtle"
                          className={btn.icon}
                          icon={<CloseIcon size={16} />}
                          disabled={allocBusy}
                          onClick={() => {
                            setAllocAddOpen(false);
                            setAllocAddRFId("");
                          }}
                        />
                      </Tooltip>
                    </>
                  )}
                </div>
              )}

              {allocError && <Text className={styles.dialogError}>{allocError}</Text>}

              {/* Sum vs Prio total */}
              <div className={styles.summaryRow}>
                {renderStat("Validated Sum", formatCurrency(allocValidatedSum))}
                {renderStat("Prio Funded (target)", formatCurrency(eff.funded))}
                {renderStat(
                  "Sum of Allocations",
                  formatCurrency(allocFundedSum),
                  balanced ? "good" : "bad"
                )}
              </div>
              {!balanced && (
                <Text className={styles.dialogWarn}>
                  {fundedDelta < 0 ? "Allocate" : "Remove"} another{" "}
                  {formatCurrency(Math.abs(fundedDelta))} so the allocations match
                  Prio Funded. Save Allocations unlocks when they do.
                </Text>
              )}
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" disabled={allocBusy}>
                  Close
                </Button>
              </DialogTrigger>
              {!isDisabled && (
                <Button
                  appearance="primary"
                  disabled={allocBusy || !dirty || !balanced}
                  title={
                    !balanced
                      ? "Allocations must total the Prio Funded amount before saving"
                      : undefined
                  }
                  icon={allocBusy ? <Spinner size="extra-tiny" /> : undefined}
                  onClick={() => void saveAllocations()}
                >
                  Save Allocations
                </Button>
              )}
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  };

  const showActions = !isDisabled;
  const colCount = showActions ? 8 : 7;

  return (
    // The form's PCF container is a flexbox, so this provider is a flex item
    // whose default min-width:auto grows to the table's full width and the
    // scroll container never overflows. minWidth: 0 lets it shrink to the
    // container, so the table scrolls inside scrollContainer.
    <FluentProvider
      theme={checkbookTheme}
      style={{ minWidth: 0, width: "100%", maxWidth: "100%" }}
    >
      <PortalRootContext.Provider value={portalRoot}>
      <div className={styles.root}>
        {/* Toolbar (§9) */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <span className={styles.title}>
              {!hideTitle && "Validate & Fund"}
              <span className={hideTitle ? styles.muted : styles.count}>
                {hideTitle ? "" : "("}
                {visiblePrios.length === initialPrioRows.length
                  ? initialPrioRows.length
                  : `${visiblePrios.length} of ${initialPrioRows.length}`}
                {hideTitle
                  ? ` prioritization${initialPrioRows.length === 1 ? "" : "s"}`
                  : ")"}
              </span>
            </span>
            {fyOptions.length > 0 && !hideFyPicker && !fyControlledByContainer && (
              <div className={styles.fyFilter}>
                <Text size={200}>Fiscal Year</Text>
                <Combobox
                  className={styles.combo}
                  aria-label="Fiscal Year"
                  value={fyFilter === FY_FILTER_ALL ? "All" : fyLabelFor(fyFilter)}
                  selectedOptions={[
                    fyFilter === FY_FILTER_ALL ? FY_FILTER_ALL : String(fyFilter),
                  ]}
                  onOptionSelect={(_e, data) => {
                    const v = data.optionValue;
                    if (!v || v === FY_FILTER_ALL) setFyFilter(FY_FILTER_ALL);
                    else setFyFilter(Number(v));
                  }}
                >
                  <Option value={FY_FILTER_ALL} text="All">
                    All
                  </Option>
                  {fyOptions.map((opt) => (
                    <Option key={opt.value} value={String(opt.value)} text={opt.label}>
                      {opt.label}
                    </Option>
                  ))}
                </Combobox>
              </div>
            )}
          </div>
          <div className={styles.toolbarButtons}>
            {/* Edit actions are hidden when read-only (§9). */}
            {!isDisabled &&
              (!editMode ? (
                <Button
                  appearance="subtle"
                  className={btn.action}
                  icon={<EditIcon size={16} />}
                  disabled={saving || initialPrioRows.length === 0}
                  onClick={() => setEditMode(true)}
                >
                  Edit
                </Button>
              ) : (
                <>
                  <Button
                    appearance="subtle"
                    className={btn.action}
                    icon={<UndoIcon size={16} />}
                    onClick={onCancel}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button
                    appearance="subtle"
                    className={btn.action}
                    icon={saving ? <Spinner size="extra-tiny" /> : <SaveIcon size={16} />}
                    onClick={() => void onSave()}
                    disabled={saving || pendingCount === 0}
                  >
                    {saving ? "Saving…" : pendingCount > 0 ? `Save (${pendingCount})` : "Save"}
                  </Button>
                </>
              ))}
            {/* Refresh: always last, always shown. */}
            <Button
              appearance="subtle"
              className={btn.action}
              icon={<RefreshIcon size={16} />}
              disabled={(dataset?.loading ?? false) || junctionsLoading || saving}
              onClick={() => {
                refresh();
                reloadJunctions(initialPrioRows.map((p) => p.id));
                setReloadKey((k) => k + 1);
              }}
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* TDP guardrail (aggregated across all RFs of this Requirement) */}
        {totalTDP != null && (
          <div className={styles.statStrip}>
            {renderStat(
              `Total TDP${fyFilter === FY_FILTER_ALL ? "" : ` (${fyLabelFor(fyFilter)})`}`,
              formatCurrency(totalTDP)
            )}
            {renderStat(
              "Currently Funded",
              formatCurrency(totals.funded),
              overAllocated ? "bad" : "neutral"
            )}
            {renderStat(
              "Withhold (Available)",
              formatCurrency(withholdAvailable),
              withholdAvailable != null && withholdAvailable < 0 ? "bad" : "good"
            )}
          </div>
        )}

        {overAllocated && totalTDP != null && (
          <MessageBar intent="warning" className={styles.banner}>
            <MessageBarBody>
              <strong>Over-allocated:</strong> Funded total (
              {formatCurrency(totals.funded)}) exceeds Total TDP (
              {formatCurrency(totalTDP)}) by{" "}
              {formatCurrency(totals.funded - totalTDP)} — the funding plugins
              will reject this on save.
            </MessageBarBody>
          </MessageBar>
        )}
        {vfError && (
          <MessageBar intent="error" className={styles.banner}>
            <MessageBarBody>{vfError}</MessageBarBody>
          </MessageBar>
        )}
        {junctionsError && (
          <MessageBar intent="error" className={styles.banner}>
            <MessageBarBody>{junctionsError}</MessageBarBody>
          </MessageBar>
        )}

        {dataset?.loading ? (
          <Spinner label="Loading Prioritizations…" />
        ) : visiblePrios.length === 0 ? (
          <div className={styles.empty}>
            No Prioritizations for this Requirement
            {fyFilter !== FY_FILTER_ALL ? ` in ${fyLabelFor(fyFilter)}` : ""}.
          </div>
        ) : (
          <div className={styles.scrollContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Prioritization</th>
                  <th className={styles.th}>Status</th>
                  <th className={mergeClasses(styles.th, styles.num)}>Requested</th>
                  <th className={mergeClasses(styles.th, styles.num)}>Validated</th>
                  <th className={mergeClasses(styles.th, styles.num)}>Funded</th>
                  <th className={mergeClasses(styles.th, styles.num)}>Unfunded</th>
                  <th className={styles.th}>Allocations</th>
                  {showActions && (
                    <th className={mergeClasses(styles.th, styles.actionsCol)}>Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visiblePrios.map((vp) => {
                  // Use editable copy from prioRows for V/F so edit mode reflects.
                  const editable = prioRows.find((r) => r.id === vp.id) ?? vp;
                  const eff = effective(editable);
                  const items = itemsFor(editable.id);
                  const isItemized = eff.derived;
                  // Only NPM-Review Prios are fundable; earlier stages show
                  // read-only (funding they don't yet legitimately hold would be
                  // invisible to the RF roll-up — see PrioritizationFundingApprovalGuard).
                  const canFund = isFundable(editable);
                  const editCell = editMode && !isItemized && canFund;
                  const isOpen = isItemized && !!expandedItems[editable.id];
                  const unfunded = Math.max(editable.requestedAmount - eff.funded, 0);
                  const jList = junctions[editable.id] ?? [];
                  const allocSum = jList.reduce((s, j) => s + j.fundedAmount, 0);
                  const allocBalanced = Math.abs(allocSum - eff.funded) < 0.005;
                  const modeLabel =
                    editable.fundingModeLabel ?? (isItemized ? "Itemized" : null);
                  const chips: ChipData[] = [
                    editable.statePriority != null
                      ? { type: "priority", label: "Priority", value: `#${editable.statePriority}` }
                      : null,
                    modeLabel
                      ? {
                          type: "fundingMode",
                          label: "Mode",
                          value: isItemized ? `${modeLabel} (${items.length})` : modeLabel,
                        }
                      : null,
                  ].filter((c): c is ChipData => c !== null);
                  const allocTip =
                    jList.length === 0
                      ? "No Requirement Fundings allocated yet"
                      : allocBalanced
                        ? `${jList.length} RF · ${formatCurrency(allocSum)}`
                        : `Unbalanced: allocations ${formatCurrency(allocSum)} vs Prio Funded ${formatCurrency(eff.funded)}`;
                  const allocateTip = !canFund
                    ? "Allocations open once the Prioritization reaches NPM Review"
                    : editMode
                      ? "Save or cancel your edits first"
                      : "Allocate to RFs";
                  return (
                    <React.Fragment key={editable.id}>
                      <tr className={mergeClasses(styles.row, isOpen && styles.rowOpen)}>
                        <td className={mergeClasses(styles.td, styles.firstCol)}>
                          <div className={styles.identity}>
                            <div className={styles.expanderSlot}>
                              {isItemized && (
                                // Native title: Fluent's Tooltip portals outside the
                                // theme here and renders transparent.
                                <Button
                                  appearance="subtle"
                                  className={btn.icon}
                                  title={isOpen ? "Hide line items" : "Show line items"}
                                  aria-label={isOpen ? "Hide line items" : "Show line items"}
                                  aria-expanded={isOpen}
                                  icon={<ChevronIcon open={isOpen} />}
                                  onClick={() => toggleExpandItems(editable.id)}
                                />
                              )}
                            </div>
                            <div>
                              <ItemName
                                result={rowResult[editable.id]}
                                name={
                                  <Link
                                    as="button"
                                    className={styles.prioLink}
                                    onClick={() =>
                                      void navigation.openForm({
                                        entityName: PRIORITIZATION_ENTITY,
                                        entityId: editable.id,
                                        openInNewWindow: false,
                                      })
                                    }
                                  >
                                    {editable.stateName ?? editable.name}
                                  </Link>
                                }
                              />
                              <ChipList chips={chips} />
                            </div>
                          </div>
                        </td>
                        <td className={styles.td}>
                          {editable.approvalStatus ? (
                            <StatusLabel kind={approvalKind(editable.approvalStatus)}>
                              {editable.approvalStatus}
                            </StatusLabel>
                          ) : (
                            <span className={styles.muted}>—</span>
                          )}
                        </td>
                        <td className={mergeClasses(styles.td, styles.num)}>
                          {formatCurrency(editable.requestedAmount)}
                        </td>
                        <td className={mergeClasses(styles.td, styles.num)}>
                          {editCell ? (
                            <MoneyInput
                              live
                              className={styles.moneyBox}
                              aria-label={`Validated for ${editable.stateName ?? editable.name}`}
                              value={editable.validatedAmount}
                              onCommit={(n) =>
                                updatePrioMoney(editable.id, "validatedAmount", n ?? 0)
                              }
                            />
                          ) : (
                            formatCurrency(eff.validated)
                          )}
                        </td>
                        <td className={mergeClasses(styles.td, styles.num)}>
                          {editCell ? (
                            <MoneyInput
                              live
                              className={styles.moneyBox}
                              aria-label={`Funded for ${editable.stateName ?? editable.name}`}
                              value={editable.fundedAmount}
                              onCommit={(n) =>
                                updatePrioMoney(editable.id, "fundedAmount", n ?? 0)
                              }
                            />
                          ) : (
                            formatCurrency(eff.funded)
                          )}
                        </td>
                        <td
                          className={mergeClasses(
                            styles.td,
                            styles.num,
                            unfunded > 0 ? styles.unfunded : styles.muted
                          )}
                        >
                          {formatCurrency(unfunded)}
                        </td>
                        <td className={styles.td}>
                          <span tabIndex={0} title={allocTip}>
                            {jList.length === 0 ? (
                              <StatusLabel kind="neutral">No RFs</StatusLabel>
                            ) : allocBalanced ? (
                              <StatusLabel kind="success">
                                {jList.length} RF{jList.length === 1 ? "" : "s"}
                              </StatusLabel>
                            ) : (
                              <StatusLabel kind="warning">Unbalanced</StatusLabel>
                            )}
                          </span>
                        </td>
                        {showActions && (
                          <td className={mergeClasses(styles.td, styles.actionsCol)}>
                            {/* Text label so the icon's meaning is clear; title carries the
                                reason when it's disabled. */}
                            <Button
                              appearance="subtle"
                              className={mergeClasses(btn.action, styles.allocateBtn)}
                              icon={<AllocateIcon size={14} color="currentColor" />}
                              title={allocateTip}
                              disabledFocusable={editMode || !canFund}
                              onClick={() => openAllocate(editable)}
                            >
                              Allocate
                            </Button>
                          </td>
                        )}
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={colCount} className={styles.subCell}>
                            <table className={styles.subTable}>
                              <thead>
                                <tr>
                                  <th className={styles.subTh}>Requirement Item</th>
                                  <th className={styles.subTh}>TDC</th>
                                  <th className={styles.subTh}>Fund Center</th>
                                  <th className={mergeClasses(styles.subTh, styles.num)}>Requested</th>
                                  <th className={mergeClasses(styles.subTh, styles.num)}>Validated</th>
                                  <th className={mergeClasses(styles.subTh, styles.num)}>Funded</th>
                                  <th className={styles.subTh}>NPM Comment</th>
                                </tr>
                              </thead>
                              <tbody>
                                {items.map((it) => (
                                  <tr key={it.id} className={styles.row}>
                                    <td className={mergeClasses(styles.subTd, styles.subFirst)}>
                                      {it.label}
                                      <ChipList
                                        chips={[
                                          { type: "lin", label: "LIN", value: it.lin },
                                          { type: "country", label: "Country", value: it.country },
                                        ].filter((c) => c.value)}
                                      />
                                    </td>
                                    <td className={styles.subTd}>
                                      {it.tdc ? <TagLabel title={it.tdc}>{it.tdc}</TagLabel> : <span className={styles.muted}>—</span>}
                                    </td>
                                    <td className={mergeClasses(styles.subTd, styles.muted)}>
                                      {it.fundCenter || "State level"}
                                    </td>
                                    <td className={mergeClasses(styles.subTd, styles.num)}>
                                      {formatCurrency(it.requested)}
                                    </td>
                                    <td className={mergeClasses(styles.subTd, styles.num)}>
                                      {editMode && canFund ? (
                                        <MoneyInput
                                          live
                                          className={styles.moneyBox}
                                          aria-label={`Validated for ${it.label}`}
                                          value={it.validated}
                                          onCommit={(n) => updateItemMoney(it.id, "validated", n ?? 0)}
                                        />
                                      ) : (
                                        formatCurrency(it.validated)
                                      )}
                                    </td>
                                    <td className={mergeClasses(styles.subTd, styles.num)}>
                                      {editMode && canFund ? (
                                        <MoneyInput
                                          live
                                          className={styles.moneyBox}
                                          aria-label={`Funded for ${it.label}`}
                                          value={it.funded}
                                          onCommit={(n) => updateItemMoney(it.id, "funded", n ?? 0)}
                                        />
                                      ) : (
                                        formatCurrency(it.funded)
                                      )}
                                    </td>
                                    <td className={styles.subTd} style={{ whiteSpace: "normal" }}>
                                      {/* Editable only in edit mode on a fundable Prio; Save in
                                          the modal stages the text like any other edit. */}
                                      <NoteCell
                                        title={`NPM Comment for ${it.label}${it.tdc ? ` (TDC: ${it.tdc})` : ""}`}
                                        editable={editMode && canFund}
                                        value={it.npmComment}
                                        onSave={(text) => updateItemComment(it.id, text)}
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                {dataset?.paging && dataset.paging.hasNextPage && (
                  <tr className={styles.loadMoreRow}>
                    <td colSpan={colCount}>
                      <Button
                        appearance="transparent"
                        className={btn.loadMore}
                        onClick={() => dataset.paging.loadNextPage()}
                      >
                        Load more Prioritizations
                      </Button>
                    </td>
                  </tr>
                )}
                <tr className={styles.totalsRow}>
                  <td>Total</td>
                  <td />
                  <td className={styles.num}>{formatCurrency(totals.requested)}</td>
                  <td className={styles.num}>{formatCurrency(totals.validated)}</td>
                  <td className={mergeClasses(styles.num, overAllocated && styles.unfunded)}>
                    {formatCurrency(totals.funded)}
                  </td>
                  <td
                    className={mergeClasses(
                      styles.num,
                      totals.unfunded > 0 ? styles.unfunded : styles.muted
                    )}
                  >
                    {formatCurrency(totals.unfunded)}
                  </td>
                  <td />
                  {showActions && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {loadingItems && (
          <div className={styles.footNote}>
            <Spinner size="tiny" label="Loading Itemized Details…" labelPosition="after" />
          </div>
        )}

        {renderAllocDialog()}
        <div ref={setPortalRoot} />
      </div>
      </PortalRootContext.Provider>
    </FluentProvider>
  );
};
