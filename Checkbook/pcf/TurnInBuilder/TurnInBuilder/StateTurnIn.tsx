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
  DETAIL_REDUCTION,
  PRIORITIZATION,
  PRIO_FUNDING,
  ITEMIZED_DETAILS,
  FUND_CENTER,
  SET,
  FV,
  ITEMS_SAVED_EVENT,
  STATECODE_ACTIVE,
  FINAL_APPROVED,
  FUNDING_MODE_ITEMIZED,
  EPS,
  num,
  money,
  cleanId,
  useStyles,
  saveTurnInChildren,
  DesiredRow,
} from "./shared";
import { LineAmounts, lineAmountFields, SavedLine, readSavedLine, SAVED_LINE_SELECT, AmountTotals } from "./lines";

/**
 * State Turn-In (FY27): one or more Prioritizations in the Turn-In's state. For each, the
 * user enters how much TDP to turn in from each Prioritization Funding line (one per
 * Fund/SAG), and optionally the AFP and Allotment to return with it (blank = sized
 * automatically). Itemized Prioritizations must reduce their details by their own total.
 * TurnInValidator / TurnInFy27Executor enforce and apply the same rules.
 */
export interface StateTurnInProps {
  webAPI: WebApi;
  recordId: string;
  isActive: boolean;
  fiscalYear: number;
  fundCenterId: string;
}

interface PrioOpt {
  id: string;
  name: string;
  funded: number;
  fundingMode: number | null;
}
interface PfRow extends LineAmounts {
  id: string;
  rfId: string;
  rfName: string;
  funded: number;
}
interface DetailRow {
  id: string;
  name: string; // autonumber — an identifier, not a description
  item: string;
  tdc: string;
  mdep: string;
  funded: number;
  requested: number;
  reduce: string;
}
interface Block {
  prio: PrioOpt;
  loading: boolean;
  pfRows: PfRow[];
  detailRows: DetailRow[];
}

// Itemized Detail query: the autonumber name plus the Requirement Item's Item / TDC / MDEP.
const DETAIL_SELECT =
  "?$select=book_name,book_fundedamount,book_requestedamount" +
  "&$expand=book_RequirementItem($select=_book_item_value,_book_tdc_value,_book_mdep_value)";

const toDetailRow = (e: Record<string, unknown>, reduce: string): DetailRow => {
  const ri = (e.book_RequirementItem as Record<string, unknown> | null | undefined) ?? {};
  const label = (attr: string): string => (ri[`_${attr}_value${FV}`] as string) ?? "";
  return {
    id: cleanId(e.book_itemizeddetailsid),
    name: (e.book_name as string) ?? "(detail)",
    item: label("book_item"),
    tdc: label("book_tdc"),
    mdep: label("book_mdep"),
    funded: num(e.book_fundedamount),
    requested: num(e.book_requestedamount),
    reduce,
  };
};

const blockTotal = (b: Block): number => b.pfRows.reduce((s, r) => s + num(r.amount), 0);
const blockReduced = (b: Block): number => b.detailRows.reduce((s, r) => s + num(r.reduce), 0);
const isItemized = (b: Block): boolean => b.prio.fundingMode === FUNDING_MODE_ITEMIZED;
const blockOverLine = (b: Block): boolean =>
  b.pfRows.some((r) => num(r.amount) > r.funded + EPS || num(r.amount) < 0 || num(r.afp) < 0 || num(r.allot) < 0);
const blockOverDetail = (b: Block): boolean =>
  b.detailRows.some((r) => num(r.reduce) > r.funded + EPS || num(r.reduce) < 0);
const blockBalanced = (b: Block): boolean => !isItemized(b) || Math.abs(blockTotal(b) - blockReduced(b)) < EPS;

