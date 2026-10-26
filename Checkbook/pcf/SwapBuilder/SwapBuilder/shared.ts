import { makeStyles, shorthands, tokens } from "@fluentui/react-components";

export type WebApi = ComponentFramework.WebApi;
type Entity = ComponentFramework.WebApi.Entity;

// ---- entities / fields ----------------------------------------------------
export const SWAP = "book_stateswap";
export const SWAP_ITEM = "book_swapitem";
export const DETAIL_REDUCTION = "book_swapdetailreduction";
export const DETAIL_INCREASE = "book_swapdetailincrease";
export const PRIORITIZATION = "book_prioritization";
export const PRIO_FUNDING = "book_prioritizationfunding";
export const ITEMIZED_DETAILS = "book_itemizeddetails";
export const STATE = "book_state";

// Entity-SET (collection) names for @odata.bind paths — not uniformly logical + "s".
export const SET = {
  swap: "book_stateswaps",
  pf: "book_prioritizationfundings",
  detail: "book_itemizeddetailses",
};

export const FV = "@OData.Community.Display.V1.FormattedValue";

// Fired on window after the builder saves, so the State Swap approval bar (a separate
// control on the same form) re-reads readiness without a refresh.
export const ITEMS_SAVED_EVENT = "book:swap-items-saved";

export const STATECODE_ACTIVE = 0;
export const FINAL_APPROVED = 4;
export const FUNDING_MODE_ITEMIZED = 1;
export const FIRST_PF_LEG_FY = 2027;
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
export function errorText(e: unknown, fallback: string): string {
  return (e as { message?: string })?.message ?? fallback;
}
const fv = (e: Record<string, unknown> | null | undefined, attr: string): string =>
  ((e?.[`_${attr}_value${FV}`] as string) ?? "").trim();

export interface StateRef {
  id: string;
  name: string;
}

// ---- legs (book_swapitem) ---------------------------------------------------
/** One active swap item: a PF → PF leg. Credit fields are empty until the receiver picks. */
export interface Leg {
  id: string;
  amount: number;
  debitStateId: string;
  debitPfId: string;
  debitPrioId: string;
  debitPrioName: string;
  debitLine: string; // the debit PF's Requirement Funding (Fund/SAG)
  creditPfId: string;
  creditPrioName: string;
  creditLine: string;
  fundId: string;
  pgId: string;
  fundPg: string;
}

export async function loadLegs(webAPI: WebApi, swapId: string): Promise<Leg[]> {
  const res = await webAPI.retrieveMultipleRecords(
    SWAP_ITEM,
    "?$select=book_newamount,_book_debitstate_value,_book_debitprioritizationfunding_value," +
      "_book_creditprioritizationfunding_value,_book_debitprioritization_value,_book_creditprioritization_value," +
      "_book_fund_value,_book_pg_value" +
      `&$filter=_book_stateswap_value eq ${swapId} and statecode eq ${STATECODE_ACTIVE}` +
      "&$expand=book_DebitPrioritizationFunding($select=_book_requirementfunding_value)," +
      "book_CreditPrioritizationFunding($select=_book_requirementfunding_value)" +
      "&$orderby=createdon asc"
  );
  return res.entities.map((e) => ({
    id: cleanId(e.book_swapitemid),
    amount: num(e.book_newamount),
    debitStateId: cleanId(e._book_debitstate_value),
    debitPfId: cleanId(e._book_debitprioritizationfunding_value),
    debitPrioId: cleanId(e._book_debitprioritization_value),
    debitPrioName: fv(e, "book_debitprioritization") || "(Prioritization)",
    debitLine: fv(e.book_DebitPrioritizationFunding as Entity, "book_requirementfunding"),
    creditPfId: cleanId(e._book_creditprioritizationfunding_value),
    creditPrioName: fv(e, "book_creditprioritization"),
    creditLine: fv(e.book_CreditPrioritizationFunding as Entity, "book_requirementfunding"),
    fundId: cleanId(e._book_fund_value),
    pgId: cleanId(e._book_pg_value),
    fundPg: [fv(e, "book_fund"), fv(e, "book_pg")].filter((x) => x !== "").join(" / "),
  }));
}

// ---- Itemized Detail adjustments (reductions / increases) -------------------
export interface Adjustment {
  id: string;
  detailId: string;
  detailLabel: string;
  amount: number;
  prioId: string;
  stateId: string;
}

export const ADJUSTMENT_TABLES = {
  reduction: { table: DETAIL_REDUCTION, idAttr: "book_swapdetailreductionid" },
  increase: { table: DETAIL_INCREASE, idAttr: "book_swapdetailincreaseid" },
};
export type AdjustmentKind = keyof typeof ADJUSTMENT_TABLES;

export async function loadAdjustments(webAPI: WebApi, swapId: string, kind: AdjustmentKind): Promise<Adjustment[]> {
  const { table, idAttr } = ADJUSTMENT_TABLES[kind];
  const res = await webAPI.retrieveMultipleRecords(
    table,
    `?$select=${idAttr},book_newamount,_book_itemizeddetail_value` +
      `&$filter=_book_stateswap_value eq ${swapId} and statecode eq ${STATECODE_ACTIVE}` +
      "&$expand=book_ItemizedDetail($select=_book_prioritization_value;$expand=book_Prioritization($select=_book_state_value))"
  );
  return res.entities.map((e) => {
    const d = e.book_ItemizedDetail as Entity | undefined;
    const p = d?.book_Prioritization as Entity | undefined;
    return {
      id: cleanId(e[idAttr]),
      detailId: cleanId(e._book_itemizeddetail_value),
      detailLabel: fv(e, "book_itemizeddetail") || "(detail)",
      amount: num(e.book_newamount),
      prioId: cleanId(d?._book_prioritization_value),
      stateId: cleanId(p?._book_state_value),
    };
  });
}

