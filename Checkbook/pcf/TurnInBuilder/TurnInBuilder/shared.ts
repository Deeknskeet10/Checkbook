import { makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { CB } from "./designSystem";

export type WebApi = ComponentFramework.WebApi;

// ---- entities / fields ----------------------------------------------------
export const TURNIN = "book_turnin";
export const TURNIN_ITEM = "book_turninitems";
export const DETAIL_REDUCTION = "book_turnindetailreduction";
export const RDF_REDUCTION = "book_turninrdfreduction";
export const PRIORITIZATION = "book_prioritization";
export const PRIO_FUNDING = "book_prioritizationfunding";
export const REQ_FUNDING = "book_requirementfunding";
export const RD_FUNDING = "book_requirementdetailfunding";
export const ITEMIZED_DETAILS = "book_itemizeddetails";
export const FUND_CENTER = "book_fundcenter";
export const OPR = "book_opr";

// Entity-SET (collection) names for @odata.bind paths — not uniformly logical + "s".
export const SET = {
  turnin: "book_turnins",
  prio: "book_prioritizations",
  pf: "book_prioritizationfundings",
  rf: "book_requirementfundings",
  detail: "book_itemizeddetailses",
  rdf: "book_requirementdetailfundings",
};

export const FV = "@OData.Community.Display.V1.FormattedValue";

// Fired on window after the builder saves, so the Turn-In approval bar (a separate
// control on the same form) re-reads whether BE Approval is needed.
export const ITEMS_SAVED_EVENT = "book:turnin-items-saved";

export const STATECODE_ACTIVE = 0;
export const FINAL_APPROVED = 4;
export const FUNDING_MODE_ITEMIZED = 1;
export const EPS = 0.005;

export type EntryMode = "state" | "rf";

export function num(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  return 0;
}
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/** Read-only money text (Design Documentation §3 / §6.2): "$1,250.50". */
export function money(n: number): string {
  return USD.format(n);
}
/** Compact currency for dense labels: 1000 -> $1.00K, 1,200,000 -> $1.20M, 1,234,000,000 -> $1.23B. */
export function moneyShort(n: number): string {
  const suffixes = ["", "K", "M", "B"];
  let x = Math.abs(n);
  let i = 0;
  while (x >= 1000 && i < suffixes.length - 1) {
    x /= 1000;
    i++;
  }
  let r = Math.round(x * 100) / 100;
  if (r >= 1000 && i < suffixes.length - 1) {
    r /= 1000; // e.g. 999,999 rounds to 1000.00K -> show 1.00M
    i++;
  }
  return `${n < 0 ? "-" : ""}$${r.toFixed(2)}${suffixes[i]}`;
}
/**
 * OData `contains(attr,'text')` clause for a user-typed value, or "" when blank.
 * Quotes are doubled (OData literal) and the text is URL-encoded for the query string.
 */
export function containsClause(
  attr: string,
  text: string | null | undefined,
): string {
  const t = (text ?? "").trim();
  return t
    ? ` and contains(${attr},'${encodeURIComponent(t.replace(/'/g, "''"))}')`
    : "";
}
/** Case-insensitive "contains" match used to filter combobox options as the user types. */
export function matches(
  name: string,
  typed: string | null | undefined,
): boolean {
  const q = (typed ?? "").trim().toLowerCase();
  return q === "" || name.toLowerCase().includes(q);
}
export function cleanId(v: unknown): string {
  return typeof v === "string" ? v.replace(/[{}]/g, "").toLowerCase() : "";
}

/** One child row the builder wants saved: `key` identifies it, `fields` is the full body. */
export interface DesiredRow {
  key: string;
  fields: Record<string, unknown>;
}

export interface DesiredChildren {
  items: DesiredRow[]; // key: PF id (Prioritization line) or "rf:" + RF id (RF line)
  details: DesiredRow[]; // key: Itemized Detail id
  rdfs: DesiredRow[]; // key: Requirement Detail Funding id
}

const itemKey = (e: ComponentFramework.WebApi.Entity): string =>
  e._book_prioritizationfunding_value
    ? cleanId(e._book_prioritizationfunding_value)
    : `rf:${cleanId(e._book_requirementfunding_value)}`;

/**
 * Saves the Turn-In's child rows from the builder grids. Existing rows with the same key
 * are UPDATED in place and new ones created; only rows the user removed are deleted.
 * Several creator roles (NPM, State PM, FC Reviewer, Resource Integrator) hold Create +
 * Write but not Delete on Turn-In Items, and DeactivationRoleGuard blocks deactivation,
 * so re-saving amounts must never need a delete. Covers all three child tables, so
 * switching entry type removes the other path's rows.
 */
export async function saveTurnInChildren(
  webAPI: WebApi,
  recordId: string,
  desired: DesiredChildren,
): Promise<void> {
  const parent = `_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`;
  const specs: {
    table: string;
    idAttr: string;
    select: string;
    key: (e: ComponentFramework.WebApi.Entity) => string;
    rows: DesiredRow[];
  }[] = [
    {
      table: TURNIN_ITEM,
      idAttr: "book_turninitemsid",
      select:
        "_book_prioritizationfunding_value,_book_requirementfunding_value",
      key: itemKey,
      rows: desired.items,
    },
    {
      table: DETAIL_REDUCTION,
      idAttr: "book_turnindetailreductionid",
      select: "_book_itemizeddetail_value",
      key: (e) => cleanId(e._book_itemizeddetail_value),
      rows: desired.details,
    },
    {
      table: RDF_REDUCTION,
      idAttr: "book_turninrdfreductionid",
      select: "_book_requirementdetailfunding_value",
      key: (e) => cleanId(e._book_requirementdetailfunding_value),
      rows: desired.rdfs,
    },
  ];

  const stale: [string, string][] = [];
  for (const s of specs) {
    const found = await webAPI.retrieveMultipleRecords(
      s.table,
      `?$select=${s.idAttr},${s.select}&$filter=${parent}`,
    );
    const existing = new Map<string, string>();
    for (const e of found.entities) {
      const k = s.key(e);
      const id = e[s.idAttr] as string;
      if (existing.has(k)) stale.push([s.table, id]);
      else existing.set(k, id);
    }
    for (const row of s.rows) {
      const id = existing.get(row.key);
      if (id) {
        await webAPI.updateRecord(s.table, id, row.fields);
        existing.delete(row.key);
      } else {
        await webAPI.createRecord(s.table, row.fields);
      }
    }
    for (const id of existing.values()) stale.push([s.table, id]);
  }
  // Removed lines last — the only step that needs the Delete privilege.
  for (const [table, id] of stale) await webAPI.deleteRecord(table, id);
}

const disabled = {
  opacity: 0.7,
  filter: "saturate(0)",
  cursor: "not-allowed",
} as const;

const choiceRow = {
  ...shorthands.padding("5px"),
  ...shorthands.borderRadius("5px"),
  transitionProperty: "background-color",
  transitionDuration: "120ms",
  ":hover": { backgroundColor: CB.controlHoverBg },
  ":has(input:disabled):hover": { backgroundColor: "transparent" },
} as const;

/** Builder layout + Checkbook design (Design Documentation.md §4–§8). */
export const useStyles = makeStyles({
  root: {
    ...shorthands.padding("8px"),
    display: "flex",
    flexDirection: "column",
    rowGap: "16px",
    // Fill the form cell: the host sizes a virtual control to its content otherwise.
    width: "100%",
    boxSizing: "border-box",
    fontFamily: tokens.fontFamilyBase,
    fontSize: "14px",
    color: tokens.colorNeutralForeground1,
  },
  section: { display: "flex", flexDirection: "column", rowGap: "8px" },
  heading: { fontWeight: tokens.fontWeightSemibold },
  /** Block title (Prioritization name, summary). */
  title: { fontWeight: tokens.fontWeightSemibold, fontSize: "16px" },
  /** Small field label above an input. */
  fieldLabel: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
  pickers: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    columnGap: "16px",
    rowGap: "12px",
  },
  pickerField: {
    display: "flex",
    flexDirection: "column",
    rowGap: "4px",
    minWidth: "220px",
  },

  // Turn-In type selector on top: label + horizontal radios, hairline below.
  typeBar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: "16px",
    rowGap: "4px",
    ...shorthands.padding("4px", "2px", "8px", "2px"),
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  radioGroup: { columnGap: "8px" },

  // §6.1 radio: #d9d9d9 ring at rest, brand when on, row tint + blue label on hover.
  radio: {
    ...choiceRow,
    ":hover .fui-Radio__label": { color: CB.brand },
    ":hover .fui-Radio__input:enabled:not(:checked) ~ .fui-Radio__indicator": {
      ...shorthands.borderColor(`${CB.brand} !important`),
    },
  },
  radioRing: {
    width: "18px",
    height: "18px",
    ...shorthands.border("1.5px", "solid", CB.controlLine),
  },

  // §6 editable input / combobox: grey fill, 2px blue-grey border on hover.
  editable: {
    backgroundColor: CB.inputFill,
    ...shorthands.border("2px", "solid", "transparent"),
    ":hover": {
      backgroundColor: "#fff",
      ...shorthands.borderColor(`${CB.inputHover} !important`),
    },
    "::after": { display: "none" },
    "& input": { backgroundColor: "transparent" },
  },
  listbox: {
    maxHeight: "200px",
    overflowY: "auto",
    "& .fui-Option": { whiteSpace: "normal" },
  },

  // §7 table: soft header band, hairline dividers, spacious rows.
  tableWrap: { width: "100%", overflowX: "auto" },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0 },
  th: {
    height: "40px",
    ...shorthands.padding("0", "16px"),
    textAlign: "left",
    backgroundColor: CB.tableHead,
    color: tokens.colorNeutralForeground2,
    fontSize: "11px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    whiteSpace: "nowrap",
    ":first-child": {
      borderTopLeftRadius: "8px",
      borderBottomLeftRadius: "8px",
    },
    ":last-child": {
      borderTopRightRadius: "8px",
      borderBottomRightRadius: "8px",
    },
  },
  td: {
    height: "56px",
    boxSizing: "border-box",
    ...shorthands.padding("12px", "16px"),
    ...shorthands.borderBottom("1px", "solid", CB.rowLine),
    verticalAlign: "middle",
  },
  /** Numeric column: right-aligned body and header, tabular figures. */
  num: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  /** Context column: muted. */
  ctx: { color: tokens.colorNeutralForeground3 },
  identity: { fontWeight: tokens.fontWeightSemibold },
  totals: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: "10px",
    minHeight: "52px",
    ...shorthands.padding("0", "16px"),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderTop("1px", "solid", tokens.colorNeutralStroke2),
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
  },

  amtInput: { width: "140px" },
  balanceRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: "10px",
    rowGap: "6px",
  },
  spacer: { flexGrow: 1 },

  // §5 buttons: subtle, borderless, icon first, background only on hover.
  action: {
    fontSize: "14px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground1,
    ...shorthands.padding("10px", "14px"),
    ":disabled": disabled,
    "&[aria-disabled='true']": disabled,
  },
  destructive: {
    fontSize: "14px",
    fontWeight: tokens.fontWeightRegular,
    color: CB.danger,
    ...shorthands.padding("10px", "14px"),
    ":hover": { color: CB.danger },
    ":hover:active": { color: CB.danger },
    ":disabled": disabled,
    "&[aria-disabled='true']": disabled,
  },
  /** [save icon] Save: no background at rest, brand-blue label and icon. */
  saveButton: {
    fontSize: "14px",
    fontWeight: tokens.fontWeightSemibold,
    color: CB.brand,
    ...shorthands.padding("10px", "14px"),
    ":hover": { color: CB.brandHover },
    ":hover:active": { color: CB.brandPressed },
    ":disabled": disabled,
    "&[aria-disabled='true']": disabled,
  },

  footer: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: "12px",
    rowGap: "6px",
  },
  muted: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },

  /** Waiting for record data (Design Documentation §8 Feedback): one sentence on a grey panel. */
  awaiting: {
    width: "100%",
    boxSizing: "border-box",
    ...shorthands.padding("12px", "16px"),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    fontFamily: tokens.fontFamilyBase,
  },

  // ---- RF Turn-In (TARC Requirement) layout -----------------------------------------
  /** Caps the form's width so it doesn't stretch across the whole form tab. */
  narrow: {
    display: "flex",
    flexDirection: "column",
    rowGap: "16px",
    width: "100%",
    maxWidth: "580px",
  },
  /** Two equal fields side by side (OPR · Fund). */
  pair: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    columnGap: "16px",
    rowGap: "12px",
  },
  /** Picked Requirement Funding's name, in brand blue. */
  rfTitle: {
    color: CB.brand,
    fontSize: "16px",
    fontWeight: tokens.fontWeightSemibold,
    wordBreak: "break-word",
  },
  /** Figure cards: 3 equal columns, so the Available card below lines up with them. */
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    columnGap: "12px",
    rowGap: "12px",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    rowGap: "2px",
    minWidth: 0,
    ...shorthands.padding("12px", "16px"),
    ...shorthands.borderRadius("8px"),
    backgroundColor: "#f5f5f5",
  },
  cardTitle: { fontSize: "13px", fontWeight: 700, opacity: 0.8 },
  cardValue: {
    fontSize: "20px",
    fontWeight: 700,
    fontFamily: "Consolas, 'Courier New', monospace",
    fontVariantNumeric: "tabular-nums",
    lineHeight: "26px",
  },
  cardSub: { fontSize: "14px", fontVariantNumeric: "tabular-nums" },
  cardAvailable: { backgroundColor: "#dbe9ff", color: "#1b3a6b" },
  // Turn-In Total card: StatusLabel success / warning tints (§8).
  cardSuccess: { backgroundColor: "#e2fcdc", color: "#14532d" },
  cardWarning: { backgroundColor: "#fef3c7", color: "#78350f" },

  // ---- State Turn-In -------------------------------------------------------------------
  /** Caps the State builder's width so its tables don't stretch across the form tab. */
  stateNarrow: {
    display: "flex",
    flexDirection: "column",
    rowGap: "16px",
    width: "100%",
    maxWidth: "760px",
  },
  /**
   * Itemized table in the Itemized Details Grid's density: 8px cell padding, rows size to
   * their tallest cell (item name + chips), row hover tint.
   */
  gridTable: {
    "& th": { ...shorthands.padding("0", "8px") },
    "& td": { height: "auto", ...shorthands.padding("6px", "8px") },
    "& tbody tr:hover": { backgroundColor: CB.rowHover },
  },
  /** ITEM column: item name, chips underneath; the only column that wraps. */
  itemCol: {
    whiteSpace: "normal",
    wordBreak: "break-word",
    verticalAlign: "top",
    minWidth: "210px",
  },
  /** Total row under the Itemized table. */
  totalRow: {
    "& td": {
      backgroundColor: tokens.colorNeutralBackground2,
      fontWeight: tokens.fontWeightSemibold,
      ...shorthands.borderBottom("none"),
    },
    "& td:first-child": {
      borderTopLeftRadius: "8px",
      borderBottomLeftRadius: "8px",
    },
    "& td:last-child": {
      borderTopRightRadius: "8px",
      borderBottomRightRadius: "8px",
    },
  },
  /** Two stacked figures in a right-aligned cell: reduced, then "of" the total. */
  stack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    rowGap: "2px",
  },
  /** Soft warning strip: amber left rule on a pale yellow band. */
  note: {
    ...shorthands.padding("8px", "12px"),
    ...shorthands.borderRadius("4px"),
    ...shorthands.borderLeft("3px", "solid", "#f2a900"),
    backgroundColor: "#fff8e1",
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
  },
});
