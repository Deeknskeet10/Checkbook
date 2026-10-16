import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
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
  TURNIN_ITEM,
  RDF_REDUCTION,
  PRIORITIZATION,
  PRIO_FUNDING,
  REQ_FUNDING,
  RD_FUNDING,
  SET,
  FV,
  ITEMS_SAVED_EVENT,
  STATECODE_ACTIVE,
  EPS,
  num,
  money,
  cleanId,
  useStyles,
  saveTurnInChildren,
  DesiredRow,
} from "./shared";
import { lineAmountFields, SavedLine, readSavedLine, SAVED_LINE_SELECT, AmountTotals } from "./lines";

/**
 * RF-level Turn-In (FY27): an NPM turns in from one Requirement Funding; a Resource
 * Integrator or CSOR approves it in one step (no State, no Budget Execution).
 * Withholding goes first; on a Requirement Funding split across Requirement Details (RDF
 * junctions) whatever Withholding cannot cover must come out of those junctions. An RF
 * funded through Prioritizations can give up only its Withholding. AFP / Allotment are
 * optional per line (blank = sized automatically). TurnInValidator / TurnInFy27Executor enforce and apply the same rules.
 */
export interface RfTurnInProps {
  webAPI: WebApi;
  recordId: string;
  isActive: boolean;
  fiscalYear: number;
}

interface RfOpt {
  id: string;
  name: string;
  tdp: number;
  funded: number;
  withholding: number;
}
interface RdfLine {
  id: string;
  item: string;
  tdc: string;
  mdep: string;
  name: string;
  funded: number;
  reduce: string;
}

const RD_LABELS = "_book_item_value,_book_tdc_value,_book_mdep_value";
const label = (e: Record<string, unknown>, attr: string): string => (e[`_${attr}_value${FV}`] as string) ?? "";

