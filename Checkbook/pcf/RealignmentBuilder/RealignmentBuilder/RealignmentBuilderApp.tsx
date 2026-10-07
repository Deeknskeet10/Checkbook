import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  shorthands,
  tokens,
  Badge,
  Button,
  Checkbox,
  Combobox,
  Divider,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
} from "@fluentui/react-components";

type WebApi = ComponentFramework.WebApi;

export interface RealignmentBuilderProps {
  webAPI: WebApi;
  recordId?: string;
}

// ---- entities / fields ----------------------------------------------------
const REALIGNMENT = "book_realignments";
const REALIGNMENT_ITEM = "book_realignmentitem";
const DETAIL_REDUCTION = "book_realignmentdetailreduction";
const DETAIL_INCREASE = "book_realignmentdetailincrease";
const PRIORITIZATION = "book_prioritization";
const PRIO_FUNDING = "book_prioritizationfunding";
const REQ_FUNDING = "book_requirementfunding";
const ITEMIZED_DETAILS = "book_itemizeddetails";

// Entity-SET (collection) names for @odata.bind paths. These are NOT uniformly
// logical-name + "s" (book_realignments -> book_realignmentses,
// book_itemizeddetails -> book_itemizeddetailses), so keep them explicit.
const SET = {
  realignment: "book_realignmentses",
  prio: "book_prioritizations",
  pf: "book_prioritizationfundings",
  rf: "book_requirementfundings",
  detail: "book_itemizeddetailses",
};

const FV = "@OData.Community.Display.V1.FormattedValue";
const ENTRY_MODE_STATE = 0;
const FUNDING_MODE_ITEMIZED = 1;
const STATECODE_ACTIVE = 0;
const EPS = 0.005;

function num(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  return 0;
}
function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function cleanId(v: unknown): string {
  return typeof v === "string" ? v.replace(/[{}]/g, "").toLowerCase() : "";
}

interface PrioOpt {
  id: string;
  name: string;
  requirementId: string | null;
  fiscalYear: number | null;
  fundingMode: number | null;
}
interface PfRow {
  id: string;
  rfId: string;
  rfName: string;
  funded: number;
  selected: boolean;
  move: string;
}
interface RfOpt {
  id: string;
  name: string;
}
interface DetailRow {
  id: string;
  name: string;
  funded: number;
  selected: boolean;
  reduce: string;
}