export const StateTurnIn: React.FC<StateTurnInProps> = ({ webAPI, recordId, isActive, fiscalYear, fundCenterId }) => {
  const styles = useStyles();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [mode, setMode] = React.useState<"view" | "edit">("edit");

  const [stateName, setStateName] = React.useState("");
  const [prios, setPrios] = React.useState<PrioOpt[]>([]);
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [picker, setPicker] = React.useState("");

  // Saved rows: the summary, and the amounts Edit pre-fills.
  const [savedLines, setSavedLines] = React.useState<(SavedLine & { prioId: string; prioName: string })[]>([]);
  const [savedReductions, setSavedReductions] = React.useState<{ id: string; label: string; amount: number }[]>([]);
  const prefill = React.useRef<{ pf: Map<string, LineAmounts>; detail: Map<string, number> }>({
    pf: new Map(),
    detail: new Map(),
  });

  // ---- state from the Turn-In's Fund Center, its Prioritizations, saved lines --------
  React.useEffect(() => {
    if (!fundCenterId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const fc = await webAPI.retrieveRecord(FUND_CENTER, fundCenterId, "?$select=_book_state_value");
        const stateId = cleanId(fc._book_state_value);
        if (cancelled) return;
        setStateName((fc[`_book_state_value${FV}`] as string) ?? "");
        const stateFilter = stateId ? ` and _book_state_value eq ${stateId}` : "";
        const [prioRes, items, reds] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            PRIORITIZATION,
            "?$select=book_name,book_newfundedamounttdp,book_fundingmode" +
              `&$filter=statecode eq ${STATECODE_ACTIVE} and book_newfiscalyear eq ${fiscalYear}` +
              ` and book_approvalstatus eq ${FINAL_APPROVED} and book_newfundedamounttdp gt 0${stateFilter}` +
              "&$orderby=book_name asc&$top=500"
          ),
          webAPI.retrieveMultipleRecords(
            TURNIN_ITEM,
            `?$select=${SAVED_LINE_SELECT},_book_prioritizationfunding_value,_book_prioritization_value` +
              `&$filter=_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              " and _book_prioritizationfunding_value ne null" +
              "&$expand=book_PrioritizationFunding($select=_book_requirementfunding_value)"
          ),
          webAPI.retrieveMultipleRecords(
            DETAIL_REDUCTION,
            "?$select=book_newamount,_book_itemizeddetail_value" +
              `&$filter=_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}`
          ),
        ]);
        if (cancelled) return;
        setPrios(
          prioRes.entities.map((e) => ({
            id: cleanId(e.book_prioritizationid),
            name: (e.book_name as string) ?? "(unnamed)",
            funded: num(e.book_newfundedamounttdp),
            fundingMode: e.book_fundingmode == null ? null : num(e.book_fundingmode),
          }))
        );
        setSavedLines(
          items.entities.map((e) => {
            const pf = e.book_PrioritizationFunding as Record<string, unknown> | undefined;
            return {
              ...readSavedLine(e),
              id: cleanId(e._book_prioritizationfunding_value),
              label: (pf?.[`_book_requirementfunding_value${FV}`] as string) ?? "(Fund/SAG)",
              prioId: cleanId(e._book_prioritization_value),
              prioName: (e[`_book_prioritization_value${FV}`] as string) ?? "(Prioritization)",
            };
          })
        );
        setSavedReductions(
          reds.entities.map((e) => ({
            id: cleanId(e._book_itemizeddetail_value),
            label: (e[`_book_itemizeddetail_value${FV}`] as string) ?? "(detail)",
            amount: num(e.book_newamount),
          }))
        );
        if (items.entities.length > 0) setMode("view");
      } catch {
        if (!cancelled) setError("Could not load the Turn-In's Prioritizations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, recordId, fiscalYear, fundCenterId, reloadKey]);

  // ---- add a Prioritization block: load its PF lines (one per Fund/SAG) and details --
  const addPrio = React.useCallback(
    async (p: PrioOpt): Promise<void> => {
      setBlocks((bs) => (bs.some((b) => b.prio.id === p.id) ? bs : [...bs, { prio: p, loading: true, pfRows: [], detailRows: [] }]));
      try {
        const [pfRes, idRes] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            PRIO_FUNDING,
            "?$select=book_fundedamount,_book_requirementfunding_value" +
              `&$filter=_book_prioritization_value eq ${p.id} and statecode eq ${STATECODE_ACTIVE}` +
              "&$expand=book_RequirementFunding($select=book_name)"
          ),
          webAPI.retrieveMultipleRecords(
            ITEMIZED_DETAILS,
            DETAIL_SELECT +
              `&$filter=_book_prioritization_value eq ${p.id} and statecode eq ${STATECODE_ACTIVE}&$orderby=book_name asc`
          ),
        ]);
        const pfFill = prefill.current.pf;
        const dFill = prefill.current.detail;
        const pfRows: PfRow[] = pfRes.entities
          .map((e) => {
            const rf = e.book_RequirementFunding as Record<string, unknown> | undefined;
            const id = cleanId(e.book_prioritizationfundingid);
            const fill = pfFill.get(id);
            return {
              id,
              rfId: cleanId(e._book_requirementfunding_value),
              rfName: (rf?.book_name as string) ?? (e[`_book_requirementfunding_value${FV}`] as string) ?? "(RF)",
              funded: num(e.book_fundedamount),
              amount: fill?.amount ?? "",
              afp: fill?.afp ?? "",
              allot: fill?.allot ?? "",
            };
          })
          .filter((r) => r.funded > 0);
        const detailRows = idRes.entities
          .map((e) => {
            const id = cleanId(e.book_itemizeddetailsid);
            return toDetailRow(e, dFill.has(id) ? String(dFill.get(id)) : "");
          })
          .filter((r) => r.funded > 0);
        setBlocks((bs) => bs.map((b) => (b.prio.id === p.id ? { ...b, loading: false, pfRows, detailRows } : b)));
      } catch {
        setError(`Could not load the funding for ${p.name}.`);
        setBlocks((bs) => bs.filter((b) => b.prio.id !== p.id));
      }
    },
    [webAPI]
  );

  const removePrio = (id: string): void => setBlocks((bs) => bs.filter((b) => b.prio.id !== id));
  const patchPf = (prioId: string, id: string, patch: Partial<LineAmounts>): void =>
    setBlocks((bs) =>
      bs.map((b) =>
        b.prio.id === prioId ? { ...b, pfRows: b.pfRows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : b
      )
    );
  const patchDetail = (prioId: string, id: string, reduce: string): void =>
    setBlocks((bs) =>
      bs.map((b) =>
        b.prio.id === prioId ? { ...b, detailRows: b.detailRows.map((r) => (r.id === id ? { ...r, reduce } : r)) } : b
      )
    );

  // ---- derived ----------------------------------------------------------------------
  const allRows = blocks.flatMap((b) => b.pfRows);
  const total = allRows.reduce((s, r) => s + num(r.amount), 0);
  const canSave =
    isActive &&
    blocks.length > 0 &&
    !blocks.some((b) => b.loading || blockOverLine(b) || blockOverDetail(b) || !blockBalanced(b)) &&
    total > EPS;

  const beginEdit = (): void => {
    setSaveMsg(null);
    prefill.current = {
      pf: new Map(
        savedLines.map((l) => [
          l.id,
          {
            amount: String(l.amount),
            afp: l.afpOverridden ? String(l.afp) : "",
            allot: l.allotOverridden ? String(l.allot) : "",
          },
        ])
      ),
      detail: new Map(savedReductions.map((r) => [r.id, r.amount])),
    };
    setBlocks([]);
    const seen = new Set<string>();
    for (const l of savedLines) {
      if (seen.has(l.prioId)) continue;
      seen.add(l.prioId);
      const p = prios.find((x) => x.id === l.prioId) ?? { id: l.prioId, name: l.prioName, funded: 0, fundingMode: null };
      void addPrio(p);
    }
    setMode("edit");
  };

  // ---- save ---------------------------------------------------------------------------
  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaveMsg(null);
    try {
      const items: DesiredRow[] = [];
      const details: DesiredRow[] = [];
      for (const b of blocks) {
        for (const r of b.pfRows.filter((x) => num(x.amount) > 0)) {
          items.push({
            key: r.id,
            fields: {
              ...lineAmountFields(r),
              "book_Turnin@odata.bind": `/${SET.turnin}(${recordId})`,
              "book_Prioritization@odata.bind": `/${SET.prio}(${b.prio.id})`,
              "book_RequirementFunding@odata.bind": `/${SET.rf}(${r.rfId})`,
              "book_PrioritizationFunding@odata.bind": `/${SET.pf}(${r.id})`,
            },
          });
        }
        if (isItemized(b)) {
          for (const d of b.detailRows.filter((x) => num(x.reduce) > 0)) {
            details.push({
              key: d.id,
              fields: {
                book_newamount: num(d.reduce),
                "book_TurnIn@odata.bind": `/${SET.turnin}(${recordId})`,
                "book_ItemizedDetail@odata.bind": `/${SET.detail}(${d.id})`,
              },
            });
          }
        }
      }
      await saveTurnInChildren(webAPI, recordId, { items, details, rdfs: [] });
      setSaveMsg("Turn-In saved. Submit it for State approval from the Approval panel.");
      setMode("view");
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new CustomEvent(ITEMS_SAVED_EVENT, { detail: { id: recordId } }));
    } catch (e) {
      setError((e as { message?: string })?.message ?? "Could not save the Turn-In.");
    } finally {
      setSaving(false);
    }
  };

  // ---- render -------------------------------------------------------------------------
  const detailLabel = (r: DetailRow): string =>
    [r.item !== "" ? r.item : "(no item)", r.tdc, r.mdep].filter((x) => x !== "").join(" · ");

  const renderSummary = (): React.ReactElement => {
    const groups = new Map<string, typeof savedLines>();
    for (const l of savedLines) groups.set(l.prioName, [...(groups.get(l.prioName) ?? []), l]);
    return (
      <div className={styles.section}>
        <div className={styles.balanceRow}>
          <Text className={styles.heading}>Turn-In summary</Text>
          {isActive ? (
            <Badge color="informative" appearance="tint">Draft — not yet approved</Badge>
          ) : (
            <Badge color="success" appearance="tint">Processed</Badge>
          )}
        </div>
        {savedLines.length === 0 ? (
          <Text>No Turn-In lines saved yet.</Text>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Prioritization</th>
                  <th className={styles.th}>Requirement Funding (Fund/SAG)</th>
                  <th className={styles.th}>TDP</th>
                  <th className={styles.th}>AFP</th>
                  <th className={styles.th}>Allotment</th>
                </tr>
              </thead>
              <tbody>
                {[...groups].flatMap(([prioName, lines]) =>
                  lines.map((l, i) => (
                    <tr key={l.id}>
                      <td className={styles.td}>{i === 0 ? prioName : ""}</td>
                      <td className={styles.td}>{l.label}</td>
                      <td className={styles.td}>{money(l.amount)}</td>
                      <td className={styles.td}>
                        {money(l.afp)}
                        {l.afpOverridden ? "" : " (auto)"}
                      </td>
                      <td className={styles.td}>
                        {money(l.allot)}
                        {l.allotOverridden ? "" : " (auto)"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <AmountTotals
              styles={styles}
              tdp={savedLines.reduce((s, l) => s + l.amount, 0)}
              afp={savedLines.reduce((s, l) => s + l.afp, 0)}
              allot={savedLines.reduce((s, l) => s + l.allot, 0)}
            />
            {savedReductions.length > 0 && (
              <>
                <Text className={styles.heading}>Itemized Detail reductions</Text>
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
  };

  const renderBlock = (b: Block): React.ReactElement => {
    const t = blockTotal(b);
    const reduced = blockReduced(b);
    const remaining = t - reduced;
    return (
      <div key={b.prio.id} className={styles.section}>
        <Divider />
        <div className={styles.balanceRow}>
          <Text className={styles.heading}>{b.prio.name}</Text>
          {isItemized(b) && <Badge appearance="outline">Itemized</Badge>}
          <Button size="small" appearance="subtle" onClick={() => removePrio(b.prio.id)}>
            Remove
          </Button>
        </div>
        {b.loading ? (
          <Spinner size="tiny" label="Loading..." />
        ) : b.pfRows.length === 0 ? (
          <Text>This Prioritization has no funded Requirement Funding lines.</Text>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Requirement Funding (Fund/SAG)</th>
                <th className={styles.th}>Funded</th>
                <th className={styles.th}>TDP to turn in</th>
                <th className={styles.th}>AFP</th>
                <th className={styles.th}>Allotment</th>
              </tr>
            </thead>
            <tbody>
              {b.pfRows.map((r) => (
                <tr key={r.id}>
                  <td className={styles.td}>{r.rfName}</td>
                  <td className={styles.td}>{money(r.funded)}</td>
                  <td className={styles.td}>
                    <Input
                      className={styles.amtInput}
                      type="number"
                      value={r.amount}
                      onChange={(_, d) => patchPf(b.prio.id, r.id, { amount: d.value })}
                    />
                  </td>
                  <td className={styles.td}>
                    <Input
                      className={styles.amtInput}
                      type="number"
                      placeholder="auto"
                      value={r.afp}
                      onChange={(_, d) => patchPf(b.prio.id, r.id, { afp: d.value })}
                    />
                  </td>
                  <td className={styles.td}>
                    <Input
                      className={styles.amtInput}
                      type="number"
                      placeholder="auto"
                      value={r.allot}
                      onChange={(_, d) => patchPf(b.prio.id, r.id, { allot: d.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {blockOverLine(b) && (
          <MessageBar intent="error">
            <MessageBarBody>A line exceeds the funding on that Fund/SAG, or an amount is negative.</MessageBarBody>
          </MessageBar>
        )}

        {isItemized(b) && t > 0 && (
          <>
            <Text>
              Itemized: reduce its details by a total of <b>{money(t)}</b> (Funded and Requested drop together).
            </Text>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Item · TDC · MDEP</th>
                  <th className={styles.th}>Detail #</th>
                  <th className={styles.th}>Funded</th>
                  <th className={styles.th}>Requested</th>
                  <th className={styles.th}>Reduce by</th>
                </tr>
              </thead>
              <tbody>
                {b.detailRows.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.td}>{detailLabel(r)}</td>
                    <td className={styles.td}>{r.name}</td>
                    <td className={styles.td}>{money(r.funded)}</td>
                    <td className={styles.td}>{money(r.requested)}</td>
                    <td className={styles.td}>
                      <Input
                        className={styles.amtInput}
                        type="number"
                        value={r.reduce}
                        onChange={(_, d) => patchDetail(b.prio.id, r.id, d.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {blockOverDetail(b) && (
              <MessageBar intent="error">
                <MessageBarBody>A reduction exceeds the funding on that Itemized Detail.</MessageBarBody>
              </MessageBar>
            )}
            <div className={styles.balanceRow}>
              <Text>
                Reduced <b>{money(reduced)}</b> of <b>{money(t)}</b>
              </Text>
              {blockBalanced(b) ? (
                <Badge color="success" appearance="tint">Balanced</Badge>
              ) : (
                <Badge color="warning" appearance="tint">
                  {remaining > 0 ? `${money(remaining)} left to reduce` : `${money(-remaining)} over`}
                </Badge>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  const available = prios.filter((p) => !blocks.some((b) => b.prio.id === p.id));
  const enteredAfp = allRows.reduce((s, r) => s + num(r.afp), 0);
  const enteredAllot = allRows.reduce((s, r) => s + num(r.allot), 0);

  return (
    <FluentProvider theme={webLightTheme} style={{ width: "100%" }}>
      <div className={styles.root}>
        {loading && <Spinner label="Loading..." />}
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {!loading && !fundCenterId && (
          <MessageBar intent="info">
            <MessageBarBody>Set the Turn-In Fund Center (your state) and save to pick Prioritizations.</MessageBarBody>
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

        {!loading && fundCenterId && (mode === "view" || !isActive) && renderSummary()}

        {!loading && fundCenterId && isActive && mode === "edit" && (
          <>
            <div className={styles.pickers}>
              <div className={styles.pickerField}>
                <Text className={styles.heading}>Add a Prioritization{stateName ? ` (${stateName})` : ""}</Text>
                <Combobox
                  placeholder="Select a Prioritization to turn funds in from"
                  selectedOptions={[]}
                  value={picker}
                  onChange={(e) => setPicker(e.target.value)}
                  onOptionSelect={(_, d) => {
                    const p = prios.find((x) => x.id === d.optionValue);
                    setPicker("");
                    if (p) void addPrio(p);
                  }}
                >
                  {available.map((p) => (
                    <Option key={p.id} value={p.id} text={p.name}>
                      {`${p.name} — Funded ${money(p.funded)}`}
                    </Option>
                  ))}
                </Combobox>
              </div>
            </div>
            <Text className={styles.muted}>
              Enter the TDP to turn in per Fund/SAG. AFP and Allotment are optional: leave blank to size them
              automatically, or enter what you want returned. The Prioritization Requested amount drops by the TDP
              turned in.
            </Text>

            {blocks.map(renderBlock)}

            {blocks.length > 0 && (
              <>
                <Divider />
                <AmountTotals styles={styles} tdp={total} afp={enteredAfp} allot={enteredAllot} entered />
              </>
            )}

            <div className={styles.footer}>
              <Button appearance="primary" disabled={!canSave || saving} onClick={() => void save()}>
                {saving ? "Saving..." : "Save Turn-In"}
              </Button>
              {saving && <Spinner size="tiny" />}
              {blocks.some((b) => !blockBalanced(b)) && !saving && (
                <Text>Each itemized Prioritization must reduce its details by its own total before saving.</Text>
              )}
            </div>
          </>
        )}
      </div>
    </FluentProvider>
  );
};