export const RfTurnIn: React.FC<RfTurnInProps> = ({ webAPI, recordId, isActive, fiscalYear }) => {
  const styles = useStyles();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [mode, setMode] = React.useState<"view" | "edit">("edit");

  const [rfs, setRfs] = React.useState<RfOpt[]>([]);
  const [rfId, setRfId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [afp, setAfp] = React.useState("");
  const [allot, setAllot] = React.useState("");
  const [prioFunded, setPrioFunded] = React.useState(false);
  const [lines, setLines] = React.useState<RdfLine[]>([]);

  const [saved, setSaved] = React.useState<(SavedLine & { rfId: string }) | null>(null);
  const [savedReductions, setSavedReductions] = React.useState<{ id: string; label: string; amount: number }[]>([]);
  const prefill = React.useRef<Map<string, number>>(new Map());
  const [prefillKey, setPrefillKey] = React.useState(0);

  const rf = rfs.find((r) => r.id === rfId) ?? null;

  // ---- RF candidates + saved lines --------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [res, items, reds] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            REQ_FUNDING,
            "?$select=book_name,book_newtdp,book_newfundedamount,book_newwithholding" +
              `&$filter=statecode eq ${STATECODE_ACTIVE} and book_newfiscalyear eq ${fiscalYear} and book_newtdp gt 0` +
              "&$orderby=book_name asc&$top=500"
          ),
          webAPI.retrieveMultipleRecords(
            TURNIN_ITEM,
            `?$select=${SAVED_LINE_SELECT},_book_requirementfunding_value` +
              `&$filter=_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              " and _book_prioritization_value eq null"
          ),
          webAPI.retrieveMultipleRecords(
            RDF_REDUCTION,
            "?$select=book_newamount,_book_requirementdetailfunding_value" +
              `&$filter=_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              "&$expand=book_RequirementDetailFunding($select=_book_requirementdetail_value)"
          ),
        ]);
        if (cancelled) return;
        setRfs(
          res.entities.map((e) => ({
            id: cleanId(e.book_requirementfundingid),
            name: (e.book_name as string) ?? "(RF)",
            tdp: num(e.book_newtdp),
            funded: num(e.book_newfundedamount),
            withholding: num(e.book_newwithholding),
          }))
        );
        const it = items.entities[0];
        setSaved(
          it
            ? {
                ...readSavedLine(it),
                rfId: cleanId(it._book_requirementfunding_value),
                label: (it[`_book_requirementfunding_value${FV}`] as string) ?? "(RF)",
              }
            : null
        );
        setSavedReductions(
          reds.entities.map((e) => {
            const rdf = e.book_RequirementDetailFunding as Record<string, unknown> | undefined;
            return {
              id: cleanId(e._book_requirementdetailfunding_value),
              label: (rdf?.[`_book_requirementdetail_value${FV}`] as string) ?? "(detail)",
              amount: num(e.book_newamount),
            };
          })
        );
        if (it) setMode("view");
      } catch {
        if (!cancelled) setError("Could not load the Requirement Fundings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, recordId, fiscalYear, reloadKey]);

  // ---- selected RF: Prioritization-funded? its RDF junctions ------------------------
  React.useEffect(() => {
    if (!rfId) {
      setLines([]);
      setPrioFunded(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [pf, prio, rdf] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            PRIO_FUNDING,
            `?$select=book_fundedamount&$filter=_book_requirementfunding_value eq ${rfId}` +
              ` and statecode eq ${STATECODE_ACTIVE} and book_fundedamount gt 0&$top=1`
          ),
          webAPI.retrieveMultipleRecords(
            PRIORITIZATION,
            `?$select=book_name&$filter=_book_requirementfunding_value eq ${rfId} and statecode eq ${STATECODE_ACTIVE}&$top=1`
          ),
          webAPI.retrieveMultipleRecords(
            RD_FUNDING,
            "?$select=book_fundedamount" +
              `&$filter=_book_requirementfunding_value eq ${rfId} and statecode eq ${STATECODE_ACTIVE}` +
              `&$expand=book_RequirementDetail($select=book_name,${RD_LABELS})`
          ),
        ]);
        if (cancelled) return;
        setPrioFunded(pf.entities.length > 0 || prio.entities.length > 0);
        const fill = prefill.current;
        setLines(
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
                reduce: fill.has(id) ? String(fill.get(id)) : "",
              };
            })
            .filter((l) => l.funded > 0)
        );
      } catch {
        if (!cancelled) setError("Could not load the Requirement Funding's details.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, rfId, reloadKey, prefillKey]);

  // ---- derived ------------------------------------------------------------------------
  const amt = num(amount);
  const withholding = rf?.withholding ?? 0;
  const hasRdf = lines.length > 0;
  const available = rf ? (prioFunded ? withholding : withholding + rf.funded) : 0;
  const overAvailable = amt > available + EPS;
  const requiredReduction = hasRdf ? Math.max(0, amt - withholding) : 0;
  const reduceTotal = lines.reduce((s, l) => s + num(l.reduce), 0);
  const overLine = lines.some((l) => num(l.reduce) > l.funded + EPS || num(l.reduce) < 0);
  const reduceRemaining = requiredReduction - reduceTotal;
  const balanced = Math.abs(reduceRemaining) < EPS;
  const negativeExtra = num(afp) < 0 || num(allot) < 0;
  const canSave = isActive && !!rfId && amt > EPS && !overAvailable && !overLine && balanced && !negativeExtra;

  const setLine = (id: string, reduce: string): void =>
    setLines((rows) => rows.map((x) => (x.id === id ? { ...x, reduce } : x)));

  const beginEdit = (): void => {
    setSaveMsg(null);
    prefill.current = new Map(savedReductions.map((r) => [r.id, r.amount]));
    if (saved) {
      setRfId(saved.rfId);
      setAmount(String(saved.amount));
      setAfp(saved.afpOverridden ? String(saved.afp) : "");
      setAllot(saved.allotOverridden ? String(saved.allot) : "");
    }
    setPrefillKey((k) => k + 1);
    setMode("edit");
  };

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    try {
      const rdfs: DesiredRow[] =
        requiredReduction > EPS
          ? lines
              .filter((x) => num(x.reduce) > 0)
              .map((l) => ({
                key: l.id,
                fields: {
                  book_newamount: num(l.reduce),
                  "book_TurnIn@odata.bind": `/${SET.turnin}(${recordId})`,
                  "book_RequirementDetailFunding@odata.bind": `/${SET.rdf}(${l.id})`,
                },
              }))
          : [];
      await saveTurnInChildren(webAPI, recordId, {
        items: [
          {
            key: `rf:${rfId}`,
            fields: {
              ...lineAmountFields({ amount, afp, allot }),
              "book_Turnin@odata.bind": `/${SET.turnin}(${recordId})`,
              "book_RequirementFunding@odata.bind": `/${SET.rf}(${rfId})`,
            },
          },
        ],
        details: [],
        rdfs,
      });
      setSaveMsg("Turn-In saved. A Resource Integrator or CSOR approves it from the Approval panel.");
      setMode("view");
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new CustomEvent(ITEMS_SAVED_EVENT, { detail: { id: recordId } }));
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not save the Turn-In.");
    } finally {
      setSaving(false);
    }
  };

  const rfLabel = (r: RfOpt): string =>
    `${r.name} — TDP ${money(r.tdp)} · Funded ${money(r.funded)} · Withholding ${money(r.withholding)}`;

  const renderSummary = (): React.ReactElement => (
    <div className={styles.section}>
      <div className={styles.balanceRow}>
        <Text className={styles.heading}>Turn-In summary (Requirement Funding)</Text>
        {isActive ? (
          <Badge color="informative" appearance="tint">Draft — not yet approved</Badge>
        ) : (
          <Badge color="success" appearance="tint">Processed</Badge>
        )}
      </div>
      {!saved ? (
        <Text>No Turn-In line saved yet.</Text>
      ) : (
        <>
          <Text>
            Turning in from <b>{saved.label}</b>.
          </Text>
          <AmountTotals styles={styles} tdp={saved.amount} afp={saved.afp} allot={saved.allot} />
          {(!saved.afpOverridden || !saved.allotOverridden) && (
            <Text className={styles.muted}>
              {!saved.afpOverridden && !saved.allotOverridden
                ? "AFP and Allotment were"
                : !saved.afpOverridden
                  ? "AFP was"
                  : "Allotment was"}{" "}
              sized automatically.
            </Text>
          )}
          {savedReductions.length > 0 && (
            <>
              <Text className={styles.heading}>Requirement Detail reductions</Text>
              <table className={styles.table}>
                <tbody>
                  {savedReductions.map((r) => (
                    <tr key={r.id}>
                      <td className={styles.td}>{r.label}</td>
                      <td className={styles.td}>−{money(r.amount)}</td>
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
            <MessageBarBody>
              This Turn-In has been approved or processed, so its lines are locked. Changing them would not reverse
              the funds already moved — submit a new Turn-In or realignment to correct it.
            </MessageBarBody>
          </MessageBar>
        )}

        {!loading && (mode === "view" || !isActive) && renderSummary()}

        {!loading && isActive && mode === "edit" && (
          <>
            <div className={styles.pickers}>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Requirement Funding</Text>
                <Combobox
                  placeholder="Select the RF to turn funds in from"
                  selectedOptions={rfId ? [rfId] : []}
                  value={rf?.name ?? ""}
                  onOptionSelect={(_, d) => setRfId(d.optionValue ?? "")}
                >
                  {rfs.map((r) => (
                    <Option key={r.id} value={r.id} text={r.name}>
                      {rfLabel(r)}
                    </Option>
                  ))}
                </Combobox>
              </div>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>TDP to turn in</Text>
                <Input
                  className={styles.amtInput}
                  type="number"
                  value={amount}
                  onChange={(_, d) => setAmount(d.value)}
                />
              </div>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>AFP (optional)</Text>
                <Input
                  className={styles.amtInput}
                  type="number"
                  placeholder="auto"
                  value={afp}
                  onChange={(_, d) => setAfp(d.value)}
                />
              </div>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Allotment (optional)</Text>
                <Input
                  className={styles.amtInput}
                  type="number"
                  placeholder="auto"
                  value={allot}
                  onChange={(_, d) => setAllot(d.value)}
                />
              </div>
            </div>

            {rf && (
              <Text className={styles.muted}>
                {rf.name}: TDP {money(rf.tdp)} · Funded {money(rf.funded)} · Withholding {money(withholding)}.
                Available to turn in: <b>{money(available)}</b>
                {prioFunded ? " (Withholding only — its Funded belongs to Prioritizations)" : ""}.
              </Text>
            )}
            {overAvailable && (
              <MessageBar intent="error">
                <MessageBarBody>
                  The amount exceeds what this Requirement Funding can give up ({money(available)}).
                  {prioFunded ? " Turn in from the Prioritization instead." : ""}
                </MessageBarBody>
              </MessageBar>
            )}

            {hasRdf && amt > 0 && (
              <>
                <Divider />
                <div className={styles.section}>
                  <Text className={styles.heading}>Requirement Detail reductions</Text>
                  <Text>
                    Withholding covers {money(Math.min(amt, withholding))}. The remaining{" "}
                    <b>{money(requiredReduction)}</b> must come out of the Requirement Details this RF funds.
                  </Text>
                  {requiredReduction > EPS && (
                    <>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Item</th>
                            <th className={styles.th}>TDC</th>
                            <th className={styles.th}>MDEP</th>
                            <th className={styles.th}>Detail</th>
                            <th className={styles.th}>Funded</th>
                            <th className={styles.th}>Reduce by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((l) => (
                            <tr key={l.id}>
                              <td className={styles.td}>{l.item !== "" ? l.item : "(no item)"}</td>
                              <td className={styles.td}>{l.tdc}</td>
                              <td className={styles.td}>{l.mdep}</td>
                              <td className={styles.td}>{l.name}</td>
                              <td className={styles.td}>{money(l.funded)}</td>
                              <td className={styles.td}>
                                <Input
                                  className={styles.amtInput}
                                  type="number"
                                  value={l.reduce}
                                  onChange={(_, d) => setLine(l.id, d.value)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {overLine && (
                        <MessageBar intent="error">
                          <MessageBarBody>A reduction exceeds the funding on that Requirement Detail.</MessageBarBody>
                        </MessageBar>
                      )}
                      <div className={styles.balanceRow}>
                        <Text>
                          Reduced <b>{money(reduceTotal)}</b> of <b>{money(requiredReduction)}</b>
                        </Text>
                        {balanced ? (
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

            <Divider />
            <div className={styles.footer}>
              <Button appearance="primary" disabled={!canSave || saving} onClick={() => void save()}>
                {saving ? "Saving..." : "Save Turn-In"}
              </Button>
              {saving && <Spinner size="tiny" />}
              {hasRdf && !balanced && !saving && (
                <Text>Requirement Detail reductions must equal {money(requiredReduction)} before saving.</Text>
              )}
            </div>
          </>
        )}
      </div>
    </FluentProvider>
  );
};
