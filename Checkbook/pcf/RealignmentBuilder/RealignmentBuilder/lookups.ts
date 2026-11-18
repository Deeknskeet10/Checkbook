import * as React from "react";
import { WebApi, STATECODE_ACTIVE, cleanId, odataString } from "./shared";
import type { PickerOpt } from "./SearchPicker";

// Logical names used by the lookups below.
export const STATE = "book_state";
export const FUND_CENTER = "book_fundcenter";
export const FUND = "book_fund";
export const OPR = "book_opr";
export const LOA = "book_fundingline"; // "Line of Accounting"

/** Dataverse stock roles that may act for every State. */
export const ADMIN_ROLES = ["System Administrator", "Book - Checkbook Administrator"];

/** Max OR-ed ids per request, to keep Web API URLs short. */
const ID_CHUNK = 40;
/** Cap on LOAs / Requirements a Fund / Distributing Official / Requirement filter expands to. */
const SCOPE_CAP = 100;

/** Debounce a fast-changing value (typed text) so it only drives a query once it settles. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** `(attr eq a or attr eq b ...)` -- attr is a primary key or a `_x_value` lookup column. */
const orEq = (attr: string, ids: string[]): string => `(${ids.map((id) => `${attr} eq ${id}`).join(" or ")})`;

// ---- States -----------------------------------------------------------------

/**
 * ActualStateList: the States this user may realign in.
 *   LoadedStateList = every active State.
 *   Admins (System Administrator / Checkbook Administrator) get all of them; everyone else
 *   gets the States matching one of their Teams. A Team matches a State when its name is
 *   the State's name or abbreviation, or starts with "<State name> - " / "<Abbr> - "
 *   (the "{ABBR} - State Approver" convention), so "Virginia" never matches "West Virginia".
 * Returned alphabetically.
 */
