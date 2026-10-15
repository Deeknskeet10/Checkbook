import { makeStyles, shorthands, tokens } from "@fluentui/react-components";

export type WebApi = ComponentFramework.WebApi;

// ---- entities / fields ----------------------------------------------------
export const REALIGNMENT = "book_realignments";
export const REALIGNMENT_ITEM = "book_realignmentitem";
export const DETAIL_REDUCTION = "book_realignmentdetailreduction";
export const DETAIL_INCREASE = "book_realignmentdetailincrease";
export const RDF_REDUCTION = "book_realignmentrdfreduction";
export const RDF_INCREASE = "book_realignmentrdfincrease";
export const PRIORITIZATION = "book_prioritization";
export const PRIO_FUNDING = "book_prioritizationfunding";
export const REQ_FUNDING = "book_requirementfunding";
export const REQ_DETAILS = "book_requirementdetails";
export const RD_FUNDING = "book_requirementdetailfunding";
export const ITEMIZED_DETAILS = "book_itemizeddetails";

// Entity-SET (collection) names for @odata.bind paths. These are NOT uniformly
// logical-name + "s" (book_realignments -> book_realignmentses,
// book_itemizeddetails -> book_itemizeddetailses), so keep them explicit.
export const SET = {
  realignment: "book_realignmentses",
  prio: "book_prioritizations",
  pf: "book_prioritizationfundings",
  rf: "book_requirementfundings",
  detail: "book_itemizeddetailses",
  rd: "book_requirementdetailses",
  rdf: "book_requirementdetailfundings",
};

export const FV = "@OData.Community.Display.V1.FormattedValue";

// Fired on window after the builder saves, so the approval chevron (a separate
// control on the same form) re-reads the realignment shape without a refresh.
export const ITEMS_SAVED_EVENT = "book:realignment-items-saved";

// book_realignmententrymode choice values.
export const ENTRY_MODE_STATE = 0;
export const ENTRY_MODE_OPR = 1;
export type EntryMode = typeof ENTRY_MODE_STATE | typeof ENTRY_MODE_OPR;

export const STATECODE_ACTIVE = 0;
export const EPS = 0.005;

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

/**
 * Save rebuilds a realignment's child rows from the builder grids, in either entry
 * mode. Wipe every child table — not just the current mode's — so switching
 * State <-> OPR never leaves the other mode's rows behind for the processor.
 */
export async function wipeRealignmentChildren(webAPI: WebApi, recordId: string): Promise<void> {
  const tables: [string, string][] = [
    [REALIGNMENT_ITEM, "book_realignmentitemid"],
    [DETAIL_REDUCTION, "book_realignmentdetailreductionid"],
    [DETAIL_INCREASE, "book_realignmentdetailincreaseid"],
    [RDF_REDUCTION, "book_realignmentrdfreductionid"],
    [RDF_INCREASE, "book_realignmentrdfincreaseid"],
  ];
  const found = await Promise.all(
    tables.map(([table, idAttr]) =>
      webAPI.retrieveMultipleRecords(
        table,
        `?$select=${idAttr}&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`
      )
    )
  );
  for (let i = 0; i < tables.length; i++) {
    const [table, idAttr] = tables[i];
    for (const e of found[i].entities) await webAPI.deleteRecord(table, e[idAttr] as string);
  }
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
