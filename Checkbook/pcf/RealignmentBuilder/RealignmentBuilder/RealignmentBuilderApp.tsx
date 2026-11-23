import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
  Checkbox,
  Divider,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
} from "@fluentui/react-components";
import { SearchPicker, SEARCH_PAGE, PickerOpt } from "./SearchPicker";
import { ListDropdown } from "./ListDropdown";
import { loadActualStates, searchFundCenters, useDebounced } from "./lookups";

import {
  WebApi,
  REALIGNMENT,
  REALIGNMENT_ITEM,
  DETAIL_REDUCTION,
  DETAIL_INCREASE,
  PRIORITIZATION,
  PRIO_FUNDING,
  REQ_FUNDING,
  ITEMIZED_DETAILS,
  SET,
  FV,
  ITEMS_SAVED_EVENT,
  ENTRY_MODE_STATE,
  STATECODE_ACTIVE,
  EPS,
  num,
  money,
  cleanId,
  odataString,
  useStyles,
  wipeRealignmentChildren,
} from "./shared";

export interface StateBuilderProps {
  webAPI: WebApi;
  recordId: string;
  userId?: string;
  /** System Administrator / Checkbook Administrator: may pick any State. */
  isAdmin: boolean;
}

/** Max Prioritizations listed per dropdown; the user narrows with State / Fund Center / Requirement text. */
const PRIO_PAGE = 100;

// Itemized Detail query: the autonumber name plus the Requirement Item's Item / TDC / MDEP.
const DETAIL_SELECT =
  "?$select=book_name,book_fundedamount" +
  "&$expand=book_RequirementItem($select=_book_item_value,_book_tdc_value,_book_mdep_value)";
const FUNDING_MODE_ITEMIZED = 1;

interface PrioOpt {
  id: string;
  name: string;
  requirementId: string | null;
  /** The Prioritization's Requirement Funding; its Line of Accounting carries the Fund. */
  rfId: string;
  stateId: string;
  fundCenter: PickerOpt | null;
  fiscalYear: number | null;
  fundingMode: number | null;
}
interface PfRow {
  id: string;
  rfId: string;
  rfName: string;
  funded: number;
  move: string;
}
interface RfOpt {
  id: string;
  name: string;
}
interface DetailRow {
  id: string;
  /** book_name is an autonumber (Itemized-0001) -- an identifier, not a description. */
  name: string;
  // What the detail actually is: Requirement Item -> Item, plus its TDC and MDEP.
  item: string;
  tdc: string;
  mdep: string;
  funded: number;
  selected: boolean;
  reduce: string;
}

const toDetailRow = (e: Record<string, unknown>): DetailRow => {
  const ri = (e.book_RequirementItem as Record<string, unknown> | null | undefined) ?? {};
  const label = (attr: string): string => (ri[`_${attr}_value${FV}`] as string) ?? "";
  return {
    id: cleanId(e.book_itemizeddetailsid),
    name: (e.book_name as string) ?? "(detail)",
    item: label("book_item"),
    tdc: label("book_tdc"),
    mdep: label("book_mdep"),
    funded: num(e.book_fundedamount),
    selected: false,
    reduce: "",
  };
};

