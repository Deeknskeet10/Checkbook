import * as React from "react";
import {
  FluentProvider,
  Button,
  Combobox,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  mergeClasses,
} from "@fluentui/react-components";
import {
  WebApi,
  TURNIN_ITEM,
  RDF_REDUCTION,
  PRIORITIZATION,
  PRIO_FUNDING,
  REQ_FUNDING,
  RD_FUNDING,
  OPR,
  SET,
  FV,
  ITEMS_SAVED_EVENT,
  STATECODE_ACTIVE,
  EPS,
  num,
  money,
  moneyShort,
  cleanId,
  containsClause,
  matches,
  useStyles,
  saveTurnInChildren,
  DesiredRow,
} from "./shared";
import {
  lineAmountFields,
  SavedLine,
  readSavedLine,
  SAVED_LINE_SELECT,
  AmountTotals,
  AmountInput,
  FigureCard,
  SHOW_AFP_ALLOT,
} from "./lines";
import {
  checkbookTheme,
  CB,
  EditIcon,
  SaveIcon,
  StatusLabel,
} from "./designSystem";

/**
 * RF-level Turn-In (FY27): an NPM turns in from one Requirement Funding; a Resource
 * Integrator or CSOR approves it in one step (no State, no Budget Execution).
 * Withholding goes first; on a Requirement Funding split across Requirement Details (RDF
 * junctions) whatever Withholding cannot cover must come out of those junctions. An RF
 * funded through Prioritizations can give up only its Withholding. AFP / Allotment are
 * optional per line (blank = sized automatically). TurnInValidator / TurnInFy27Executor enforce and apply the same rules.
 *
 * Finding the RF: a Requirement Funding is named `<Line of Accounting>-<Requirement>`, and an
 * FY27 LOA is `{OPR}-{Fund}-{PG or SAG}-{FundedProgram}-{Category}` (LOANameBuilder). The user
 * narrows the list by OPR (picked) and Fund (typed), then types any part of the name straight
 * into the Requirement Funding box — every filter is a server-side `contains` on book_name.
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
interface OprOpt {
  id: string;
  name: string;
}

// book_requirementfunding.book_requirementtype (formula over book_Requirement.book_type, option set
// book_requirementtype): the user picks which kind of Requirement to turn in from.
const REQ_TYPE_ATTR = "book_requirementtype";
const REQ_TYPE_STATE = 0;
const REQ_TYPE_TARC = 1;
type ReqType = typeof REQ_TYPE_STATE | typeof REQ_TYPE_TARC;
const asReqType = (v: unknown): ReqType | null =>
  v === REQ_TYPE_STATE || v === REQ_TYPE_TARC ? v : null;

const RF_SELECT =
  "book_name,book_newtdp,book_newfundedamount,book_newwithholding";
// Max RFs per search. There are thousands of RFs and Requirement names are unique, so users
// narrow by OPR / Fund and type more of the Requirement name rather than scroll a long list.
const RF_SEARCH_CAP = 25;
const toRfOpt = (e: Record<string, unknown>, id?: string): RfOpt => ({
  id: id ?? cleanId(e.book_requirementfundingid),
  name: (e.book_name as string) ?? "(RF)",
  tdp: num(e.book_newtdp),
  funded: num(e.book_newfundedamount),
  withholding: num(e.book_newwithholding),
});

const RD_LABELS = "_book_item_value,_book_tdc_value,_book_mdep_value";
const label = (e: Record<string, unknown>, attr: string): string =>
  (e[`_${attr}_value${FV}`] as string) ?? "";

/** Debounced copy of `value` (search boxes re-query Dataverse only once typing pauses). */
function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export const RfTurnIn: React.FC<RfTurnInProps> = ({
  webAPI,
  recordId,
  isActive,
  fiscalYear,
}) => {
  const styles = useStyles();

  const [loading, setLoading] = React.useState(true);
  const [rfsLoading, setRfsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [mode, setMode] = React.useState<"view" | "edit">("edit");

  const [rfs, setRfs] = React.useState<RfOpt[]>([]);
  const [rfId, setRfId] = React.useState("");
  // The picked RF, read by id — so it survives any filter that would hide it from `rfs`.
  const [rf, setRf] = React.useState<RfOpt | null>(null);
  const [amount, setAmount] = React.useState("");
  const [afp, setAfp] = React.useState("");
  const [allot, setAllot] = React.useState("");
  const [prioFunded, setPrioFunded] = React.useState(false);
  const [lines, setLines] = React.useState<RdfLine[]>([]);

  // Requirement type the RF lookup is filtered to (TARC by default — this is the NPM path).
  const [reqType, setReqType] = React.useState<ReqType>(REQ_TYPE_TARC);
  const [saved, setSaved] = React.useState<
    (SavedLine & { rfId: string; reqType: ReqType | null }) | null
  >(null);
  const [savedReductions, setSavedReductions] = React.useState<
    { id: string; label: string; amount: number }[]
  >([]);
  const prefill = React.useRef<Map<string, number>>(new Map());
  const [prefillKey, setPrefillKey] = React.useState(0);

  // ---- search filters ---------------------------------------------------------------
  // OPR: picked from a combobox (typing filters its options by "contains").
  const [oprs, setOprs] = React.useState<OprOpt[]>([]);
  const [oprId, setOprId] = React.useState("");
  const [oprInput, setOprInput] = React.useState<string | null>(null); // null = show the picked OPR
  // Fund: free text.
  const [fund, setFund] = React.useState("");
  // Text typed into the Requirement Funding combobox itself (null = show the picked RF's name).
  const [rfInput, setRfInput] = React.useState<string | null>(null);

  const opr = oprs.find((o) => o.id === oprId) ?? null;
  const fundQuery = useDebounced(fund.trim());
  const rfQuery = useDebounced((rfInput ?? "").trim());

  const oprOptions = React.useMemo(
    () => oprs.filter((o) => matches(o.name, oprInput)),
    [oprs, oprInput],
  );
  // Narrow instantly on the client while the debounced server query catches up.
  const rfOptions = React.useMemo(
    () => rfs.filter((r) => matches(r.name, rfInput)),
    [rfs, rfInput],
  );

  // ---- OPRs ---------------------------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          OPR,
          `?$select=book_name&$filter=statecode eq ${STATECODE_ACTIVE}&$orderby=book_name asc&$top=500`,
        );
        if (cancelled) return;
        setOprs(
          res.entities
            .map((e) => ({
              id: cleanId(e.book_oprid),
              name: (e.book_name as string) ?? "",
            }))
            .filter((o) => o.name !== ""),
        );
      } catch {
        if (!cancelled) setError("Could not load the OPRs.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI]);

  // ---- RF candidates: name contains OPR, Fund and the typed text (each only when set) --
  React.useEffect(() => {
    let cancelled = false;
    setRfsLoading(true);
    const nameClauses =
      containsClause("book_name", opr?.name) +
      containsClause("book_name", fundQuery) +
      containsClause("book_name", rfQuery);
    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          REQ_FUNDING,
          `?$select=${RF_SELECT}` +
            `&$filter=statecode eq ${STATECODE_ACTIVE} and book_newfiscalyear eq ${fiscalYear} and book_newtdp gt 0` +
            ` and ${REQ_TYPE_ATTR} eq ${reqType}${nameClauses}` +
            `&$orderby=book_name asc&$top=${RF_SEARCH_CAP}`,
        );
        if (cancelled) return;
        setRfs(res.entities.map((e) => toRfOpt(e)));
      } catch {
        if (!cancelled) setError("Could not load the Requirement Fundings.");
      } finally {
        if (!cancelled) setRfsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, fiscalYear, reloadKey, opr?.name, fundQuery, rfQuery, reqType]);

  // ---- saved lines ------------------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [items, reds] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            TURNIN_ITEM,
            `?$select=${SAVED_LINE_SELECT},_book_requirementfunding_value` +
              `&$filter=_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              " and _book_prioritization_value eq null",
          ),
          webAPI.retrieveMultipleRecords(
            RDF_REDUCTION,
            "?$select=book_newamount,_book_requirementdetailfunding_value" +
              `&$filter=_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              "&$expand=book_RequirementDetailFunding($select=_book_requirementdetail_value)",
          ),
        ]);
        if (cancelled) return;
        const it = items.entities[0];
        const savedRfId = it ? cleanId(it._book_requirementfunding_value) : "";
        // The saved RF's type, so Edit reopens the lookup on the matching TARC / State filter.
        const savedType = savedRfId
          ? await webAPI
              .retrieveRecord(
                REQ_FUNDING,
                savedRfId,
                `?$select=${REQ_TYPE_ATTR}`,
              )
              .then((r) => asReqType(r[REQ_TYPE_ATTR]))
              .catch(() => null)
          : null;
        if (cancelled) return;
        setSaved(
          it
            ? {
                ...readSavedLine(it),
                rfId: savedRfId,
                reqType: savedType,
                label:
                  (it[`_book_requirementfunding_value${FV}`] as string) ??
                  "(RF)",
              }
            : null,
        );
        setSavedReductions(
          reds.entities.map((e) => {
            const rdf = e.book_RequirementDetailFunding as
              Record<string, unknown> | undefined;
            return {
              id: cleanId(e._book_requirementdetailfunding_value),
              label:
                (rdf?.[`_book_requirementdetail_value${FV}`] as string) ??
                "(detail)",
              amount: num(e.book_newamount),
            };
          }),
        );
        if (it) setMode("view");
      } catch {
        if (!cancelled) setError("Could not load the Turn-In's saved line.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, recordId, fiscalYear, reloadKey]);

  // ---- selected RF: its figures, Prioritization-funded?, its RDF junctions -----------
  React.useEffect(() => {
    if (!rfId) {
      setRf(null);
      setLines([]);
      setPrioFunded(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [rec, pf, prio, rdf] = await Promise.all([
          webAPI.retrieveRecord(REQ_FUNDING, rfId, `?$select=${RF_SELECT}`),
          webAPI.retrieveMultipleRecords(
            PRIO_FUNDING,
            `?$select=book_fundedamount&$filter=_book_requirementfunding_value eq ${rfId}` +
              ` and statecode eq ${STATECODE_ACTIVE} and book_fundedamount gt 0&$top=1`,
          ),
          webAPI.retrieveMultipleRecords(
            PRIORITIZATION,
            `?$select=book_name&$filter=_book_requirementfunding_value eq ${rfId} and statecode eq ${STATECODE_ACTIVE}&$top=1`,
          ),
          webAPI.retrieveMultipleRecords(
            RD_FUNDING,
            "?$select=book_fundedamount" +
              `&$filter=_book_requirementfunding_value eq ${rfId} and statecode eq ${STATECODE_ACTIVE}` +
              `&$expand=book_RequirementDetail($select=book_name,${RD_LABELS})`,
          ),
        ]);
        if (cancelled) return;
        setRf(toRfOpt(rec, rfId));
        setPrioFunded(pf.entities.length > 0 || prio.entities.length > 0);
        const fill = prefill.current;
        setLines(
          rdf.entities
            .map((e) => {
              const rd =
                (e.book_RequirementDetail as
                  Record<string, unknown> | undefined) ?? {};
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
            .filter((l) => l.funded > 0),
        );
      } catch {
        if (!cancelled)
          setError("Could not load the Requirement Funding's details.");
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
  const available = rf
    ? prioFunded
      ? withholding
      : withholding + rf.funded
    : 0;
  const overAvailable = amt > available + EPS;
  const requiredReduction = hasRdf ? Math.max(0, amt - withholding) : 0;
  const reduceTotal = lines.reduce((s, l) => s + num(l.reduce), 0);
  const overLine = lines.some(
    (l) => num(l.reduce) > l.funded + EPS || num(l.reduce) < 0,
  );
  const reduceRemaining = requiredReduction - reduceTotal;
  const balanced = Math.abs(reduceRemaining) < EPS;
  const negativeExtra = num(afp) < 0 || num(allot) < 0;
  const canSave =
    isActive &&
    !!rf &&
    amt > EPS &&
    !overAvailable &&
    !overLine &&
    balanced &&
    !negativeExtra;

  const setLine = (id: string, reduce: string): void =>
    setLines((rows) => rows.map((x) => (x.id === id ? { ...x, reduce } : x)));

  const beginEdit = (): void => {
    setSaveMsg(null);
    prefill.current = new Map(savedReductions.map((r) => [r.id, r.amount]));
    if (saved) {
      if (saved.reqType !== null) setReqType(saved.reqType);
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
      setSaveMsg(
        "Turn-In saved. A Resource Integrator or CSOR approves it from the Approval panel.",
      );
      setMode("view");
      setReloadKey((k) => k + 1);
      window.dispatchEvent(
        new CustomEvent(ITEMS_SAVED_EVENT, { detail: { id: recordId } }),
      );
    } catch (e) {
      setError(
        (e as { message?: string })?.message ?? "Could not save the Turn-In.",
      );
    } finally {
      setSaving(false);
    }
  };

  const rfLabel = (r: RfOpt): string =>
    `${r.name} - (TDP ${moneyShort(r.tdp)}) (FND ${moneyShort(r.funded)}) (WHD ${moneyShort(r.withholding)})`;

  const renderSummary = (): React.ReactElement => (
    <div className={styles.section}>
      <div className={styles.balanceRow}>
        <Text className={styles.title}>
          Turn-In Summary (Requirement Funding)
        </Text>
        {isActive ? (
          <StatusLabel kind="neutral">Draft — Not Yet Approved</StatusLabel>
        ) : (
          <StatusLabel kind="success">Processed</StatusLabel>
        )}
        <span className={styles.spacer} />
        {isActive && (
          <Button
            appearance="subtle"
            size="small"
            className={styles.action}
            icon={<EditIcon />}
            onClick={beginEdit}
          >
            Edit
          </Button>
        )}
      </div>
      {!saved ? (
        <Text className={styles.muted}>
          No Turn-In line saved yet. Use Edit to pick a Requirement Funding.
        </Text>
      ) : (
        <>
          <Text>
            Turning in from <b>{saved.label}</b>.
          </Text>
          <AmountTotals
            styles={styles}
            tdp={saved.amount}
            afp={saved.afp}
            allot={saved.allot}
          />
          {SHOW_AFP_ALLOT &&
            (!saved.afpOverridden || !saved.allotOverridden) && (
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
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>Requirement Detail</th>
                    <th className={mergeClasses(styles.th, styles.num)}>
                      Reduced By
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {savedReductions.map((r) => (
                    <tr key={r.id}>
                      <td className={mergeClasses(styles.td, styles.identity)}>
                        {r.label}
                      </td>
                      <td className={mergeClasses(styles.td, styles.num)}>
                        −{money(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {saveMsg && (
        <MessageBar intent="success">
          <MessageBarBody>{saveMsg}</MessageBarBody>
        </MessageBar>
      )}
    </div>
  );

  return (
    <FluentProvider theme={checkbookTheme} style={{ width: "100%" }}>
      <div className={styles.root}>
        {loading && <Spinner size="tiny" label="Loading Turn-In…" />}
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {!loading && !isActive && (
          <MessageBar intent="warning">
            <MessageBarBody>
              This Turn-In has been approved or processed, so its lines are
              locked. Changing them would not reverse the funds already moved —
              submit a new Turn-In or realignment to correct it.
            </MessageBarBody>
          </MessageBar>
        )}

        {!loading && (mode === "view" || !isActive) && renderSummary()}

        {!loading && isActive && mode === "edit" && (
          <>
            {/* Width-capped: requirement type · OPR + Fund · RF picker · RF figures · amount(s). */}
            <div className={styles.narrow}>
              <RadioGroup
                layout="horizontal"
                className={styles.radioGroup}
                aria-label="Requirement type"
                value={String(reqType)}
                onChange={(_, d) => {
                  // A different Requirement type means a different RF list — drop the old pick.
                  setReqType(Number(d.value) as ReqType);
                  setRfId("");
                  setRfInput(null);
                }}
              >
                <Radio
                  value={String(REQ_TYPE_TARC)}
                  label="TARC"
                  className={styles.radio}
                  indicator={{ className: styles.radioRing }}
                />
                <Radio
                  value={String(REQ_TYPE_STATE)}
                  label="State"
                  className={styles.radio}
                  indicator={{ className: styles.radioRing }}
                />
              </RadioGroup>

              <div className={styles.pair}>
                <div className={styles.pickerField} style={{ minWidth: 0 }}>
                  <Text className={styles.fieldLabel}>OPR</Text>
                  <Combobox
                    clearable
                    appearance="filled-lighter"
                    className={styles.editable}
                    listbox={{ className: styles.listbox }}
                    style={{ minWidth: 0 }}
                    placeholder="Any OPR"
                    selectedOptions={oprId ? [oprId] : []}
                    value={oprInput ?? opr?.name ?? ""}
                    onChange={(e) => setOprInput(e.target.value)}
                    onOpenChange={(_, d) => {
                      if (!d.open) setOprInput(null);
                    }}
                    onOptionSelect={(_, d) => {
                      setOprId(d.optionValue ?? "");
                      setOprInput(null);
                    }}
                  >
                    {oprOptions.map((o) => (
                      <Option key={o.id} value={o.id} text={o.name}>
                        {o.name}
                      </Option>
                    ))}
                    {oprOptions.length === 0 && (
                      <Option key="__none" value="" text="" disabled>
                        No matching OPRs
                      </Option>
                    )}
                  </Combobox>
                </div>
                <div className={styles.pickerField} style={{ minWidth: 0 }}>
                  <Text className={styles.fieldLabel}>Fund</Text>
                  <Input
                    appearance="filled-lighter"
                    className={styles.editable}
                    placeholder="Any Fund"
                    value={fund}
                    onChange={(_, d) => setFund(d.value)}
                  />
                </div>
              </div>

              <div
                className={styles.pickerField}
                style={{ width: "100%", minWidth: 0 }}
              >
                <Text className={styles.fieldLabel}>Requirement Funding</Text>
                <Combobox
                  appearance="filled-lighter"
                  className={styles.editable}
                  listbox={{ className: styles.listbox }}
                  style={{ width: "100%", maxWidth: "none", minWidth: 0 }}
                  placeholder="Type any part of the name: LOA, Requirement…"
                  selectedOptions={rfId ? [rfId] : []}
                  value={rfInput ?? rf?.name ?? ""}
                  expandIcon={
                    rfsLoading ? (
                      <Spinner size="extra-tiny" aria-label="Searching" />
                    ) : undefined
                  }
                  onChange={(e) => setRfInput(e.target.value)}
                  onOpenChange={(_, d) => {
                    if (!d.open) setRfInput(null);
                  }}
                  onOptionSelect={(_, d) => {
                    setRfId(d.optionValue ?? "");
                    setRfInput(null);
                  }}
                >
                  {rfOptions.map((r) => (
                    <Option key={r.id} value={r.id} text={r.name}>
                      {rfLabel(r)}
                    </Option>
                  ))}
                  {rfOptions.length === 0 && (
                    <Option key="__none" value="" text="" disabled>
                      {rfsLoading
                        ? "Searching…"
                        : "No Requirement Fundings match these filters"}
                    </Option>
                  )}
                </Combobox>
                {rfs.length >= RF_SEARCH_CAP && (
                  <Text className={styles.muted}>
                    Showing the first {RF_SEARCH_CAP} matches — type more of the
                    Requirement name to narrow it down.
                  </Text>
                )}
              </div>

              {rf && (
                <>
                  <Text className={styles.rfTitle}>{rf.name}</Text>
                  <div className={styles.cards}>
                    <FigureCard title="TDP" value={rf.tdp} />
                    <FigureCard title="Funded" value={rf.funded} />
                    <FigureCard title="Withholding" value={rf.withholding} />
                  </div>
                  {prioFunded && (
                    <div className={styles.note}>
                      (Withholding only — its Funded belongs to Prioritizations)
                    </div>
                  )}
                  <div className={styles.cards}>
                    <FigureCard
                      title="Available to turn in"
                      value={available}
                      tone="available"
                    />
                  </div>
                </>
              )}

              <div className={styles.pickers}>
                <div className={styles.pickerField} style={{ minWidth: 0 }}>
                  <Text className={styles.fieldLabel}>Turn-In Amount</Text>
                  <AmountInput
                    aria-label="Turn-In amount"
                    value={amount}
                    disabled={!rfId}
                    onChange={setAmount}
                  />
                </div>
                {SHOW_AFP_ALLOT && (
                  <div className={styles.pickerField} style={{ minWidth: 0 }}>
                    <Text className={styles.fieldLabel}>AFP (Optional)</Text>
                    <AmountInput
                      aria-label="AFP"
                      value={afp}
                      disabled={!rfId}
                      onChange={setAfp}
                    />
                  </div>
                )}
                {SHOW_AFP_ALLOT && (
                  <div className={styles.pickerField} style={{ minWidth: 0 }}>
                    <Text className={styles.fieldLabel}>
                      Allotment (Optional)
                    </Text>
                    <AmountInput
                      aria-label="Allotment"
                      value={allot}
                      disabled={!rfId}
                      onChange={setAllot}
                    />
                  </div>
                )}
              </div>

              {overAvailable && (
                <MessageBar intent="error">
                  <MessageBarBody>
                    The amount exceeds what this Requirement Funding can give up
                    ({money(available)}).
                    {prioFunded
                      ? " Turn in from the Prioritization instead."
                      : ""}
                  </MessageBarBody>
                </MessageBar>
              )}
            </div>

            {hasRdf && amt > 0 && (
              <div className={styles.section}>
                <Text className={styles.title}>
                  Requirement Detail Reductions
                </Text>
                <Text>
                  Withholding covers {money(Math.min(amt, withholding))}. The
                  remaining <b>{money(requiredReduction)}</b> must come out of
                  the Requirement Details this RF funds.
                </Text>
                {requiredReduction > EPS && (
                  <>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th className={styles.th}>Item</th>
                            <th className={styles.th}>TDC</th>
                            <th className={styles.th}>MDEP</th>
                            <th className={styles.th}>Detail</th>
                            <th className={mergeClasses(styles.th, styles.num)}>
                              Funded
                            </th>
                            <th className={mergeClasses(styles.th, styles.num)}>
                              Reduce By
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((l) => (
                            <tr key={l.id}>
                              <td
                                className={mergeClasses(
                                  styles.td,
                                  styles.identity,
                                )}
                              >
                                {l.item !== "" ? l.item : "(no item)"}
                              </td>
                              <td
                                className={mergeClasses(styles.td, styles.ctx)}
                              >
                                {l.tdc}
                              </td>
                              <td
                                className={mergeClasses(styles.td, styles.ctx)}
                              >
                                {l.mdep}
                              </td>
                              <td
                                className={mergeClasses(styles.td, styles.ctx)}
                              >
                                {l.name}
                              </td>
                              <td
                                className={mergeClasses(styles.td, styles.num)}
                              >
                                {money(l.funded)}
                              </td>
                              <td
                                className={mergeClasses(styles.td, styles.num)}
                              >
                                <AmountInput
                                  aria-label={`Reduce ${l.name} by`}
                                  value={l.reduce}
                                  onChange={(v) => setLine(l.id, v)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {overLine && (
                      <MessageBar intent="error">
                        <MessageBarBody>
                          A reduction exceeds the funding on that Requirement
                          Detail.
                        </MessageBarBody>
                      </MessageBar>
                    )}
                    <div className={styles.balanceRow}>
                      <Text>
                        Reduced <b>{money(reduceTotal)}</b> of{" "}
                        <b>{money(requiredReduction)}</b>
                      </Text>
                      {balanced ? (
                        <StatusLabel kind="success">Balanced</StatusLabel>
                      ) : (
                        <StatusLabel kind="warning">
                          {reduceRemaining > 0
                            ? `${money(reduceRemaining)} left to reduce`
                            : `${money(-reduceRemaining)} over`}
                        </StatusLabel>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            <div className={styles.footer}>
              <Button
                appearance="subtle"
                size="small"
                className={styles.saveButton}
                icon={
                  saving ? (
                    <Spinner size="extra-tiny" aria-label="Saving" />
                  ) : (
                    <SaveIcon color={CB.brand} />
                  )
                }
                disabled={!canSave || saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              {hasRdf && !balanced && !saving && (
                <Text className={styles.muted}>
                  Requirement Detail reductions must equal{" "}
                  {money(requiredReduction)} before saving.
                </Text>
              )}
            </div>
          </>
        )}
      </div>
    </FluentProvider>
  );
};
