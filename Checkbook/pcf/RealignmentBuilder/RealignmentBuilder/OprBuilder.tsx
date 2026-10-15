import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
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
import {
  WebApi,
  REALIGNMENT,
  REALIGNMENT_ITEM,
  RDF_REDUCTION,
  RDF_INCREASE,
  PRIORITIZATION,
  PRIO_FUNDING,
  REQ_FUNDING,
  REQ_DETAILS,
  RD_FUNDING,
  SET,
  FV,
  ITEMS_SAVED_EVENT,
  ENTRY_MODE_OPR,
  STATECODE_ACTIVE,
  EPS,
  num,
  money,
  cleanId,
  useStyles,
  wipeRealignmentChildren,
} from "./shared";

/**
 * OPR entry path (FY27 §9.9): one RF -> RF move of TDP. When the debit RF's funding is
 * split across Requirement Details (RDF junctions), the part of the move Withholding
 * cannot cover must be taken out of those junctions; on the credit side the user may
 * push some or all of the landing amount into the credit Requirement's details. The
 * server (RealignmentValidator / RealignmentProcessor) enforces the same rules.
 */
export interface OprBuilderProps {
  webAPI: WebApi;
  recordId: string;
}

interface RfOpt {
  id: string;
  name: string;
  requirementId: string;
  tdp: number;
  funded: number;
  withholding: number;
}

/** One Requirement Detail line: an RDF to reduce (debit) or an RD to fund (credit). */
interface RdLine {
  id: string; // RDF id on the debit side, RD id on the credit side
  item: string;
  tdc: string;
  mdep: string;
  name: string;
  funded: number; // current funded on this RF
  validated: number;
  selected: boolean;
  amount: string;
}

interface SavedOpr {
  debitRfId: string;
  debitRfName: string;
  creditRfId: string;
  creditRfName: string;
  amount: number;
}

const RD_LABELS = "_book_item_value,_book_tdc_value,_book_mdep_value";
const label = (e: Record<string, unknown>, attr: string): string => (e[`_${attr}_value${FV}`] as string) ?? "";