const useStyles = makeStyles({
  root: {
    ...shorthands.padding("12px"),
    display: "flex",
    flexDirection: "column",
    rowGap: "14px",
    maxWidth: "920px",
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
});

export const RealignmentBuilderApp: React.FC<RealignmentBuilderProps> = ({ webAPI, recordId }) => {
  const styles = useStyles();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const [isActive, setIsActive] = React.useState(true);
  const [fiscalYear, setFiscalYear] = React.useState<number | null>(null);

  const [prios, setPrios] = React.useState<PrioOpt[]>([]);
  const [debitPrioId, setDebitPrioId] = React.useState<string>("");
  const [creditPrioId, setCreditPrioId] = React.useState<string>("");

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
          "?$select=statecode,book_realignmententrymode,book_fiscalyear,book_newamount," +
            "_book_debitedprioritization_value,_book_creditedprioritization_value"
        );
        if (cancelled) return;
        const active = num(r.statecode) === STATECODE_ACTIVE;
        const fy = r.book_fiscalyear == null ? null : num(r.book_fiscalyear);
        setIsActive(active);
        setFiscalYear(fy);
        setDebitPrioId(cleanId(r._book_debitedprioritization_value));
        setCreditPrioId(cleanId(r._book_creditedprioritization_value));

        const fyFilter = fy == null ? "" : ` and book_newfiscalyear eq ${fy}`;
        const res = await webAPI.retrieveMultipleRecords(
          PRIORITIZATION,
          "?$select=book_name,_book_requirement_value,book_newfiscalyear,book_fundingmode" +
            `&$filter=statecode eq ${STATECODE_ACTIVE}${fyFilter}` +
            "&$orderby=book_name asc&$top=500"
        );
        if (cancelled) return;
        setPrios(
          res.entities.map((e) => ({
            id: cleanId(e.book_prioritizationid),
            name: (e.book_name as string) ?? "(unnamed)",
            requirementId: e._book_requirement_value ? cleanId(e._book_requirement_value) : null,
            fiscalYear: e.book_newfiscalyear == null ? null : num(e.book_newfiscalyear),
            fundingMode: e.book_fundingmode == null ? null : num(e.book_fundingmode),
          }))
        );
      } catch {
        if (!cancelled) setError("Could not load the Realignment or Prioritizations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, recordId, reloadKey]);

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
        setPfRows(
          pfRes.entities
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
                selected: false,
                move: "",
              } as PfRow;
            })
            .filter((r) => r.funded > 0)
        );

        const idRes = await webAPI.retrieveMultipleRecords(
          ITEMIZED_DETAILS,
          `?$select=book_name,book_fundedamount` +
            `&$filter=_book_prioritization_value eq ${debitPrioId} and statecode eq ${STATECODE_ACTIVE}` +
            "&$orderby=book_name asc"
        );
        if (cancelled) return;
        setDetailRows(
          idRes.entities
            .map((e) => ({
              id: cleanId(e.book_itemizeddetailsid),
              name: (e.book_name as string) ?? "(detail)",
              funded: num(e.book_fundedamount),
              selected: false,
              reduce: "",
            }))
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
          `?$select=book_name,book_fundedamount` +
            `&$filter=_book_prioritization_value eq ${creditPrioId} and statecode eq ${STATECODE_ACTIVE}` +
            "&$orderby=book_name asc"
        );
        if (cancelled) return;
        setCreditDetailRows(
          res.entities.map((e) => ({
            id: cleanId(e.book_itemizeddetailsid),
            name: (e.book_name as string) ?? "(detail)",
            funded: num(e.book_fundedamount),
            selected: false,
            reduce: "",
          }))
        );
      } catch {
        if (!cancelled) setError("Could not load the crediting Prioritization's details.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, creditPrioId, creditIsItemized, reloadKey]);

  // ---- derived totals ------------------------------------------------------
  const selectedPf = pfRows.filter((r) => r.selected);
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
      // 1) parent: entry mode + debit/credit Prio + legacy amount (for the flow viz).
      await webAPI.updateRecord(REALIGNMENT, recordId, {
        book_realignmententrymode: ENTRY_MODE_STATE,
        book_newamount: moveTotal,
        [`book_DebitedPrioritization@odata.bind`]: `/${SET.prio}(${debitPrioId})`,
        [`book_CreditedPrioritization@odata.bind`]: `/${SET.prio}(${creditPrioId})`,
      });

      // 2) rebuild: wipe existing active items + reductions + increases.
      const [oldItems, oldReds, oldIncs] = await Promise.all([
        webAPI.retrieveMultipleRecords(
          REALIGNMENT_ITEM,
          `?$select=book_realignmentitemid&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`
        ),
        webAPI.retrieveMultipleRecords(
          DETAIL_REDUCTION,
          `?$select=book_realignmentdetailreductionid&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`
        ),
        webAPI.retrieveMultipleRecords(
          DETAIL_INCREASE,
          `?$select=book_realignmentdetailincreaseid&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`
        ),
      ]);
      for (const e of oldItems.entities)
        await webAPI.deleteRecord(REALIGNMENT_ITEM, e.book_realignmentitemid as string);
      for (const e of oldReds.entities)
        await webAPI.deleteRecord(DETAIL_REDUCTION, e.book_realignmentdetailreductionid as string);
      for (const e of oldIncs.entities)
        await webAPI.deleteRecord(DETAIL_INCREASE, e.book_realignmentdetailincreaseid as string);

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
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not save the realignment items.");
    } finally {
      setSaving(false);
    }
  };

  // ---- render --------------------------------------------------------------
  if (!recordId) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className={styles.root}>
          <MessageBar intent="info">
            <MessageBarBody>Save the Realignment record first, then build its items here.</MessageBarBody>
          </MessageBar>
        </div>
      </FluentProvider>
    );
  }

  return (
    <FluentProvider theme={webLightTheme}>
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

        {!loading && isActive && (
          <>
            {/* Prioritization pickers */}
            <div className={styles.pickers}>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Debiting Prioritization</Text>
                <Combobox
                  placeholder="Select the Prioritization to move funds FROM"
                  selectedOptions={debitPrioId ? [debitPrioId] : []}
                  value={debitPrio?.name ?? ""}
                  onOptionSelect={(_, d) => {
                    setDebitPrioId(d.optionValue ?? "");
                  }}
                >
                  {prios.map((p) => (
                    <Option key={p.id} value={p.id} text={p.name}>
                      {p.name}
                      {p.fundingMode === FUNDING_MODE_ITEMIZED ? "  (Itemized)" : ""}
                    </Option>
                  ))}
                </Combobox>
              </div>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Crediting Prioritization</Text>
                <Combobox
                  placeholder="Select the Prioritization to move funds TO"
                  selectedOptions={creditPrioId ? [creditPrioId] : []}
                  value={creditPrio?.name ?? ""}
                  onOptionSelect={(_, d) => {
                    setCreditPrioId(d.optionValue ?? "");
                  }}
                >
                  {prios
                    .filter((p) => p.id !== debitPrioId)
                    .map((p) => (
                      <Option key={p.id} value={p.id} text={p.name}>
                        {p.name}
                      </Option>
                    ))}
                </Combobox>
              </div>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Credit Requirement Funding</Text>
                <Combobox
                  placeholder={creditPrioId ? "Select the receiving RF" : "Pick a crediting Prioritization first"}
                  disabled={!creditPrioId}
                  selectedOptions={creditRfId ? [creditRfId] : []}
                  value={creditRfs.find((o) => o.id === creditRfId)?.name ?? ""}
                  onOptionSelect={(_, d) => setCreditRfId(d.optionValue ?? "")}
                >
                  {creditRfs.map((o) => (
                    <Option key={o.id} value={o.id} text={o.name}>
                      {o.name}
                    </Option>
                  ))}
                </Combobox>
              </div>
            </div>

            <Divider />

            {/* PF junction subgrid */}
            <div className={styles.section}>
              <Text className={styles.heading}>
                Prioritization Funding to move {debitPrio ? `from ${debitPrio.name}` : ""}
              </Text>
              {!debitPrioId && <Text>Select a debiting Prioritization to list its funding.</Text>}
              {debitPrioId && pfRows.length === 0 && <Text>No active funded Prioritization Funding on this Prioritization.</Text>}
              {pfRows.length > 0 && (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}></th>
                      <th className={styles.th}>Requirement Funding</th>
                      <th className={styles.th}>Funded</th>
                      <th className={styles.th}>Move amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pfRows.map((r) => (
                      <tr key={r.id}>
                        <td className={styles.td}>
                          <Checkbox
                            checked={r.selected}
                            onChange={(_, d) =>
                              setPfRows((rows) =>
                                rows.map((x) =>
                                  x.id === r.id
                                    ? { ...x, selected: !!d.checked, move: d.checked ? x.move : "" }
                                    : x
                                )
                              )
                            }
                          />
                        </td>
                        <td className={styles.td}>{r.rfName}</td>
                        <td className={styles.td}>{money(r.funded)}</td>
                        <td className={styles.td}>
                          <Input
                            className={styles.amtInput}
                            type="number"
                            disabled={!r.selected}
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
                          <th className={styles.th}>Itemized Detail</th>
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
                            <td className={styles.td}>{r.name}</td>
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
                          <th className={styles.th}>Itemized Detail</th>
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
                            <td className={styles.td}>{r.name}</td>
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
