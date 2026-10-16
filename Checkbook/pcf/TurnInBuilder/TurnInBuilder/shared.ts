import { makeStyles, shorthands, tokens } from "@fluentui/react-components";

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
export function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
export async function saveTurnInChildren(webAPI: WebApi, recordId: string, desired: DesiredChildren): Promise<void> {
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
      select: "_book_prioritizationfunding_value,_book_requirementfunding_value",
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
    const found = await webAPI.retrieveMultipleRecords(s.table, `?$select=${s.idAttr},${s.select}&$filter=${parent}`);
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

export const useStyles = makeStyles({
  root: {
    ...shorthands.padding("12px"),
    display: "flex",
    flexDirection: "column",
    rowGap: "14px",
    // Fill the form cell: the host sizes a virtual control to its content otherwise.
    width: "100%",
    boxSizing: "border-box",
  },
  section: { display: "flex", flexDirection: "column", rowGap: "6px" },
  heading: { fontWeight: tokens.fontWeightSemibold },
  pickers: { display: "flex", flexWrap: "wrap", columnGap: "24px", rowGap: "10px" },
  pickerField: { display: "flex", flexDirection: "column", rowGap: "4px", minWidth: "260px" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    ...shorthands.padding("4px", "8px"),
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
  },
  td: {
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke3),
    ...shorthands.padding("4px", "8px"),
    verticalAlign: "middle",
  },
  amtInput: { width: "130px" },
  balanceRow: { display: "flex", alignItems: "center", columnGap: "10px" },
  footer: { display: "flex", alignItems: "center", columnGap: "12px" },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});