export const OprBuilder: React.FC<OprBuilderProps> = ({ webAPI, recordId }) => {
  const styles = useStyles();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [mode, setMode] = React.useState<"view" | "edit">("edit");

  const [isActive, setIsActive] = React.useState(true);
  const [hasParentPrios, setHasParentPrios] = React.useState(false);
  const [rfs, setRfs] = React.useState<RfOpt[]>([]);

  const [debitRfId, setDebitRfId] = React.useState("");
  const [creditRfId, setCreditRfId] = React.useState("");
  const [amount, setAmount] = React.useState("");

  const [debitPrioFunded, setDebitPrioFunded] = React.useState(false);
  const [debitLines, setDebitLines] = React.useState<RdLine[]>([]);
  const [creditOnPrioPath, setCreditOnPrioPath] = React.useState(false);
  const [creditLines, setCreditLines] = React.useState<RdLine[]>([]);

  const [saved, setSaved] = React.useState<SavedOpr | null>(null);
  const [savedReductions, setSavedReductions] = React.useState<Map<string, number>>(new Map());
  const [savedIncreases, setSavedIncreases] = React.useState<Map<string, number>>(new Map());
  const [savedLineLabels, setSavedLineLabels] = React.useState<Map<string, string>>(new Map());
  // Amounts to pre-fill when the debit/credit lines (re)load after Edit.
  const prefill = React.useRef<{ red: Map<string, number>; inc: Map<string, number> }>({
    red: new Map(),
    inc: new Map(),
  });
  const [prefillKey, setPrefillKey] = React.useState(0);

  const debitRf = rfs.find((r) => r.id === debitRfId) ?? null;
  const creditRf = rfs.find((r) => r.id === creditRfId) ?? null;

  // ---- header + RF candidates ------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const r = await webAPI.retrieveRecord(
          REALIGNMENT,
          recordId,
          "?$select=statecode,book_newfiscalyear,book_fiscalyear," +
            "_book_debitedprioritization_value,_book_creditedprioritization_value"
        );
        if (cancelled) return;
        setIsActive(num(r.statecode) === STATECODE_ACTIVE);
        setHasParentPrios(!!r._book_debitedprioritization_value || !!r._book_creditedprioritization_value);
        const fyRaw = r.book_newfiscalyear ?? r.book_fiscalyear;
        const fyFilter = fyRaw == null ? "" : ` and book_newfiscalyear eq ${num(fyRaw)}`;
        const res = await webAPI.retrieveMultipleRecords(
          REQ_FUNDING,
          "?$select=book_name,book_newtdp,book_newfundedamount,book_newwithholding,_book_requirement_value" +
            `&$filter=statecode eq ${STATECODE_ACTIVE}${fyFilter}&$orderby=book_name asc&$top=500`
        );
        if (cancelled) return;
        setRfs(
          res.entities.map((e) => ({
            id: cleanId(e.book_requirementfundingid),
            name: (e.book_name as string) ?? "(RF)",
            requirementId: cleanId(e._book_requirement_value),
            tdp: num(e.book_newtdp),
            funded: num(e.book_newfundedamount),
            withholding: num(e.book_newwithholding),
          }))
        );

        // Saved OPR rows (items with a debit RF) for the summary + Edit pre-fill.
        const [items, reds, incs] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            REALIGNMENT_ITEM,
            "?$select=book_newamount,_book_debitrequirementfunding_value,_book_creditrequirementfunding_value" +
              `&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              " and _book_debitrequirementfunding_value ne null"
          ),
          webAPI.retrieveMultipleRecords(
            RDF_REDUCTION,
            "?$select=book_newamount,_book_requirementdetailfunding_value" +
              `&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              `&$expand=book_RequirementDetailFunding($select=_book_requirementdetail_value)`
          ),
          webAPI.retrieveMultipleRecords(
            RDF_INCREASE,
            "?$select=book_newamount,_book_requirementdetail_value" +
              `&$filter=_book_realignment_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`
          ),
        ]);
        if (cancelled) return;
        const it = items.entities[0];
        setSaved(
          it
            ? {
                debitRfId: cleanId(it._book_debitrequirementfunding_value),
                debitRfName: (it[`_book_debitrequirementfunding_value${FV}`] as string) ?? "(RF)",
                creditRfId: cleanId(it._book_creditrequirementfunding_value),
                creditRfName: (it[`_book_creditrequirementfunding_value${FV}`] as string) ?? "(RF)",
                amount: num(it.book_newamount),
              }
            : null
        );
        const labels = new Map<string, string>();
        const red = new Map<string, number>();
        for (const e of reds.entities) {
          const id = cleanId(e._book_requirementdetailfunding_value);
          red.set(id, num(e.book_newamount));
          const rdf = e.book_RequirementDetailFunding as Record<string, unknown> | undefined;
          labels.set(id, (rdf?.[`_book_requirementdetail_value${FV}`] as string) ?? "(detail)");
        }
        const inc = new Map<string, number>();
        for (const e of incs.entities) {
          const id = cleanId(e._book_requirementdetail_value);
          inc.set(id, num(e.book_newamount));
          labels.set(id, (e[`_book_requirementdetail_value${FV}`] as string) ?? "(detail)");
        }
        setSavedReductions(red);
        setSavedIncreases(inc);
        setSavedLineLabels(labels);
        if (it) setMode("view");
      } catch {
        if (!cancelled) setError("Could not load the Realignment or Requirement Fundings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, recordId, reloadKey]);

  // ---- debit RF: is it Prioritization-funded? its RDF junctions --------------
  React.useEffect(() => {
    if (!debitRfId) {
      setDebitLines([]);
      setDebitPrioFunded(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [pf, prio, rdf] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            PRIO_FUNDING,
            `?$select=book_fundedamount&$filter=_book_requirementfunding_value eq ${debitRfId}` +
              ` and statecode eq ${STATECODE_ACTIVE} and book_fundedamount gt 0&$top=1`
          ),
          webAPI.retrieveMultipleRecords(
            PRIORITIZATION,
            `?$select=book_name&$filter=_book_requirementfunding_value eq ${debitRfId} and statecode eq ${STATECODE_ACTIVE}&$top=1`
          ),
          webAPI.retrieveMultipleRecords(
            RD_FUNDING,
            `?$select=book_fundedamount,book_validatedamount` +
              `&$filter=_book_requirementfunding_value eq ${debitRfId} and statecode eq ${STATECODE_ACTIVE}` +
              `&$expand=book_RequirementDetail($select=book_name,${RD_LABELS})`
          ),
        ]);
        if (cancelled) return;
        setDebitPrioFunded(pf.entities.length > 0 || prio.entities.length > 0);
        const red = prefill.current.red;
        setDebitLines(
          rdf.entities
            .map((e) => {
              const rd = (e.book_RequirementDetail as Record<string, unknown> | undefined) ?? {};
              const id = cleanId(e.book_requirementdetailfundingid);
              return {
                id,
                item: label(rd, "book_item"),
                tdc: label(rd, "book_tdc"),
                mdep: label(rd, "book_mdep"),
                name: (rd.book_name as string) ?? "(detail)",
                funded: num(e.book_fundedamount),
                validated: num(e.book_validatedamount),
                selected: red.has(id),
                amount: red.has(id) ? String(red.get(id)) : "",
              };
            })
            .filter((l) => l.funded > 0)
        );
      } catch {
        if (!cancelled) setError("Could not load the debit Requirement Funding's details.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, debitRfId, reloadKey, prefillKey]);

  // ---- credit RF: direct-funded Requirement? its Requirement Details ---------
  React.useEffect(() => {
    const reqId = creditRf?.requirementId ?? "";
    if (!creditRfId || !reqId) {
      setCreditLines([]);
      setCreditOnPrioPath(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [prio, rds, rdf] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            PRIORITIZATION,
            `?$select=book_name&$filter=_book_requirement_value eq ${reqId} and statecode eq ${STATECODE_ACTIVE}&$top=1`
          ),
          webAPI.retrieveMultipleRecords(
            REQ_DETAILS,
            `?$select=book_name,book_validatedamount,${RD_LABELS}` +
              `&$filter=_book_requirement_value eq ${reqId} and statecode eq ${STATECODE_ACTIVE}&$orderby=book_name asc`
          ),
          webAPI.retrieveMultipleRecords(
            RD_FUNDING,
            `?$select=book_fundedamount,_book_requirementdetail_value` +
              `&$filter=_book_requirementfunding_value eq ${creditRfId} and statecode eq ${STATECODE_ACTIVE}`
          ),
        ]);
        if (cancelled) return;
        // Requirement Details can only be funded directly when the Requirement is not on
        // the Prioritization path (RequirementDetailFundingGuard enforces Prio XOR RD).
        const onPrio = prio.entities.length > 0;
        setCreditOnPrioPath(onPrio);
        const fundedByRd = new Map<string, number>();
        for (const e of rdf.entities) fundedByRd.set(cleanId(e._book_requirementdetail_value), num(e.book_fundedamount));
        const inc = prefill.current.inc;
        setCreditLines(
          onPrio
            ? []
            : rds.entities.map((e) => {
                const id = cleanId(e.book_requirementdetailsid);
                return {
                  id,
                  item: label(e, "book_item"),
                  tdc: label(e, "book_tdc"),
                  mdep: label(e, "book_mdep"),
                  name: (e.book_name as string) ?? "(detail)",
                  funded: fundedByRd.get(id) ?? 0,
                  validated: num(e.book_validatedamount),
                  selected: inc.has(id),
                  amount: inc.has(id) ? String(inc.get(id)) : "",
                };
              })
        );
      } catch {
        if (!cancelled) setError("Could not load the credit Requirement's details.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, creditRfId, creditRf?.requirementId, reloadKey, prefillKey]);

  // ---- derived ---------------------------------------------------------------
  const amt = num(amount);
  const withholding = debitRf?.withholding ?? 0;
  const hasRdf = debitLines.length > 0;
  // What the debit RF can give up: Withholding always; Funded too unless it belongs to
  // Prioritizations (those move with a State realignment).
  const available = debitRf ? (debitPrioFunded ? withholding : withholding + debitRf.funded) : 0;
  const overAvailable = amt > available + EPS;
  const requiredReduction = hasRdf ? Math.max(0, amt - withholding) : 0;
  const reduceTotal = debitLines.filter((l) => l.selected).reduce((s, l) => s + num(l.amount), 0);
  const overReduceLine = debitLines.some((l) => l.selected && num(l.amount) > l.funded + EPS);
  const reduceRemaining = requiredReduction - reduceTotal;
  const debitBalanced = Math.abs(reduceRemaining) < EPS;
  const increaseTotal = creditLines.filter((l) => l.selected).reduce((s, l) => s + num(l.amount), 0);
  const overIncrease = increaseTotal > amt + EPS;

  const canSave =
    isActive &&
    !!debitRfId &&
    !!creditRfId &&
    debitRfId !== creditRfId &&
    amt > EPS &&
    !overAvailable &&
    !overReduceLine &&
    debitBalanced &&
    !overIncrease;

  const setLine = (
    setter: React.Dispatch<React.SetStateAction<RdLine[]>>,
    id: string,
    patch: Partial<RdLine>
  ): void => setter((rows) => rows.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // ---- edit: reopen pre-filled from what is saved -----------------------------
  const beginEdit = (): void => {
    setSaveMsg(null);
    prefill.current = { red: savedReductions, inc: savedIncreases };
    if (saved) {
      setDebitRfId(saved.debitRfId);
      setCreditRfId(saved.creditRfId);
      setAmount(String(saved.amount));
    }
    setPrefillKey((k) => k + 1);
    setMode("edit");
  };

  // ---- save --------------------------------------------------------------------
  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    try {
      // 1) parent: OPR mode + amount. Clear Prioritizations left from a State attempt —
      //    the processor reads the parent credit Prioritization when it is set.
      const parent: Record<string, unknown> = {
        book_realignmententrymode: ENTRY_MODE_OPR,
        book_newamount: amt,
      };
      if (hasParentPrios) {
        parent["book_DebitedPrioritization@odata.bind"] = null;
        parent["book_CreditedPrioritization@odata.bind"] = null;
      }
      await webAPI.updateRecord(REALIGNMENT, recordId, parent);

      // 2) rebuild every child row from the grids.
      await wipeRealignmentChildren(webAPI, recordId);

      // 3) the RF -> RF item.
      await webAPI.createRecord(REALIGNMENT_ITEM, {
        book_newamount: amt,
        [`book_Realignment@odata.bind`]: `/${SET.realignment}(${recordId})`,
        [`book_DebitRequirementFunding@odata.bind`]: `/${SET.rf}(${debitRfId})`,
        [`book_CreditRequirementFunding@odata.bind`]: `/${SET.rf}(${creditRfId})`,
      });

      // 4) debit RDF reductions (only when the debit RF is split across details).
      if (requiredReduction > EPS) {
        for (const l of debitLines.filter((x) => x.selected && num(x.amount) > 0)) {
          await webAPI.createRecord(RDF_REDUCTION, {
            book_newamount: num(l.amount),
            [`book_Realignment@odata.bind`]: `/${SET.realignment}(${recordId})`,
            [`book_RequirementDetailFunding@odata.bind`]: `/${SET.rdf}(${l.id})`,
          });
        }
      }

      // 5) optional credit RD increases.
      for (const l of creditLines.filter((x) => x.selected && num(x.amount) > 0)) {
        await webAPI.createRecord(RDF_INCREASE, {
          book_newamount: num(l.amount),
          [`book_Realignment@odata.bind`]: `/${SET.realignment}(${recordId})`,
          [`book_RequirementDetail@odata.bind`]: `/${SET.rd}(${l.id})`,
          [`book_RequirementFunding@odata.bind`]: `/${SET.rf}(${creditRfId})`,
        });
      }

      setSaveMsg("Realignment saved. Submit it for approval from the Approval panel.");
      setMode("view");
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new CustomEvent(ITEMS_SAVED_EVENT, { detail: { id: recordId } }));
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not save the realignment.");
    } finally {
      setSaving(false);
    }
  };

  // ---- render helpers -----------------------------------------------------------
  const lineHead = (
    <>
      <th className={styles.th}>Item</th>
      <th className={styles.th}>TDC</th>
      <th className={styles.th}>MDEP</th>
      <th className={styles.th}>Detail</th>
    </>
  );
  const lineCells = (l: RdLine): React.ReactElement => (
    <>
      <td className={styles.td}>{l.item !== "" ? l.item : "(no item)"}</td>
      <td className={styles.td}>{l.tdc}</td>
      <td className={styles.td}>{l.mdep}</td>
      <td className={styles.td}>{l.name}</td>
    </>
  );
  const rfLabel = (r: RfOpt): string =>
    `${r.name} — TDP ${money(r.tdp)} · Funded ${money(r.funded)} · Withholding ${money(r.withholding)}`;

  const renderSummary = (): React.ReactElement => (
    <div className={styles.section}>
      <div className={styles.balanceRow}>
        <Text className={styles.heading}>Realignment summary (OPR)</Text>
        {isActive ? (
          <Badge color="informative" appearance="tint">Draft — not yet submitted</Badge>
        ) : (
          <Badge color="success" appearance="tint">Processed</Badge>
        )}
      </div>
      {!saved ? (
        <Text>No funding move saved on this realignment yet.</Text>
      ) : (
        <>
          <Text>
            Moving <b>{money(saved.amount)}</b> from <b>{saved.debitRfName}</b> to <b>{saved.creditRfName}</b>.
          </Text>
          {savedReductions.size > 0 && (
            <>
              <Text className={styles.heading}>Debit Requirement Detail reductions</Text>
              <table className={styles.table}>
                <tbody>
                  {[...savedReductions].map(([id, v]) => (
                    <tr key={id}>
                      <td className={styles.td}>{savedLineLabels.get(id)}</td>
                      <td className={styles.td}>−{money(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {savedIncreases.size > 0 && (
            <>
              <Text className={styles.heading}>Credit Requirement Detail increases</Text>
              <table className={styles.table}>
                <tbody>
                  {[...savedIncreases].map(([id, v]) => (
                    <tr key={id}>
                      <td className={styles.td}>{savedLineLabels.get(id)}</td>
                      <td className={styles.td}>+{money(v)}</td>
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
            Edit
          </Button>
          <Text>Submit for approval from the Approval panel above.</Text>
        </div>
      )}
    </div>
  );

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
            <div className={styles.pickers}>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Debit Requirement Funding</Text>
                <Combobox
                  placeholder="Select the RF to move funds FROM"
                  selectedOptions={debitRfId ? [debitRfId] : []}
                  value={debitRf?.name ?? ""}
                  onOptionSelect={(_, d) => setDebitRfId(d.optionValue ?? "")}
                >
                  {rfs
                    .filter((r) => r.tdp > 0)
                    .map((r) => (
                      <Option key={r.id} value={r.id} text={r.name}>
                        {rfLabel(r)}
                      </Option>
                    ))}
                </Combobox>
              </div>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Amount</Text>
                <Input
                  className={styles.amtInput}
                  type="number"
                  value={amount}
                  onChange={(_, d) => setAmount(d.value)}
                />
              </div>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Credit Requirement Funding</Text>
                <Combobox
                  placeholder="Select the RF to move funds TO"
                  selectedOptions={creditRfId ? [creditRfId] : []}
                  value={creditRf?.name ?? ""}
                  onOptionSelect={(_, d) => setCreditRfId(d.optionValue ?? "")}
                >
                  {rfs
                    .filter((r) => r.id !== debitRfId)
                    .map((r) => (
                      <Option key={r.id} value={r.id} text={r.name}>
                        {rfLabel(r)}
                      </Option>
                    ))}
                </Combobox>
              </div>
            </div>

            {debitRf && (
              <Text className={styles.muted}>
                {debitRf.name}: TDP {money(debitRf.tdp)} · Funded {money(debitRf.funded)} · Withholding{" "}
                {money(withholding)}. Available to move: <b>{money(available)}</b>
                {debitPrioFunded ? " (Withholding only — its Funded belongs to Prioritizations)" : ""}.
              </Text>
            )}
            {overAvailable && (
              <MessageBar intent="error">
                <MessageBarBody>
                  The amount exceeds what this Requirement Funding can give up ({money(available)}).
                  {debitPrioFunded ? " Use a State realignment to move Prioritization funding." : ""}
                </MessageBarBody>
              </MessageBar>
            )}

            {/* Debit: RDF reductions */}
            {hasRdf && amt > 0 && (
              <>
                <Divider />
                <div className={styles.section}>
                  <Text className={styles.heading}>Requirement Detail reductions (debit side)</Text>
                  <Text>
                    Withholding covers {money(Math.min(amt, withholding))}. The remaining{" "}
                    <b>{money(requiredReduction)}</b> must come out of the Requirement Details this RF funds.
                  </Text>
                  {requiredReduction > EPS && (
                    <>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}></th>
                            {lineHead}
                            <th className={styles.th}>Funded</th>
                            <th className={styles.th}>Reduce by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {debitLines.map((l) => (
                            <tr key={l.id}>
                              <td className={styles.td}>
                                <Checkbox
                                  checked={l.selected}
                                  onChange={(_, d) =>
                                    setLine(setDebitLines, l.id, {
                                      selected: !!d.checked,
                                      amount: d.checked ? l.amount : "",
                                    })
                                  }
                                />
                              </td>
                              {lineCells(l)}
                              <td className={styles.td}>{money(l.funded)}</td>
                              <td className={styles.td}>
                                <Input
                                  className={styles.amtInput}
                                  type="number"
                                  disabled={!l.selected}
                                  value={l.amount}
                                  onChange={(_, d) => setLine(setDebitLines, l.id, { amount: d.value })}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {overReduceLine && (
                        <MessageBar intent="error">
                          <MessageBarBody>A reduction exceeds the funding on that Requirement Detail.</MessageBarBody>
                        </MessageBar>
                      )}
                      <div className={styles.balanceRow}>
                        <Text>
                          Reduced <b>{money(reduceTotal)}</b> of <b>{money(requiredReduction)}</b>
                        </Text>
                        {debitBalanced ? (
                          <Badge color="success" appearance="tint">Balanced</Badge>
                        ) : (
                          <Badge color="warning" appearance="tint">
                            {reduceRemaining > 0
                              ? `${money(reduceRemaining)} left to reduce`
                              : `${money(-reduceRemaining)} over`}
                          </Badge>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            {/* Credit: optional RD increases */}
            {creditRf && amt > 0 && (
              <>
                <Divider />
                <div className={styles.section}>
                  <Text className={styles.heading}>Requirement Detail increases (credit side, optional)</Text>
                  {creditOnPrioPath || !creditRf.requirementId ? (
                    <Text>
                      {creditRf.name} {creditRf.requirementId ? "is funded through Prioritizations" : "has no Requirement"}
                      ; the {money(amt)} lands on it as Withholding.
                    </Text>
                  ) : creditLines.length === 0 ? (
                    <Text>The credit Requirement has no Requirement Details; the amount lands as Withholding.</Text>
                  ) : (
                    <>
                      <Text>
                        Fund the credit Requirement&apos;s details from the incoming amount. Anything not assigned stays on
                        the RF as Withholding.
                      </Text>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}></th>
                            {lineHead}
                            <th className={styles.th}>Validated</th>
                            <th className={styles.th}>Funded on this RF</th>
                            <th className={styles.th}>Increase by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {creditLines.map((l) => (
                            <tr key={l.id}>
                              <td className={styles.td}>
                                <Checkbox
                                  checked={l.selected}
                                  onChange={(_, d) =>
                                    setLine(setCreditLines, l.id, {
                                      selected: !!d.checked,
                                      amount: d.checked ? l.amount : "",
                                    })
                                  }
                                />
                              </td>
                              {lineCells(l)}
                              <td className={styles.td}>{money(l.validated)}</td>
                              <td className={styles.td}>{money(l.funded)}</td>
                              <td className={styles.td}>
                                <Input
                                  className={styles.amtInput}
                                  type="number"
                                  disabled={!l.selected}
                                  value={l.amount}
                                  onChange={(_, d) => setLine(setCreditLines, l.id, { amount: d.value })}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className={styles.balanceRow}>
                        <Text>
                          Assigned <b>{money(increaseTotal)}</b> of <b>{money(amt)}</b>
                        </Text>
                        {overIncrease ? (
                          <Badge color="danger" appearance="tint">{money(increaseTotal - amt)} over</Badge>
                        ) : (
                          <Badge color="informative" appearance="tint">
                            {money(amt - increaseTotal)} stays as Withholding
                          </Badge>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}

            <Divider />
            <div className={styles.footer}>
              <Button appearance="primary" disabled={!canSave || saving} onClick={() => void save()}>
                {saving ? "Saving..." : "Save realignment"}
              </Button>
              {saving && <Spinner size="tiny" />}
              {!debitBalanced && hasRdf && !saving && (
                <Text>Requirement Detail reductions must equal {money(requiredReduction)} before saving.</Text>
              )}
            </div>
          </>
        )}
      </div>
    </FluentProvider>
  );
};
