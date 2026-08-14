import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  shorthands,
  tokens,
  Badge,
  Button,
  Combobox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  Link,
} from "@fluentui/react-components";
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

const useStyles = makeStyles({
  root: {
    ...shorthands.padding("12px"),
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: "12px",
    rowGap: "8px",
    marginBottom: "10px",
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    columnGap: "12px",
    flexWrap: "wrap",
    flexGrow: 1,
  },
  fyFilter: {
    display: "flex",
    alignItems: "center",
    columnGap: "6px",
  },
  statStrip: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: "8px",
    rowGap: "8px",
    marginBottom: "10px",
  },
  stat: {
    flexGrow: 1,
    minWidth: "140px",
    ...shorthands.padding("8px", "12px"),
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  statLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  statValue: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    fontVariantNumeric: "tabular-nums",
  },
  statGood: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    ...shorthands.borderColor(tokens.colorPaletteGreenBorder1),
  },
  statBad: {
    backgroundColor: tokens.colorPaletteRedBackground2,
    ...shorthands.borderColor(tokens.colorPaletteRedBorder1),
  },
  tableScroll: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    maxHeight: "min(75vh, 900px)",
    overflowY: "auto",
    overflowX: "auto",
  },
  table: {
    width: "100%",
    minWidth: "820px",
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: tokens.fontSizeBase200,
  },
  stickyTh: {
    textAlign: "left",
    ...shorthands.padding("8px", "12px"),
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase100,
    position: "sticky",
    top: 0,
    zIndex: 2,
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  stickyThNum: {
    textAlign: "right",
  },
  td: {
    ...shorthands.padding("8px", "12px"),
    verticalAlign: "middle",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  tdNum: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  tdRedNum: {
    color: tokens.colorPaletteRedForeground1,
  },
  tdGreenNum: {
    color: tokens.colorPaletteGreenForeground1,
  },
  prioCell: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
  },
  prioName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  prioSub: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
  },
  amountInput: {
    width: "130px",
    marginLeft: "auto",
    marginRight: "auto",
  },
  itemsHeaderRow: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  itemsTable: {
    width: "100%",
    borderCollapse: "collapse",
  },
  itemsTh: {
    textAlign: "left",
    ...shorthands.padding("6px", "12px", "6px", "28px"),
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
  },
  itemsThNum: {
    textAlign: "right",
  },
  itemsTd: {
    ...shorthands.padding("6px", "12px", "6px", "28px"),
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  codeBubble: {
    display: "inline-block",
    marginLeft: "6px",
    ...shorthands.padding("1px", "8px"),
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: "16px",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  },
  linBubble: {
    backgroundColor: "#daefff",
    color: tokens.colorPaletteBlueForeground2,
    ...shorthands.borderColor(tokens.colorPaletteBlueBorderActive),
  },
  countryBubble: {
    backgroundColor: "#d8ffd8",
    color: tokens.colorPaletteGreenForeground2,
    ...shorthands.borderColor(tokens.colorPaletteGreenBorderActive),
  },
  rowActions: {
    display: "flex",
    alignItems: "center",
    columnGap: "4px",
    justifyContent: "flex-end",
  },
  stickyFootTd: {
    ...shorthands.padding("8px", "12px"),
    position: "sticky",
    bottom: 0,
    zIndex: 2,
    backgroundColor: tokens.colorNeutralBackground3,
    fontWeight: tokens.fontWeightBold,
    borderTop: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  empty: {
    ...shorthands.padding("16px"),
    color: tokens.colorNeutralForeground3,
  },
  dialogSurface: {
    minWidth: "min(720px, 95vw)",
  },
  drawerJunctionList: {
    display: "flex",
    flexDirection: "column",
    rowGap: "6px",
    marginTop: "8px",
  },
  drawerJunctionHead: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, 1.5fr) 140px 140px 40px",
    columnGap: "10px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingBottom: "4px",
  },
  drawerJunctionRow: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, 1.5fr) 140px 140px 40px",
    columnGap: "10px",
    alignItems: "center",
  },
  drawerJunctionEmpty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    ...shorthands.padding("8px", "0"),
  },
  deleteButton: {
    opacity: 0.7,
    filter: "saturate(50%)",
    ":hover": {
      opacity: 1,
      filter: "saturate(100%)",
    },
  },
  deleteButtonDisabled: {
    opacity: 0.5,
    filter: "saturate(0%)",
    ":hover": {
      opacity: 0.5,
      filter: "saturate(0%)",
    },
  },
  drawerAddRow: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
    marginTop: "8px",
    flexWrap: "wrap",
  },
  drawerSummaryRow: {
    display: "flex",
    columnGap: "12px",
    marginTop: "12px",
    paddingTop: "8px",
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  drawerSummaryStat: {
    flexGrow: 1,
  },
  drawerErrorBar: {
    marginTop: "8px",
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

const DeleteIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="20" height="20" aria-hidden="true">
    <path
      fill="#9f151e"
      d="M232.7 69.9C237.1 56.8 249.3 48 263.1 48L377 48C390.8 48 403 56.8 407.4 69.9L416 96L512 96C529.7 96 544 110.3 544 128C544 145.7 529.7 160 512 160L128 160C110.3 160 96 145.7 96 128C96 110.3 110.3 96 128 96L224 96L232.7 69.9zM128 208L512 208L512 512C512 547.3 483.3 576 448 576L192 576C156.7 576 128 547.3 128 512L128 208zM216 272C202.7 272 192 282.7 192 296L192 488C192 501.3 202.7 512 216 512C229.3 512 240 501.3 240 488L240 296C240 282.7 229.3 272 216 272zM320 272C306.7 272 296 282.7 296 296L296 488C296 501.3 306.7 512 320 512C333.3 512 344 501.3 344 488L344 296C344 282.7 333.3 272 320 272zM424 272C410.7 272 400 282.7 400 296L400 488C400 501.3 410.7 512 424 512C437.3 512 448 501.3 448 488L448 296C448 282.7 437.3 272 424 272z"
    />
  </svg>
);

const parseMoney = (s: string): number => {
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
};

const sanitizeMoneyText = (s: string): string => {
  let out = (s ?? "").replace(/[^0-9.-]/g, "");
  const neg = out.startsWith("-");
  out = (neg ? "-" : "") + out.replace(/-/g, "");
  const dot = out.indexOf(".");
  if (dot !== -1) {
    out =
      out.slice(0, dot + 1) +
      out.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  }
  return out;
};

/**
 * Currency input that preserves the literal text the user is typing — partial
 * decimals like "100." or "100.5" en route to "100.50" survive until blur.
 * Re-formats to two decimal places on blur.
 */
const MoneyInput: React.FC<{
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  className?: string;
}> = ({ value, onChange, disabled, className }) => {
  const [text, setText] = React.useState<string>(() =>
    value === 0 ? "" : value.toFixed(2)
  );
  const lastEmittedRef = React.useRef<number>(value);
  React.useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setText(value === 0 ? "" : value.toFixed(2));
      lastEmittedRef.current = value;
    }
  }, [value]);

  return (
    <Input
      appearance="outline"
      disabled={disabled}
      className={className}
      value={text}
      onChange={(_e, d) => {
        const cleaned = sanitizeMoneyText(d.value);
        setText(cleaned);
        const parsed = parseMoney(cleaned);
        lastEmittedRef.current = parsed;
        onChange(parsed);
      }}
      onBlur={() => {
        const parsed = parseMoney(text);
        const formatted = text.trim() === "" ? "" : parsed.toFixed(2);
        setText(formatted);
        if (parsed !== lastEmittedRef.current) {
          lastEmittedRef.current = parsed;
          onChange(parsed);
        }
      }}
      input={{
        style: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
      }}
    />
  );
};