/** State entry path: debit Prioritization's PF junctions -> credit Prioritization + RF. */
export const StateBuilder: React.FC<StateBuilderProps> = ({ webAPI, recordId, userId, isAdmin }) => {
  const styles = useStyles();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const [isActive, setIsActive] = React.useState(true);
  const [fiscalYear, setFiscalYear] = React.useState<number | null>(null);
  // SelectedFiscalYear: the FY text used in Prioritization names ("FY2027").
  const [selectedFiscalYear, setSelectedFiscalYear] = React.useState<string>("");
  const [mode, setMode] = React.useState<"view" | "edit">("edit");

  // Already-saved rows (for the read-only summary).
  const [savedItems, setSavedItems] = React.useState<{ pfId: string; rfId: string; rf: string; amount: number }[]>([]);
  const [savedReductions, setSavedReductions] = React.useState<{ detailId: string; detail: string; amount: number }[]>([]);
  const [savedIncreases, setSavedIncreases] = React.useState<{ detailId: string; detail: string; amount: number }[]>([]);
  const [debitPrioName, setDebitPrioName] = React.useState<string>("");
  const [creditPrioName, setCreditPrioName] = React.useState<string>("");

  // Prioritizations the user has picked / saved (names, Requirement, funding mode).
  const [prios, setPrios] = React.useState<PrioOpt[]>([]);
  const [debitPrioId, setDebitPrioId] = React.useState<string>("");
  const [creditPrioId, setCreditPrioId] = React.useState<string>("");

  // State + Fund Center narrow both sides; each side has its own Requirement text.
  const [states, setStates] = React.useState<PickerOpt[]>([]); // ActualStateList
  const [statesLoading, setStatesLoading] = React.useState(true);
  const [stateId, setStateId] = React.useState<string>("");
  const [fundCenter, setFundCenter] = React.useState<PickerOpt | null>(null);
  const [debitReqText, setDebitReqText] = React.useState("");
  const [creditReqText, setCreditReqText] = React.useState("");
  const debitReqQuery = useDebounced(debitReqText.trim());
  const creditReqQuery = useDebounced(creditReqText.trim());
  const [debitResults, setDebitResults] = React.useState<PrioOpt[]>([]);
  const [creditResults, setCreditResults] = React.useState<PrioOpt[]>([]);
  const [debitSearching, setDebitSearching] = React.useState(false);
  const [creditSearching, setCreditSearching] = React.useState(false);
  const [debitCapped, setDebitCapped] = React.useState(false);
  const [creditCapped, setCreditCapped] = React.useState(false);
  const [debitRfId, setDebitRfId] = React.useState<string>("");

  const [pfRows, setPfRows] = React.useState<PfRow[]>([]);
  const [creditRfs, setCreditRfs] = React.useState<RfOpt[]>([]);
  const [creditRfId, setCreditRfId] = React.useState<string>("");
  const [detailRows, setDetailRows] = React.useState<DetailRow[]>([]);
  const [creditDetailRows, setCreditDetailRows] = React.useState<DetailRow[]>([]);

  const debitPrio = React.useMemo(
    () => prios.find((p) => p.id === debitPrioId) ?? null,
    [prios, debitPrioId]
  );
  const creditPrio = React.useMemo(
    () => prios.find((p) => p.id === creditPrioId) ?? null,
    [prios, creditPrioId]
  );
  const debitIsItemized = debitPrio?.fundingMode === FUNDING_MODE_ITEMIZED;
  const creditIsItemized = creditPrio?.fundingMode === FUNDING_MODE_ITEMIZED;

  // ---- initial load: realignment header + candidate Prioritizations --------
  React.useEffect(() => {
    if (!recordId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const r = await webAPI.retrieveRecord(
          REALIGNMENT,
          recordId,
          "?$select=statecode,book_realignmententrymode,book_newfiscalyear,book_newamount," +
            "_book_debitedprioritization_value,_book_creditedprioritization_value," +
            "_book_newdebitedrequirement_value,_book_newcreditedrequirement_value"
        );
        if (cancelled) return;
        const active = num(r.statecode) === STATECODE_ACTIVE;
        // The builder only works once book_newfiscalyear (goal_fiscalyear picklist, option value == the year)
        // is filled in.
        const fy = r.book_newfiscalyear == null ? null : num(r.book_newfiscalyear);
        const fyLabel = (r[`book_newfiscalyear${FV}`] as string | undefined) ?? "";
        setIsActive(active);
        setFiscalYear(fy);
        // Same text PrioritizationNameSetter stamps into the name: "FY" + year.
        setSelectedFiscalYear(fy == null ? "" : /^FY\d{4}$/.test(fyLabel) ? fyLabel : `FY${fy}`);
        setDebitPrioId(cleanId(r._book_debitedprioritization_value));
        setCreditPrioId(cleanId(r._book_creditedprioritization_value));
        setDebitRfId(cleanId(r._book_newdebitedrequirement_value));
        setCreditRfId(cleanId(r._book_newcreditedrequirement_value));
        setDebitPrioName((r[`_book_debitedprioritization_value${FV}`] as string) ?? "");
        setCreditPrioName((r[`_book_creditedprioritization_value${FV}`] as string) ?? "");

      } catch {
        if (!cancelled) setError("Could not load the Realignment.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, recordId, reloadKey]);

  // ---- ActualStateList -----------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    setStatesLoading(true);
    void (async () => {
      try {
        const list = await loadActualStates(webAPI, userId ?? "", isAdmin);
        if (cancelled) return;
        setStates(list);
        // Default to the first State alphabetically (the list is sorted).
        setStateId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ""));
      } catch {
        if (!cancelled) setError("Could not load your States.");
      } finally {
        if (!cancelled) setStatesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, userId, isAdmin]);
  const selectedState = states.find((s) => s.id === stateId) ?? null;
  const stateLocked = states.length === 1;

  // ---- Prioritization search ------------------------------------------------
  // Thousands per FY, so never preloaded: each side lists only the Prioritizations matching
  //   SearchQuery = SelectedFiscalYear-SelectedState-SelectedFundCenter-<Requirement text>
  // (the FY27+ name PrioritizationNameSetter stamps). The Fund Center and Requirement text
  // are optional: the name must start with the leading segments that are filled in and
  // contain the Requirement text.
  const PRIO_SELECT =
    "?$select=book_name,_book_requirement_value,_book_requirementfunding_value,_book_state_value," +
    "_book_fundcenter_value,book_newfiscalyear,book_fundingmode";
  const toPrio = (e: Record<string, unknown>): PrioOpt => ({
    id: cleanId(e.book_prioritizationid),
    name: (e.book_name as string) ?? "(unnamed)",
    requirementId: e._book_requirement_value ? cleanId(e._book_requirement_value) : null,
    rfId: cleanId(e._book_requirementfunding_value),
    stateId: cleanId(e._book_state_value),
    fundCenter: e._book_fundcenter_value
      ? {
          id: cleanId(e._book_fundcenter_value),
          name: (e[`_book_fundcenter_value${FV}`] as string) ?? "",
        }
      : null,
    fiscalYear: e.book_newfiscalyear == null ? null : num(e.book_newfiscalyear),
    fundingMode: e.book_fundingmode == null ? null : num(e.book_fundingmode),
  });
  const rememberPrio = React.useCallback(
    (p: PrioOpt): void => setPrios((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p])),
    []
  );
  const fetchPrios = React.useCallback(
    async (reqText: string): Promise<PrioOpt[]> => {
      if (fiscalYear == null || !selectedState) return [];
      const prefix = fundCenter
        ? `${selectedFiscalYear}-${selectedState.name}-${fundCenter.name}-`
        : `${selectedFiscalYear}-${selectedState.name}-`;
      let filter =
        `statecode eq ${STATECODE_ACTIVE} and book_newfiscalyear eq ${fiscalYear}` +
        ` and startswith(book_name,${odataString(prefix)})`;
      if (reqText) filter += ` and contains(book_name,${odataString(reqText)})`;
      const res = await webAPI.retrieveMultipleRecords(
        PRIORITIZATION,
        `${PRIO_SELECT}&$filter=${filter}&$orderby=book_name asc&$top=${PRIO_PAGE}`
      );
      return res.entities.map(toPrio);
    },
    [webAPI, fiscalYear, selectedFiscalYear, selectedState, fundCenter]
  );

  // Debit side: every match.
  React.useEffect(() => {
    let cancelled = false;
    setDebitSearching(true);
    void (async () => {
      try {
        const rows = await fetchPrios(debitReqQuery);
        if (cancelled) return;
        setDebitResults(rows);
        setDebitCapped(rows.length >= PRIO_PAGE);
      } catch {
        if (!cancelled) setError("Could not search the debiting Prioritizations.");
      } finally {
        if (!cancelled) setDebitSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPrios, debitReqQuery]);

  // Credit side: any matching Prioritization except the debit one.
  // TEMPORARY: the "same Fund as the debit Prioritization" restriction (Prio -> RF -> LOA -> Fund,
  // via accountingForRfs) is removed for now. Restore it from git history when re-enabling.
  React.useEffect(() => {
    if (!debitPrioId) {
      setCreditResults([]);
      setCreditSearching(false);
      return;
    }
    let cancelled = false;
    setCreditSearching(true);
    void (async () => {
      try {
        const rows = (await fetchPrios(creditReqQuery)).filter((p) => p.id !== debitPrioId);
        if (cancelled) return;
        setCreditResults(rows);
        setCreditCapped(rows.length >= PRIO_PAGE - 1);
      } catch {
        if (!cancelled) setError("Could not search the crediting Prioritizations.");
      } finally {
        if (!cancelled) setCreditSearching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPrios, creditReqQuery, debitPrioId]);

  // A saved selection is not in any result page: fetch it by id so its name,
  // Requirement and funding mode are known.
  React.useEffect(() => {
    for (const id of [debitPrioId, creditPrioId]) {
      if (!id || prios.some((p) => p.id === id)) continue;
      void webAPI
        .retrieveRecord(PRIORITIZATION, id, PRIO_SELECT)
        .then((e) => rememberPrio(toPrio(e)))
        .catch(() => setError("Could not load the selected Prioritization."));
    }
  }, [webAPI, debitPrioId, creditPrioId, prios, rememberPrio]);

  // Reopening a saved realignment: start the State / Fund Center filters on the saved debit Prioritization.
  const filtersSeeded = React.useRef(false);
  React.useEffect(() => {
    if (filtersSeeded.current || !debitPrio || states.length === 0) return;
    filtersSeeded.current = true;
    if (states.some((s) => s.id === debitPrio.stateId)) setStateId(debitPrio.stateId);
    if (debitPrio.fundCenter?.name) setFundCenter(debitPrio.fundCenter);
  }, [debitPrio, states]);

  const searchFcs = React.useCallback((q: string) => searchFundCenters(webAPI, q, SEARCH_PAGE), [webAPI]);

  // Debit RF dropdown: the RFs this Prioritization holds funding on (its Prioritization Funding junctions).
  const debitRfs = React.useMemo<RfOpt[]>(() => {
    const seen = new Set<string>();
    return pfRows
      .filter((r) => (seen.has(r.rfId) ? false : (seen.add(r.rfId), true)))
      .map((r) => ({ id: r.rfId, name: r.rfName }));
  }, [pfRows]);
  const debitPfRows = pfRows.filter((r) => r.rfId === debitRfId);

  // Credit RF picker: the Requirement's RFs are already loaded below, so filter them here.
  const searchCreditRfs = React.useCallback(
    (q: string): Promise<RfOpt[]> =>
      Promise.resolve(
        creditRfs
          .filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()))
          .slice(0, SEARCH_PAGE)
      ),
    [creditRfs]
  );

  // ---- when debit Prio changes: load its active PF junctions + details -----
  React.useEffect(() => {
    if (!debitPrioId) {
      setPfRows([]);
      setDetailRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pfRes = await webAPI.retrieveMultipleRecords(
          PRIO_FUNDING,
          `?$select=book_fundedamount,_book_requirementfunding_value` +
            `&$filter=_book_prioritization_value eq ${debitPrioId} and statecode eq ${STATECODE_ACTIVE}` +
            "&$expand=book_RequirementFunding($select=book_name)"
        );
        if (cancelled) return;
        const rows = pfRes.entities
          .map((e) => {
            const rf = e.book_RequirementFunding as Record<string, unknown> | undefined;
            return {
              id: cleanId(e.book_prioritizationfundingid),
              rfId: cleanId(e._book_requirementfunding_value),
              rfName:
                (rf?.book_name as string) ??
                (e[`_book_requirementfunding_value${FV}`] as string) ??
                "(RF)",
              funded: num(e.book_fundedamount),
              move: "",
            } as PfRow;
          })
          .filter((r) => r.funded > 0);
        setPfRows(rows);
        // Keep the saved / picked debit RF if this Prioritization funds it; otherwise default
        // to its only RF (or make the user choose).
        setDebitRfId((prev) =>
          rows.some((r) => r.rfId === prev) ? prev : rows.length === 1 ? rows[0].rfId : ""
        );

        const idRes = await webAPI.retrieveMultipleRecords(
          ITEMIZED_DETAILS,
          DETAIL_SELECT +
            `&$filter=_book_prioritization_value eq ${debitPrioId} and statecode eq ${STATECODE_ACTIVE}` +
            "&$orderby=book_name asc"
        );
        if (cancelled) return;
        setDetailRows(
          idRes.entities
            .map(toDetailRow)
            .filter((r) => r.funded > 0)
        );
      } catch {
        if (!cancelled) setError("Could not load the debiting Prioritization's funding.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, debitPrioId, reloadKey]);

  // ---- when credit Prio changes: load its Requirement's RFs ----------------
  React.useEffect(() => {
    if (!creditPrio?.requirementId) {
      setCreditRfs([]);
      return;
    }
    let cancelled = false;
    const fyFilter = creditPrio.fiscalYear == null ? "" : ` and book_newfiscalyear eq ${creditPrio.fiscalYear}`;
    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          REQ_FUNDING,
          "?$select=book_name" +
            `&$filter=_book_requirement_value eq ${creditPrio.requirementId} and statecode eq ${STATECODE_ACTIVE}${fyFilter}` +
            "&$orderby=book_name asc"
        );
        if (cancelled) return;
        const opts = res.entities.map((e) => ({
          id: cleanId(e.book_requirementfundingid),
          name: (e.book_name as string) ?? "(RF)",
        }));
        setCreditRfs(opts);
        setCreditRfId((prev) => (opts.some((o) => o.id === prev) ? prev : opts.length === 1 ? opts[0].id : ""));
      } catch {
        if (!cancelled) setError("Could not load the crediting Requirement Fundings.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, creditPrio, reloadKey]);

  // ---- when credit Prio is Itemized: load its details to increase ----------
  React.useEffect(() => {
    if (!creditPrioId || !creditIsItemized) {
      setCreditDetailRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          ITEMIZED_DETAILS,
          DETAIL_SELECT +
            `&$filter=_book_prioritization_value eq ${creditPrioId} and statecode eq ${STATECODE_ACTIVE}` +
            "&$orderby=book_name asc"
        );
        if (cancelled) return;
        setCreditDetailRows(
          res.entities.map(toDetailRow)
        );
      } catch {
        if (!cancelled) setError("Could not load the crediting Prioritization's details.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, creditPrioId, creditIsItemized, reloadKey]);

  // ---- load already-saved rows for the read-only summary -------------------
  React.useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [items, reds, incs] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            REALIGNMENT_ITEM,
            `?$select=book_newamount,_book_creditrequirementfunding_value,_book_debitprioritizationfunding_value` +
              `&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              " and _book_debitprioritizationfunding_value ne null"
          ),
          webAPI.retrieveMultipleRecords(
            DETAIL_REDUCTION,
            `?$select=book_newamount,_book_itemizeddetail_value` +
              `&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`
          ),
          webAPI.retrieveMultipleRecords(
            DETAIL_INCREASE,
            `?$select=book_newamount,_book_itemizeddetail_value` +
              `&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`
          ),
        ]);
        if (cancelled) return;
        const its = items.entities.map((e) => ({
          pfId: e._book_debitprioritizationfunding_value ? cleanId(e._book_debitprioritizationfunding_value) : "",
          rfId: e._book_creditrequirementfunding_value ? cleanId(e._book_creditrequirementfunding_value) : "",
          rf: (e[`_book_creditrequirementfunding_value${FV}`] as string) ?? "(RF)",
          amount: num(e.book_newamount),
        }));
        setSavedItems(its);
        setSavedReductions(
          reds.entities.map((e) => ({
            detailId: e._book_itemizeddetail_value ? cleanId(e._book_itemizeddetail_value) : "",
            detail: (e[`_book_itemizeddetail_value${FV}`] as string) ?? "(detail)",
            amount: num(e.book_newamount),
          }))
        );
        setSavedIncreases(
          incs.entities.map((e) => ({
            detailId: e._book_itemizeddetail_value ? cleanId(e._book_itemizeddetail_value) : "",
            detail: (e[`_book_itemizeddetail_value${FV}`] as string) ?? "(detail)",
            amount: num(e.book_newamount),
          }))
        );
        // Default to the summary when something is already saved.
        if (its.length > 0) setMode("view");
      } catch {
        /* non-fatal: summary just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, recordId, reloadKey]);

  // ---- derived totals ------------------------------------------------------
  // One debit RF: its junction row(s) carry the move amount.
  const selectedPf = debitPfRows.filter((r) => num(r.move) > 0);
  const moveTotal = selectedPf.reduce((s, r) => s + num(r.move), 0);
  const overMove = selectedPf.find((r) => num(r.move) > r.funded + EPS);
  const reduceTotal = detailRows.filter((r) => r.selected).reduce((s, r) => s + num(r.reduce), 0);
  const overReduce = detailRows.find((r) => r.selected && num(r.reduce) > r.funded + EPS);
  const needReductions = !!debitIsItemized && moveTotal > 0;
  const remaining = moveTotal - reduceTotal;
  const balanced = !needReductions || Math.abs(remaining) < EPS;

  // Credit side: everything lands on the one credit Prio, so when it is Itemized the
  // NPM must INCREASE details by the whole move total.
  const creditRaiseTotal = creditDetailRows.filter((r) => r.selected).reduce((s, r) => s + num(r.reduce), 0);
  const needIncreases = !!creditIsItemized && moveTotal > 0;
  const creditRemaining = moveTotal - creditRaiseTotal;
  const creditBalanced = !needIncreases || Math.abs(creditRemaining) < EPS;

  const canSave =
    isActive &&
    !!debitPrioId &&
    !!creditPrioId &&
    debitPrioId !== creditPrioId &&
    !!debitRfId &&
    !!creditRfId &&
    moveTotal > EPS &&
    !overMove &&
    !overReduce &&
    balanced &&
    creditBalanced;

  // ---- save ----------------------------------------------------------------
  const save = async (): Promise<void> => {
    if (!recordId || !canSave) return;
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    try {
      // 1) parent: entry mode + the four selections (debit/credit Prioritization and
      //    Requirement Funding) + legacy amount (for the flow viz). The items below, not
      //    these parent lookups, drive processing in the FY27 item model.
      await webAPI.updateRecord(REALIGNMENT, recordId, {
        book_realignmententrymode: ENTRY_MODE_STATE,
        book_newamount: moveTotal,
        [`book_DebitedPrioritization@odata.bind`]: `/${SET.prio}(${debitPrioId})`,
        [`book_CreditedPrioritization@odata.bind`]: `/${SET.prio}(${creditPrioId})`,
        [`book_newDebitedRequirement@odata.bind`]: `/${SET.rf}(${debitRfId})`,
        [`book_newCreditedRequirement@odata.bind`]: `/${SET.rf}(${creditRfId})`,
      });

      // 2) rebuild: wipe every child row (both entry modes) before re-creating.
      await wipeRealignmentChildren(webAPI, recordId);

      // 3) create one item per selected PF (debit PF -> credit RF, move amount).
      for (const r of selectedPf) {
        await webAPI.createRecord(REALIGNMENT_ITEM, {
          book_newamount: num(r.move),
          [`book_Realignment@odata.bind`]: `/${SET.realignment}(${recordId})`,
          [`book_DebitPrioritizationFunding@odata.bind`]: `/${SET.pf}(${r.id})`,
          [`book_CreditRequirementFunding@odata.bind`]: `/${SET.rf}(${creditRfId})`,
        });
      }

      // 4) create detail reductions (Itemized debit only).
      if (needReductions) {
        for (const r of detailRows.filter((d) => d.selected && num(d.reduce) > 0)) {
          await webAPI.createRecord(DETAIL_REDUCTION, {
            book_newamount: num(r.reduce),
            [`book_Realignment@odata.bind`]: `/${SET.realignment}(${recordId})`,
            [`book_ItemizedDetail@odata.bind`]: `/${SET.detail}(${r.id})`,
          });
        }
      }

      // 5) create detail increases (Itemized credit only).
      if (needIncreases) {
        for (const r of creditDetailRows.filter((d) => d.selected && num(d.reduce) > 0)) {
          await webAPI.createRecord(DETAIL_INCREASE, {
            book_newamount: num(r.reduce),
            [`book_Realignment@odata.bind`]: `/${SET.realignment}(${recordId})`,
            [`book_ItemizedDetail@odata.bind`]: `/${SET.detail}(${r.id})`,
          });
        }
      }

      setSaveMsg("Realignment items saved. Submit for approval from the Approval panel.");
      setMode("view");
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new CustomEvent(ITEMS_SAVED_EVENT, { detail: { id: recordId } }));
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not save the realignment items.");
    } finally {
      setSaving(false);
    }
  };

  // ---- edit: reopen the builder pre-filled with what is already saved --------
  // Save rebuilds the rows from the grids, so the grids must start from the saved
  // values or an edit silently drops every line the user does not re-enter. The
  // saved amounts are re-checked against live funded balances (overMove/overReduce).
  const beginEdit = (): void => {
    setSaveMsg(null);
    const moveByPf = new Map(savedItems.map((i) => [i.pfId, i.amount]));
    setPfRows((rows) => rows.map((r) => (moveByPf.has(r.id) ? { ...r, move: String(moveByPf.get(r.id)) } : r)));
    const savedPfRow = pfRows.find((r) => moveByPf.has(r.id));
    if (savedPfRow) setDebitRfId(savedPfRow.rfId);
    const prefill = (saved: { detailId: string; amount: number }[]) => {
      const byDetail = new Map(saved.map((d) => [d.detailId, d.amount]));
      return (rows: DetailRow[]): DetailRow[] =>
        rows.map((r) => (byDetail.has(r.id) ? { ...r, selected: true, reduce: String(byDetail.get(r.id)) } : r));
    };
    setDetailRows(prefill(savedReductions));
    setCreditDetailRows(prefill(savedIncreases));
    const savedRf = savedItems.find((i) => i.rfId)?.rfId;
    if (savedRf) setCreditRfId(savedRf);
    setMode("edit");
  };

  // Saved reductions/increases only carry the detail autonumber; describe them from
  // the loaded detail rows (Item / TDC / MDEP) so the summary reads the same as entry.
  const describeDetail = (detailId: string, fallback: string): React.ReactElement => {
    const row = detailRows.find((d) => d.id === detailId) ?? creditDetailRows.find((d) => d.id === detailId);
    return (
      <>
        <td className={styles.td}>{row && row.item !== "" ? row.item : fallback}</td>
        <td className={styles.td}>{row?.tdc ?? ""}</td>
        <td className={styles.td}>{row?.mdep ?? ""}</td>
        <td className={styles.td}>{row?.item ? fallback : ""}</td>
      </>
    );
  };
  const detailHead = (
    <>
      <th className={styles.th}>Item</th>
      <th className={styles.th}>TDC</th>
      <th className={styles.th}>MDEP</th>
      <th className={styles.th}>Detail #</th>
    </>
  );
  const detailCells = (r: DetailRow): React.ReactElement => (
    <>
      <td className={styles.td}>{r.item || "(no item)"}</td>
      <td className={styles.td}>{r.tdc}</td>
      <td className={styles.td}>{r.mdep}</td>
      <td className={styles.td}>{r.name}</td>
    </>
  );

  // ---- render --------------------------------------------------------------
  const savedItemsTotal = savedItems.reduce((s, r) => s + r.amount, 0);

  const renderSummary = (): React.ReactElement => (
    <div className={styles.section}>
      <div className={styles.balanceRow}>
        <Text className={styles.heading}>Realignment summary</Text>
        {isActive ? (
          <Badge color="informative" appearance="tint">Draft — not yet submitted</Badge>
        ) : (
          <Badge color="success" appearance="tint">Processed</Badge>
        )}
      </div>
      {savedItems.length === 0 ? (
        <Text>No funding moves saved on this realignment yet.</Text>
      ) : (
        <>
          <Text>
            Moving <b>{money(savedItemsTotal)}</b> from <b>{debitPrioName || "(debit Prioritization)"}</b> to{" "}
            <b>{creditPrioName || "(credit Prioritization)"}</b>.
          </Text>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Credit Requirement Funding</th>
                <th className={styles.th}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {savedItems.map((r, i) => (
                <tr key={i}>
                  <td className={styles.td}>{r.rf}</td>
                  <td className={styles.td}>{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {savedReductions.length > 0 && (
            <>
              <Text className={styles.heading}>Debit detail reductions</Text>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {detailHead}
                    <th className={styles.th}>Reduce by</th>
                  </tr>
                </thead>
                <tbody>
                  {savedReductions.map((r, i) => (
                    <tr key={i}>
                      {describeDetail(r.detailId, r.detail)}
                      <td className={styles.td}>−{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {savedIncreases.length > 0 && (
            <>
              <Text className={styles.heading}>Credit detail increases</Text>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {detailHead}
                    <th className={styles.th}>Increase by</th>
                  </tr>
                </thead>
                <tbody>
                  {savedIncreases.map((r, i) => (
                    <tr key={i}>
                      {describeDetail(r.detailId, r.detail)}
                      <td className={styles.td}>+{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      {saveMsg && (
        <MessageBar intent="success">
          <MessageBarBody>{saveMsg}</MessageBarBody>
        </MessageBar>
      )}
      {isActive && (
        <div className={styles.footer}>
          <Button appearance="secondary" onClick={beginEdit}>
            Edit items
          </Button>
          <Text>Submit for approval from the Approval panel above.</Text>
        </div>
      )}
    </div>
  );

  if (!recordId) {
    return (
      <FluentProvider theme={webLightTheme} style={{ width: "100%" }}>
        <div className={styles.root}>
          <MessageBar intent="info">
            <MessageBarBody>Save the Realignment record first, then build its items here.</MessageBarBody>
          </MessageBar>
        </div>
      </FluentProvider>
    );
  }

  return (
    <FluentProvider theme={webLightTheme} style={{ width: "100%" }}>
      <div className={styles.root}>
        {loading && <Spinner label="Loading..." />}
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {!loading && !isActive && (
          <MessageBar intent="warning">
            <MessageBarBody>This Realignment has been processed and can no longer be edited.</MessageBarBody>
          </MessageBar>
        )}

        {!loading && (mode === "view" || !isActive) && renderSummary()}

        {!loading && isActive && mode === "edit" && (
          <>
            {fiscalYear == null && (
              <MessageBar intent="info">
                <MessageBarBody>Set the Fiscal Year on this Realignment first; the builder lists that year&apos;s Prioritizations.</MessageBarBody>
              </MessageBar>
            )}
            {fiscalYear != null && !statesLoading && states.length === 0 && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  None of your Teams match a State, so there is nothing to realign here. Ask an administrator to add you to
                  your State&apos;s team.
                </MessageBarBody>
              </MessageBar>
            )}

            {fiscalYear != null && states.length > 0 && (
              <>
                <div className={styles.pickerField}>
                  <Label weight="semibold">Fiscal Year</Label>
                  <Text>{selectedFiscalYear}</Text>
                </div>

                {/* Filters shared by both sides: [State] [Fund Center] */}
                <div className={styles.pickers}>
                  <div className={styles.pickerField}>
                    <Label weight="semibold">State</Label>
                    <ListDropdown
                      placeholder="Select a State"
                      disabled={stateLocked}
                      busy={statesLoading}
                      options={states}
                      selected={selectedState}
                      onSelect={(s) => setStateId(s.id)}
                    />
                  </div>
                  <div className={styles.pickerField}>
                    <Label weight="semibold">Fund Center</Label>
                    <SearchPicker
                      placeholder="Type to search Fund Centers (optional)"
                      selected={fundCenter}
                      search={searchFcs}
                      onSelect={setFundCenter}
                      onClear={() => setFundCenter(null)}
                    />
                  </div>
                </div>

                <Divider />

                <div className={styles.sides}>
                  {/* DEBIT */}
                  <div className={styles.side}>
                    <Text className={styles.sideTitle}>DEBIT</Text>
                    <div className={styles.field}>
                      <Label weight="semibold">Requirement</Label>
                      <Input
                        placeholder="Type part of the Requirement name"
                        value={debitReqText}
                        onChange={(_, d) => setDebitReqText(d.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <Label weight="semibold">Prioritization</Label>
                      <ListDropdown
                        placeholder="Select the Prioritization to move funds FROM"
                        busy={debitSearching}
                        options={debitResults}
                        selected={debitPrio}
                        optionLabel={(p) => p.name + (p.fundingMode === FUNDING_MODE_ITEMIZED ? "  (Itemized)" : "")}
                        hint={debitCapped ? `Showing the first ${PRIO_PAGE} — type a Requirement to narrow` : undefined}
                        onSelect={(p) => {
                          rememberPrio(p);
                          setDebitPrioId(p.id);
                        }}
                      />
                    </div>
                    <div className={styles.field}>
                      <Label weight="semibold">Requirement Funding</Label>
                      <ListDropdown
                        placeholder={debitPrioId ? "Select the RF to move funds FROM" : "Pick a debiting Prioritization first"}
                        disabled={!debitPrioId}
                        options={debitRfs}
                        selected={debitRfs.find((o) => o.id === debitRfId) ?? null}
                        onSelect={(o) => setDebitRfId(o.id)}
                      />
                    </div>
                  </div>

                  {/* CREDIT */}
                  <div className={`${styles.side} ${styles.sideCredit}`}>
                    <Text className={styles.sideTitle}>CREDIT</Text>
                    <div className={styles.field}>
                      <Label weight="semibold">Requirement</Label>
                      <Input
                        placeholder="Type part of the Requirement name"
                        value={creditReqText}
                        onChange={(_, d) => setCreditReqText(d.value)}
                      />
                    </div>
                    <div className={styles.field}>
                      <Label weight="semibold">Prioritization</Label>
                      <ListDropdown
                        placeholder={
                          debitPrioId ? "Select the Prioritization to move funds TO" : "Pick a debiting Prioritization first"
                        }
                        disabled={!debitPrioId}
                        busy={creditSearching}
                        options={creditResults}
                        selected={creditPrio}
                        optionLabel={(p) => p.name + (p.fundingMode === FUNDING_MODE_ITEMIZED ? "  (Itemized)" : "")}
                        hint={creditCapped ? `Showing the first ${PRIO_PAGE} — type a Requirement to narrow` : undefined}
                        onSelect={(p) => {
                          rememberPrio(p);
                          setCreditPrioId(p.id);
                        }}
                      />
                    </div>
                    <div className={styles.field}>
                      <Label weight="semibold">Requirement Funding</Label>
                      <ListDropdown
                        placeholder={creditPrioId ? "Select the receiving RF" : "Pick a crediting Prioritization first"}
                        disabled={!creditPrioId}
                        options={creditRfs}
                        selected={creditRfs.find((o) => o.id === creditRfId) ?? null}
                        onSelect={(o) => setCreditRfId(o.id)}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <Divider />

            {/* PF junction (the debit RF's funding on the debit Prioritization) */}
            <div className={styles.section}>
              <Text className={styles.heading}>
                Prioritization Funding to move {debitPrio ? `from ${debitPrio.name}` : ""}
              </Text>
              {!debitPrioId && <Text>Select a debiting Prioritization to list its funding.</Text>}
              {debitPrioId && pfRows.length === 0 && <Text>No active funded Prioritization Funding on this Prioritization.</Text>}
              {debitPrioId && pfRows.length > 0 && !debitRfId && <Text>Select the debit Requirement Funding.</Text>}
              {debitPfRows.length > 0 && (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Requirement Funding</th>
                      <th className={styles.th}>Funded</th>
                      <th className={styles.th}>Move amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debitPfRows.map((r) => (
                      <tr key={r.id}>
                        <td className={styles.td}>{r.rfName}</td>
                        <td className={styles.td}>{money(r.funded)}</td>
                        <td className={styles.td}>
                          <Input
                            className={styles.amtInput}
                            type="number"
                            value={r.move}
                            onChange={(_, d) =>
                              setPfRows((rows) => rows.map((x) => (x.id === r.id ? { ...x, move: d.value } : x)))
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {overMove && (
                <MessageBar intent="error">
                  <MessageBarBody>A move amount exceeds the funding available on that junction.</MessageBarBody>
                </MessageBar>
              )}
              <Text>
                Total to realign: <b>{money(moveTotal)}</b>
              </Text>
            </div>

            {/* Detail reduction grid (Itemized debit only) */}
            {needReductions && (
              <>
                <Divider />
                <div className={styles.section}>
                  <Text className={styles.heading}>Itemized Detail reductions</Text>
                  <Text>
                    This Prioritization is Itemized. Reduce Itemized Details by a total equal to the realignment so the
                    per-detail funding stays in sync with the junctions.
                  </Text>
                  {detailRows.length === 0 && <Text>No active funded Itemized Details found.</Text>}
                  {detailRows.length > 0 && (
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.th}></th>
                          {detailHead}
                          <th className={styles.th}>Funded</th>
                          <th className={styles.th}>Reduce by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailRows.map((r) => (
                          <tr key={r.id}>
                            <td className={styles.td}>
                              <Checkbox
                                checked={r.selected}
                                onChange={(_, d) =>
                                  setDetailRows((rows) =>
                                    rows.map((x) =>
                                      x.id === r.id
                                        ? { ...x, selected: !!d.checked, reduce: d.checked ? x.reduce : "" }
                                        : x
                                    )
                                  )
                                }
                              />
                            </td>
                            {detailCells(r)}
                            <td className={styles.td}>{money(r.funded)}</td>
                            <td className={styles.td}>
                              <Input
                                className={styles.amtInput}
                                type="number"
                                disabled={!r.selected}
                                value={r.reduce}
                                onChange={(_, d) =>
                                  setDetailRows((rows) =>
                                    rows.map((x) => (x.id === r.id ? { ...x, reduce: d.value } : x))
                                  )
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {overReduce && (
                    <MessageBar intent="error">
                      <MessageBarBody>A reduction exceeds the funding on that Itemized Detail.</MessageBarBody>
                    </MessageBar>
                  )}
                  <div className={styles.balanceRow}>
                    <Text>
                      Reduced <b>{money(reduceTotal)}</b> of <b>{money(moveTotal)}</b>
                    </Text>
                    {balanced ? (
                      <Badge color="success" appearance="tint">
                        Balanced
                      </Badge>
                    ) : (
                      <Badge color="warning" appearance="tint">
                        {remaining > 0 ? `${money(remaining)} left to reduce` : `${money(-remaining)} over`}
                      </Badge>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Detail increase grid (Itemized credit only) */}
            {needIncreases && (
              <>
                <Divider />
                <div className={styles.section}>
                  <Text className={styles.heading}>Itemized Detail increases (credit side)</Text>
                  <Text>
                    The crediting Prioritization is Itemized. Increase Itemized Details on it by a total equal to the
                    realignment so its per-detail funding matches the junction it receives.
                  </Text>
                  {creditDetailRows.length === 0 && <Text>No active Itemized Details found on the crediting Prioritization.</Text>}
                  {creditDetailRows.length > 0 && (
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th className={styles.th}></th>
                          {detailHead}
                          <th className={styles.th}>Funded</th>
                          <th className={styles.th}>Increase by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creditDetailRows.map((r) => (
                          <tr key={r.id}>
                            <td className={styles.td}>
                              <Checkbox
                                checked={r.selected}
                                onChange={(_, d) =>
                                  setCreditDetailRows((rows) =>
                                    rows.map((x) =>
                                      x.id === r.id
                                        ? { ...x, selected: !!d.checked, reduce: d.checked ? x.reduce : "" }
                                        : x
                                    )
                                  )
                                }
                              />
                            </td>
                            {detailCells(r)}
                            <td className={styles.td}>{money(r.funded)}</td>
                            <td className={styles.td}>
                              <Input
                                className={styles.amtInput}
                                type="number"
                                disabled={!r.selected}
                                value={r.reduce}
                                onChange={(_, d) =>
                                  setCreditDetailRows((rows) =>
                                    rows.map((x) => (x.id === r.id ? { ...x, reduce: d.value } : x))
                                  )
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className={styles.balanceRow}>
                    <Text>
                      Increased <b>{money(creditRaiseTotal)}</b> of <b>{money(moveTotal)}</b>
                    </Text>
                    {creditBalanced ? (
                      <Badge color="success" appearance="tint">
                        Balanced
                      </Badge>
                    ) : (
                      <Badge color="warning" appearance="tint">
                        {creditRemaining > 0 ? `${money(creditRemaining)} left to increase` : `${money(-creditRemaining)} over`}
                      </Badge>
                    )}
                  </div>
                </div>
              </>
            )}

            <Divider />

            <div className={styles.footer}>
              <Button appearance="primary" disabled={!canSave || saving} onClick={() => void save()}>
                {saving ? "Saving..." : "Save realignment items"}
              </Button>
              {saving && <Spinner size="tiny" />}
              {saveMsg && (
                <MessageBar intent="success">
                  <MessageBarBody>{saveMsg}</MessageBarBody>
                </MessageBar>
              )}
              {!balanced && needReductions && !saving && (
                <Text>Reductions must equal the realignment total before saving.</Text>
              )}
              {!creditBalanced && needIncreases && !saving && (
                <Text>Credit-side increases must equal the realignment total before saving.</Text>
              )}
            </div>
          </>
        )}
      </div>
    </FluentProvider>
  );
};