/**
 * Saves one side's detail adjustments in place: rows for a detail already saved are
 * UPDATED, new ones created, and only rows the user removed are deleted (last, since
 * only that needs the Delete privilege). `existing` must be this side's rows only —
 * the other state's reductions / increases live in the same tables.
 */
export async function saveAdjustments(
  webAPI: WebApi,
  swapId: string,
  kind: AdjustmentKind,
  existing: Adjustment[],
  desired: { detailId: string; amount: number }[]
): Promise<void> {
  const { table } = ADJUSTMENT_TABLES[kind];
  const byDetail = new Map(existing.map((a) => [a.detailId, a]));
  for (const d of desired) {
    const saved = byDetail.get(d.detailId);
    if (saved) {
      byDetail.delete(d.detailId);
      if (Math.abs(saved.amount - d.amount) >= EPS) await webAPI.updateRecord(table, saved.id, { book_newamount: d.amount });
    } else {
      await webAPI.createRecord(table, {
        book_newamount: d.amount,
        "book_StateSwap@odata.bind": `/${SET.swap}(${swapId})`,
        "book_ItemizedDetail@odata.bind": `/${SET.detail}(${d.detailId})`,
      });
    }
  }
  for (const a of byDetail.values()) await webAPI.deleteRecord(table, a.id);
}

// ---- Prioritization Funding lines ------------------------------------------
/** A PF junction with what the grids need: its RF (Fund/SAG) name and the LOA's Fund/PG. */
export interface PfLine {
  id: string;
  prioId: string;
  prioName: string;
  itemized: boolean;
  rfName: string;
  fundId: string;
  pgId: string;
  fundPg: string;
  funded: number;
}

export const PF_SELECT =
  "?$select=book_fundedamount,_book_prioritization_value,_book_requirementfunding_value" +
  "&$expand=book_RequirementFunding($select=book_name;$expand=book_LineofAccounting($select=_book_fund_value,_book_pg_value))," +
  "book_Prioritization($select=book_name,book_fundingmode)";

export function readPfLine(e: Entity): PfLine {
  const rf = e.book_RequirementFunding as Entity | undefined;
  const loa = rf?.book_LineofAccounting as Entity | undefined;
  const prio = e.book_Prioritization as Entity | undefined;
  return {
    id: cleanId(e.book_prioritizationfundingid),
    prioId: cleanId(e._book_prioritization_value),
    prioName: (prio?.book_name as string) ?? fv(e, "book_prioritization"),
    itemized: num(prio?.book_fundingmode) === FUNDING_MODE_ITEMIZED,
    rfName: (rf?.book_name as string) ?? (fv(e, "book_requirementfunding") || "(RF)"),
    fundId: cleanId(loa?._book_fund_value),
    pgId: cleanId(loa?._book_pg_value),
    fundPg: [fv(loa, "book_fund"), fv(loa, "book_pg")].filter((x) => x !== "").join(" / "),
    funded: num(e.book_fundedamount),
  };
}

/** Filter for funded PFs on active NPM Review Prioritizations of one state and FY. */
export function eligiblePfFilter(stateId: string, fiscalYear: number): string {
  return (
    `statecode eq ${STATECODE_ACTIVE} and book_fundedamount gt 0` +
    ` and book_Prioritization/_book_state_value eq ${stateId}` +
    ` and book_Prioritization/book_newfiscalyear eq ${fiscalYear}` +
    ` and book_Prioritization/book_approvalstatus eq ${FINAL_APPROVED}` +
    ` and book_Prioritization/statecode eq ${STATECODE_ACTIVE}`
  );
}

// ---- Itemized Details --------------------------------------------------------
export interface DetailRow {
  id: string;
  name: string; // autonumber — an identifier, not a description
  label: string; // Item · TDC · MDEP
  funded: number;
  requested: number;
  value: string; // the reduction / increase being entered
}

export async function loadDetails(webAPI: WebApi, prioId: string, prefill: Map<string, number>): Promise<DetailRow[]> {
  const res = await webAPI.retrieveMultipleRecords(
    ITEMIZED_DETAILS,
    "?$select=book_name,book_fundedamount,book_requestedamount" +
      "&$expand=book_RequirementItem($select=_book_item_value,_book_tdc_value,_book_mdep_value)" +
      `&$filter=_book_prioritization_value eq ${prioId} and statecode eq ${STATECODE_ACTIVE}&$orderby=book_name asc`
  );
  return res.entities.map((e) => {
    const ri = e.book_RequirementItem as Entity | undefined;
    const id = cleanId(e.book_itemizeddetailsid);
    const item = fv(ri, "book_item");
    return {
      id,
      name: (e.book_name as string) ?? "(detail)",
      label: [item !== "" ? item : "(no item)", fv(ri, "book_tdc"), fv(ri, "book_mdep")].filter((x) => x !== "").join(" · "),
      funded: num(e.book_fundedamount),
      requested: num(e.book_requestedamount),
      value: prefill.has(id) ? String(prefill.get(id)) : "",
    };
  });
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
  title: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
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
  lineCombo: { minWidth: "320px" },
  legStack: { display: "flex", flexDirection: "column", rowGap: "4px" },
  legRow: { display: "flex", alignItems: "center", columnGap: "8px" },
  balanceRow: { display: "flex", alignItems: "center", columnGap: "10px", flexWrap: "wrap" },
  footer: { display: "flex", alignItems: "center", columnGap: "12px" },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});