function approvalColor(label: string | null): "danger" | "warning" | "success" | "informative" | "brand" {
  const t = (label ?? "").toLowerCase();
  if (t.includes("approved") || t.includes("funded")) return "success";
  if (t.includes("reject") || t.includes("kick")) return "danger";
  if (t.includes("review") || t.includes("submit")) return "warning";
  if (t.includes("draft") || t.includes("planning")) return "informative";
  return "informative";
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
  const [vfSuccess, setVfSuccess] = React.useState<string | null>(null);
  const [loadingItems, setLoadingItems] = React.useState(true);
  const [expandedItems, setExpandedItems] = React.useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    setPrioRows(initialPrioRows);
    setBaselinePrio(initialPrioRows);
  }, [initialPrioRows]);

  // ---- Itemized Details fetch (one query across all visible Prios) ----
  React.useEffect(() => {
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
  }, [initialPrioRows, webAPI, reloadKey]);

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
    for (const p of visiblePrios) {
      const eff = effective(p);
      requested += p.requestedAmount;
      validated += eff.validated;
      funded += eff.funded;
      unfunded += Math.max(p.requestedAmount - eff.funded, 0);
    }
    return { requested, validated, funded, unfunded };
  }, [visiblePrios, effective]);

  const overAllocated = totalTDP != null && totals.funded > totalTDP;
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
    setVfSuccess(null);
  };

  const onSave = async (): Promise<void> => {
    setVfError(null);
    setVfSuccess(null);
    setSaving(true);
    try {
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
        await webAPI.updateRecord(PRIORITIZATION_ENTITY, r.id, {
          [PRIO_VALIDATED]: r.validatedAmount,
          [PRIO_FUNDED]: r.fundedAmount,
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
        await webAPI.updateRecord(ITEMIZED_DETAILS_ENTITY, it.id, {
          [ITEM_VALIDATED]: it.validated,
          [ITEM_FUNDED]: it.funded,
          [ITEM_NPM_COMMENT]: it.npmComment.trim() === "" ? null : it.npmComment,
        });
      }

      setVfSuccess("Validation & funding saved.");
      setEditMode(false);
      refresh();
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setVfError(msg ?? "Save failed. Please try again or contact support.");
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
  // Pending in-dialog edits keyed by junction id.
  const [allocEdits, setAllocEdits] = React.useState<
    Record<string, Partial<Record<JunctionField, number>>>
  >({});

  const allocPrio = React.useMemo<PrioRow | null>(() => {
    if (!allocPrioId) return null;
    return initialPrioRows.find((p) => p.id === allocPrioId) ?? null;
  }, [allocPrioId, initialPrioRows]);

  const openAllocate = (prio: PrioRow): void => {
    setAllocPrioId(prio.id);
    setAllocAddOpen(false);
    setAllocAddRFId("");
    setAllocBusy(false);
    setAllocError(null);
    setAllocEdits({});
    ensureRFs();
  };

  const closeAllocate = (): void => {
    setAllocPrioId(null);
    setAllocAddOpen(false);
    setAllocAddRFId("");
    setAllocBusy(false);
    setAllocError(null);
    setAllocEdits({});
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
    setAllocBusy(true);
    setAllocError(null);
    try {
      for (const j of list) {
        const e = allocEdits[j.id];
        if (!e) continue;
        const newFunded = e.fundedAmount ?? j.fundedAmount;
        const newValidated = e.validatedAmount ?? j.validatedAmount;
        if (newFunded === j.fundedAmount && newValidated === j.validatedAmount)
          continue;
        await webAPI.updateRecord(PRIORITIZATION_FUNDING_ENTITY, j.id, {
          book_fundedamount: newFunded,
          book_validatedamount: newValidated,
        });
      }
      setAllocEdits({});
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
      const payload = {
        [`book_Prioritization@odata.bind`]: `/${PRIORITIZATION_ENTITY}s(${allocPrioId})`,
        [`book_RequirementFunding@odata.bind`]: `/${REQUIREMENT_FUNDING_ENTITY}s(${allocAddRFId})`,
        book_fundedamount: 0,
        book_validatedamount: 0,
      };
      await webAPI.createRecord(PRIORITIZATION_FUNDING_ENTITY, payload);
      setAllocAddOpen(false);
      setAllocAddRFId("");
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
      className={`${styles.stat} ${
        tone === "good" ? styles.statGood : tone === "bad" ? styles.statBad : ""
      }`}
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
    const dirty = Object.keys(allocEdits).length > 0;

    return (
      <Dialog
        open
        onOpenChange={(_e, data) => {
          if (!data.open) closeAllocate();
        }}
        modalType="modal"
      >
        <DialogSurface className={styles.dialogSurface}>
          <DialogBody>
            <DialogTitle>
              Allocate to RFs — {allocPrio.name}
            </DialogTitle>
            <DialogContent>
              <Text size={200}>
                Split the Prioritization&apos;s Funded total across one or more
                Requirement Fundings. The plugin rolls each row up into the RF
                Funded / Validated.
              </Text>

              <div className={styles.drawerJunctionList}>
                {list.length === 0 ? (
                  <div className={styles.drawerJunctionEmpty}>
                    No RF allocations yet — use Add from RF below.
                  </div>
                ) : (
                  <>
                    <div className={styles.drawerJunctionHead}>
                      <div>Requirement Funding</div>
                      <div style={{ textAlign: "right" }}>Validated</div>
                      <div style={{ textAlign: "right" }}>Funded</div>
                      <div />
                    </div>
                    {list.map((j) => (
                      <div key={j.id} className={styles.drawerJunctionRow}>
                        <div>
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
                            <>
                              {" "}
                              <Badge appearance="outline" color="informative">
                                {fyLabelFor(j.rfFiscalYear)}
                              </Badge>
                            </>
                          )}
                        </div>
                        <MoneyInput
                          value={allocJunctionValue(j, "validatedAmount")}
                          disabled={isDisabled || allocBusy}
                          onChange={(n) =>
                            setAllocJunctionValue(j.id, "validatedAmount", n)
                          }
                        />
                        <MoneyInput
                          value={allocJunctionValue(j, "fundedAmount")}
                          disabled={isDisabled || allocBusy}
                          onChange={(n) =>
                            setAllocJunctionValue(j.id, "fundedAmount", n)
                          }
                        />
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
                            size="small"
                            className={`${styles.deleteButton} ${
                              canDeleteAllocation ? "" : styles.deleteButtonDisabled
                            }`}
                            disabled={isDisabled || allocBusy}
                            disabledFocusable={!canDeleteAllocation}
                            onClick={() => void deleteJunction(j)}
                            icon={<DeleteIcon />}
                            aria-label="Remove allocation"
                          />
                        </Tooltip>
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Add from RF */}
              <div className={styles.drawerAddRow}>
                {!allocAddOpen ? (
                  <Button
                    appearance="subtle"
                    size="small"
                    disabled={isDisabled || allocBusy}
                    onClick={() => {
                      setAllocAddOpen(true);
                      ensureRFs();
                    }}
                  >
                    + Add from RF
                  </Button>
                ) : rfsLoading ? (
                  <Spinner size="extra-tiny" label="Loading RFs…" labelPosition="after" />
                ) : eligibleRFs.length === 0 ? (
                  <Text size={200} className={styles.drawerJunctionEmpty}>
                    No additional Requirement Fundings available for this Requirement.
                  </Text>
                ) : (
                  <>
                    <Combobox
                      size="small"
                      placeholder="Select a Requirement Funding"
                      value={
                        eligibleRFs.find((rf) => rf.id === allocAddRFId)?.name ?? ""
                      }
                      selectedOptions={allocAddRFId ? [allocAddRFId] : []}
                      onOptionSelect={(_e, data) =>
                        setAllocAddRFId(data.optionValue ?? "")
                      }
                      disabled={isDisabled || allocBusy}
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
                      appearance="primary"
                      size="small"
                      disabled={isDisabled || allocBusy || !allocAddRFId}
                      onClick={() => void addJunction()}
                    >
                      {allocBusy ? "Adding…" : "Add"}
                    </Button>
                    <Button
                      appearance="subtle"
                      size="small"
                      onClick={() => {
                        setAllocAddOpen(false);
                        setAllocAddRFId("");
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </div>

              {allocError && (
                <MessageBar intent="error" className={styles.drawerErrorBar}>
                  <MessageBarBody>{allocError}</MessageBarBody>
                </MessageBar>
              )}

              {/* Sum vs Prio total */}
              <div className={styles.drawerSummaryRow}>
                <div className={styles.drawerSummaryStat}>
                  {renderStat(
                    "Validated Sum",
                    formatCurrency(allocValidatedSum)
                  )}
                </div>
                <div className={styles.drawerSummaryStat}>
                  {renderStat(
                    "Prio Funded (target)",
                    formatCurrency(eff.funded)
                  )}
                </div>
                <div className={styles.drawerSummaryStat}>
                  {renderStat(
                    "Sum of Allocations",
                    formatCurrency(allocFundedSum),
                    Math.abs(fundedDelta) < 0.005
                      ? "good"
                      : "bad"
                  )}
                </div>
              </div>
              {Math.abs(fundedDelta) >= 0.005 && (
                <MessageBar intent="warning" className={styles.drawerErrorBar}>
                  <MessageBarBody>
                    Allocation sum {formatCurrency(allocFundedSum)} differs
                    from Prio Funded {formatCurrency(eff.funded)} by{" "}
                    {formatCurrency(Math.abs(fundedDelta))}. Either adjust this
                    distribution, the items, or the Prio total.
                  </MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" disabled={allocBusy}>
                  Close
                </Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={isDisabled || allocBusy || !dirty}
                onClick={() => void saveAllocations()}
              >
                {allocBusy ? <Spinner size="extra-tiny" /> : "Save Allocations"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            {!hideTitle && (
              <Text weight="semibold" size={400}>
                Validate &amp; Fund
              </Text>
            )}
            <Badge appearance="outline" color="informative">
              {visiblePrios.length} of {initialPrioRows.length}{" "}
              prioritization{initialPrioRows.length === 1 ? "" : "s"}
            </Badge>
            {fyOptions.length > 0 && !hideFyPicker && !fyControlledByContainer && (
              <div className={styles.fyFilter}>
                <Text size={200}>FY</Text>
                <Combobox
                  size="small"
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
          {!editMode ? (
            <Button
              appearance="primary"
              disabled={isDisabled || saving || initialPrioRows.length === 0}
              onClick={() => setEditMode(true)}
            >
              Edit
            </Button>
          ) : (
            <>
              <Button onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => void onSave()}
                disabled={saving}
              >
                {saving ? <Spinner size="extra-tiny" /> : "Save"}
              </Button>
            </>
          )}
          <Button
            size="small"
            appearance="subtle"
            disabled={(dataset?.loading ?? false) || junctionsLoading}
            onClick={() => {
              refresh();
              reloadJunctions(initialPrioRows.map((p) => p.id));
              setReloadKey((k) => k + 1);
            }}
          >
            Refresh
          </Button>
        </div>

        {/* TDP guardrail strip (aggregated across all RFs of this Requirement) */}
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
          <MessageBar intent="warning" style={{ marginBottom: 10 }}>
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
          <MessageBar intent="error" style={{ marginBottom: 10 }}>
            <MessageBarBody>{vfError}</MessageBarBody>
          </MessageBar>
        )}
        {vfSuccess && (
          <MessageBar intent="success" style={{ marginBottom: 10 }}>
            <MessageBarBody>{vfSuccess}</MessageBarBody>
          </MessageBar>
        )}
        {junctionsError && (
          <MessageBar intent="error" style={{ marginBottom: 10 }}>
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
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.stickyTh}>Prioritization</th>
                  <th className={`${styles.stickyTh} ${styles.stickyThNum}`}>Requested</th>
                  <th className={`${styles.stickyTh} ${styles.stickyThNum}`}>Validated</th>
                  <th className={`${styles.stickyTh} ${styles.stickyThNum}`}>Funded</th>
                  <th className={`${styles.stickyTh} ${styles.stickyThNum}`}>Unfunded</th>
                  <th className={styles.stickyTh}>Allocations</th>
                </tr>
              </thead>
              <tbody>
                {visiblePrios.map((vp) => {
                  // Use editable copy from prioRows for V/F so edit mode reflects.
                  const editable =
                    prioRows.find((r) => r.id === vp.id) ?? vp;
                  const eff = effective(editable);
                  const items = itemsFor(editable.id);
                  const isItemized = eff.derived;
                  // Only NPM-Review Prios are fundable; earlier stages show
                  // read-only (funding they don't yet legitimately hold would be
                  // invisible to the RF roll-up — see PrioritizationFundingApprovalGuard).
                  const canFund = isFundable(editable);
                  const isOpen = !!expandedItems[editable.id];
                  const unfunded = Math.max(
                    editable.requestedAmount - eff.funded,
                    0
                  );
                  const jList = junctions[editable.id] ?? [];
                  const allocSum = jList.reduce(
                    (s, j) => s + j.fundedAmount,
                    0
                  );
                  const allocDelta = allocSum - eff.funded;
                  const allocBalanced = Math.abs(allocDelta) < 0.005;
                  return (
                    <React.Fragment key={editable.id}>
                      <tr>
                        <td className={styles.td}>
                          <div className={styles.prioCell}>
                            {isItemized && (
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => toggleExpandItems(editable.id)}
                              >
                                {isOpen ? "▾" : "▸"}
                              </Button>
                            )}
                            <div>
                              <Link
                                as="button"
                                className={styles.prioName}
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
                              <div className={styles.prioSub}>
                                {editable.statePriority != null && (
                                  <>Priority #{editable.statePriority}</>
                                )}
                                {editable.statePriority != null && isItemized && " · "}
                                {isItemized && `${items.length} itemized`}
                                {editable.fundingModeLabel && (
                                  <>
                                    {" · "}
                                    {editable.fundingModeLabel}
                                  </>
                                )}
                                {editable.approvalStatus && (
                                  <>
                                    {" · "}
                                    <Badge
                                      appearance="tint"
                                      color={approvalColor(editable.approvalStatus)}
                                    >
                                      {editable.approvalStatus}
                                    </Badge>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className={`${styles.td} ${styles.tdNum}`}>
                          {formatCurrency(editable.requestedAmount)}
                        </td>
                        <td className={`${styles.td} ${styles.tdNum}`}>
                          {editMode && !isItemized && canFund ? (
                            <MoneyInput
                              className={styles.amountInput}
                              value={editable.validatedAmount}
                              onChange={(n) =>
                                updatePrioMoney(editable.id, "validatedAmount", n)
                              }
                            />
                          ) : (
                            formatCurrency(eff.validated)
                          )}
                        </td>
                        <td className={`${styles.td} ${styles.tdNum}`}>
                          {editMode && !isItemized && canFund ? (
                            <MoneyInput
                              className={styles.amountInput}
                              value={editable.fundedAmount}
                              onChange={(n) =>
                                updatePrioMoney(editable.id, "fundedAmount", n)
                              }
                            />
                          ) : (
                            formatCurrency(eff.funded)
                          )}
                        </td>
                        <td
                          className={`${styles.td} ${styles.tdNum} ${
                            unfunded > 0 ? styles.tdRedNum : styles.tdGreenNum
                          }`}
                        >
                          {formatCurrency(unfunded)}
                        </td>
                        <td className={styles.td}>
                          <div className={styles.rowActions}>
                            {jList.length > 0 ? (
                              <Tooltip
                                content={
                                  allocBalanced
                                    ? `${jList.length} RF · ${formatCurrency(allocSum)}`
                                    : `Unbalanced: allocations ${formatCurrency(allocSum)} vs Prio Funded ${formatCurrency(eff.funded)}`
                                }
                                relationship="label"
                              >
                                <Badge
                                  appearance="tint"
                                  color={allocBalanced ? "success" : "warning"}
                                >
                                  {jList.length} RF
                                </Badge>
                              </Tooltip>
                            ) : (
                              <Badge appearance="outline" color="subtle">
                                0 RF
                              </Badge>
                            )}
                            <Button
                              size="small"
                              appearance="subtle"
                              disabled={isDisabled || editMode || !canFund}
                              onClick={() => openAllocate(editable)}
                            >
                              Allocate to RFs
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {isItemized && isOpen && (
                        <tr className={styles.itemsHeaderRow}>
                          <td colSpan={6} style={{ padding: 0 }}>
                            <table className={styles.itemsTable}>
                              <thead>
                                <tr>
                                  <th className={styles.itemsTh}>Requirement Item</th>
                                  <th className={styles.itemsTh}>TDC</th>
                                  <th className={styles.itemsTh}>Fund Center</th>
                                  <th className={`${styles.itemsTh} ${styles.itemsThNum}`}>Requested</th>
                                  <th className={`${styles.itemsTh} ${styles.itemsThNum}`}>Validated</th>
                                  <th className={`${styles.itemsTh} ${styles.itemsThNum}`}>Funded</th>
                                  <th className={styles.itemsTh}>NPM Comment</th>
                                  <th className={styles.itemsTh} />
                                </tr>
                              </thead>
                              <tbody>
                                {items.map((it) => (
                                  <tr key={it.id}>
                                    <td className={styles.itemsTd}>
                                      {it.label}
                                      {it.lin && (
                                        <span className={`${styles.codeBubble} ${styles.linBubble}`}>
                                          {it.lin}
                                        </span>
                                      )}
                                      {it.country && (
                                        <span className={`${styles.codeBubble} ${styles.countryBubble}`}>
                                          {it.country}
                                        </span>
                                      )}
                                    </td>
                                    <td className={styles.itemsTd}>{it.tdc}</td>
                                    <td className={styles.itemsTd}>
                                      {it.fundCenter || "State level"}
                                    </td>
                                    <td className={`${styles.itemsTd} ${styles.tdNum}`}>
                                      {formatCurrency(it.requested)}
                                    </td>
                                    <td className={`${styles.itemsTd} ${styles.tdNum}`}>
                                      {editMode && canFund ? (
                                        <MoneyInput
                                          className={styles.amountInput}
                                          value={it.validated}
                                          onChange={(n) =>
                                            updateItemMoney(it.id, "validated", n)
                                          }
                                        />
                                      ) : (
                                        formatCurrency(it.validated)
                                      )}
                                    </td>
                                    <td className={`${styles.itemsTd} ${styles.tdNum}`}>
                                      {editMode && canFund ? (
                                        <MoneyInput
                                          className={styles.amountInput}
                                          value={it.funded}
                                          onChange={(n) =>
                                            updateItemMoney(it.id, "funded", n)
                                          }
                                        />
                                      ) : (
                                        formatCurrency(it.funded)
                                      )}
                                    </td>
                                    <td className={styles.itemsTd}>
                                      {editMode && canFund ? (
                                        <Textarea
                                          appearance="outline"
                                          resize="vertical"
                                          value={it.npmComment}
                                          onChange={(_e, d) =>
                                            updateItemComment(it.id, d.value)
                                          }
                                        />
                                      ) : (
                                        it.npmComment
                                      )}
                                    </td>
                                    <td className={styles.itemsTd} />
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
                <tr>
                  <td className={styles.stickyFootTd}>Total</td>
                  <td className={`${styles.stickyFootTd} ${styles.tdNum}`}>
                    {formatCurrency(totals.requested)}
                  </td>
                  <td className={`${styles.stickyFootTd} ${styles.tdNum}`}>
                    {formatCurrency(totals.validated)}
                  </td>
                  <td
                    className={`${styles.stickyFootTd} ${styles.tdNum} ${
                      overAllocated ? styles.tdRedNum : ""
                    }`}
                  >
                    {formatCurrency(totals.funded)}
                  </td>
                  <td
                    className={`${styles.stickyFootTd} ${styles.tdNum} ${
                      totals.unfunded > 0 ? styles.tdRedNum : styles.tdGreenNum
                    }`}
                  >
                    {formatCurrency(totals.unfunded)}
                  </td>
                  <td className={styles.stickyFootTd} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {loadingItems && (
          <div style={{ marginTop: 8 }}>
            <Spinner size="tiny" label="Loading Itemized Details…" />
          </div>
        )}

        {dataset?.paging && dataset.paging.hasNextPage && (
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => dataset.paging.loadNextPage()}
            >
              Load more Prioritizations
            </Button>
          </div>
        )}

        {renderAllocDialog()}
      </div>
    </FluentProvider>
  );
};