export async function loadActualStates(webAPI: WebApi, userId: string, isAdmin: boolean): Promise<PickerOpt[]> {
  const res = await webAPI.retrieveMultipleRecords(
    STATE,
    `?$select=book_name,book_abbreviation&$filter=statecode eq ${STATECODE_ACTIVE}&$orderby=book_name asc`
  );
  const loaded = res.entities.map((e) => ({
    id: cleanId(e.book_stateid),
    name: (e.book_name as string) ?? "",
    abbr: ((e.book_abbreviation as string) ?? "").trim().toLowerCase(),
  }));

  let actual = loaded;
  if (!isAdmin) {
    const uid = cleanId(userId);
    const teams = uid
      ? await webAPI.retrieveMultipleRecords(
          "team",
          `?$select=name&$filter=teammembership_association/any(m:m/systemuserid eq ${uid})`
        )
      : { entities: [] as ComponentFramework.WebApi.Entity[] };
    const teamNames = teams.entities.map((t) => ((t.name as string) ?? "").trim().toLowerCase());
    actual = loaded.filter((s) => {
      const n = s.name.trim().toLowerCase();
      return teamNames.some(
        (t) => t === n || t.startsWith(`${n} - `) || (s.abbr !== "" && (t === s.abbr || t.startsWith(`${s.abbr} - `)))
      );
    });
  }
  return actual
    .filter((s) => s.id && s.name)
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- Fund Centers -----------------------------------------------------------

/** Fund Centers are a visible Business Unit table: Dataverse already hides the ones the user cannot access. */
export async function searchFundCenters(webAPI: WebApi, q: string, top: number): Promise<PickerOpt[]> {
  let filter = `statecode eq ${STATECODE_ACTIVE}`;
  if (q) filter += ` and contains(book_name,${odataString(q)})`;
  const res = await webAPI.retrieveMultipleRecords(
    FUND_CENTER,
    `?$select=book_name&$filter=${filter}&$orderby=book_name asc&$top=${top}`
  );
  return res.entities.map((e) => ({ id: cleanId(e.book_fundcenterid), name: (e.book_name as string) ?? "(fund center)" }));
}

// ---- Fund / Distributing Official of a Requirement Funding --------------------

export interface RfAccounting {
  fundId: string;
  officialId: string;
}

/** Requirement Funding -> Line of Accounting -> Fund + Distributing Official (book_disbursingofficial). */
export async function accountingForRfs(webAPI: WebApi, rfIds: string[]): Promise<Map<string, RfAccounting>> {
  const out = new Map<string, RfAccounting>();
  const ids = [...new Set(rfIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const loaByRf = new Map<string, string>();
  for (const part of chunk(ids, ID_CHUNK)) {
    const res = await webAPI.retrieveMultipleRecords(
      "book_requirementfunding",
      `?$select=_book_lineofaccounting_value&$filter=${orEq("book_requirementfundingid", part)}`
    );
    for (const e of res.entities) loaByRf.set(cleanId(e.book_requirementfundingid), cleanId(e._book_lineofaccounting_value));
  }

  const loaIds = [...new Set([...loaByRf.values()].filter(Boolean))];
  const byLoa = new Map<string, RfAccounting>();
  for (const part of chunk(loaIds, ID_CHUNK)) {
    const res = await webAPI.retrieveMultipleRecords(
      LOA,
      `?$select=_book_fund_value,_book_disbursingofficial_value&$filter=${orEq("book_fundinglineid", part)}`
    );
    for (const e of res.entities)
      byLoa.set(cleanId(e.book_fundinglineid), {
        fundId: cleanId(e._book_fund_value),
        officialId: cleanId(e._book_disbursingofficial_value),
      });
  }

  for (const [rfId, loaId] of loaByRf) out.set(rfId, byLoa.get(loaId) ?? { fundId: "", officialId: "" });
  return out;
}

// ---- OPR Requirement Funding filters -------------------------------------------

export interface RfFilter {
  official: PickerOpt | null;
  fund: PickerOpt | null;
  /** Requirement name text (matched with contains). */
  requirement: string;
}
export const EMPTY_RF_FILTER: RfFilter = { official: null, fund: null, requirement: "" };

/**
 * Turns the OPR Fund / Distributing Official / Requirement filter into an OData fragment for
 * a Requirement Funding query (" and (...)"), "" when no filter is set, or null when the
 * filter matches nothing (so the caller can skip the query). Fund and Distributing Official
 * live on the Line of Accounting, the Requirement on the Requirement Funding itself.
 */
export async function rfFilterFragment(webAPI: WebApi, f: RfFilter): Promise<string | null> {
  let fragment = "";

  if (f.fund || f.official) {
    let loaFilter = `statecode eq ${STATECODE_ACTIVE}`;
    if (f.fund) loaFilter += ` and _book_fund_value eq ${f.fund.id}`;
    if (f.official) loaFilter += ` and _book_disbursingofficial_value eq ${f.official.id}`;
    const res = await webAPI.retrieveMultipleRecords(
      LOA,
      `?$select=book_fundinglineid&$filter=${loaFilter}&$top=${SCOPE_CAP}`
    );
    const ids = res.entities.map((e) => cleanId(e.book_fundinglineid));
    if (ids.length === 0) return null;
    fragment += ` and ${orEq("_book_lineofaccounting_value", ids)}`;
  }

  const req = f.requirement.trim();
  if (req) {
    const res = await webAPI.retrieveMultipleRecords(
      "book_requirements",
      `?$select=book_requirementsid&$filter=statecode eq ${STATECODE_ACTIVE} and contains(book_name,${odataString(req)})&$top=${SCOPE_CAP}`
    );
    const ids = res.entities.map((e) => cleanId(e.book_requirementsid));
    if (ids.length === 0) return null;
    fragment += ` and ${orEq("_book_requirement_value", ids)}`;
  }

  return fragment;
}

/** Type-ahead search over a simple name-only table (Fund, OPR). */
export async function searchByName(
  webAPI: WebApi,
  table: string,
  idAttr: string,
  q: string,
  top: number
): Promise<PickerOpt[]> {
  let filter = `statecode eq ${STATECODE_ACTIVE}`;
  if (q) filter += ` and contains(book_name,${odataString(q)})`;
  const res = await webAPI.retrieveMultipleRecords(
    table,
    `?$select=book_name&$filter=${filter}&$orderby=book_name asc&$top=${top}`
  );
  return res.entities.map((e) => ({ id: cleanId(e[idAttr]), name: (e.book_name as string) ?? "(unnamed)" }));
}
