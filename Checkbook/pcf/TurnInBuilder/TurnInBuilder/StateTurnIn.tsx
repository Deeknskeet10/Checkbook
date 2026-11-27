import * as React from "react";
import {
  FluentProvider,
  Button,
  Combobox,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  mergeClasses,
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
  matches,
  useStyles,
  saveTurnInChildren,
  DesiredRow,
} from "./shared";
import {
  LineAmounts,
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
  ChipData,
  ChipList,
  DeleteIcon,
  EditIcon,
  ItemName,
  SaveIcon,
  StatusLabel,
  TagLabel,
} from "./designSystem";

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
  const ri =
    (e.book_RequirementItem as Record<string, unknown> | null | undefined) ??
    {};
  const label = (attr: string): string =>
    (ri[`_${attr}_value${FV}`] as string) ?? "";
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

const blockTotal = (b: Block): number =>
  b.pfRows.reduce((s, r) => s + num(r.amount), 0);
const blockReduced = (b: Block): number =>
  b.detailRows.reduce((s, r) => s + num(r.reduce), 0);
const isItemized = (b: Block): boolean =>
  b.prio.fundingMode === FUNDING_MODE_ITEMIZED;
const blockOverLine = (b: Block): boolean =>
  b.pfRows.some(
    (r) =>
      num(r.amount) > r.funded + EPS ||
      num(r.amount) < 0 ||
      num(r.afp) < 0 ||
      num(r.allot) < 0,
  );
const blockOverDetail = (b: Block): boolean =>
  b.detailRows.some((r) => num(r.reduce) > r.funded + EPS || num(r.reduce) < 0);
const blockBalanced = (b: Block): boolean =>
  !isItemized(b) || Math.abs(blockTotal(b) - blockReduced(b)) < EPS;

export const StateTurnIn: React.FC<StateTurnInProps> = ({
  webAPI,
  recordId,
  isActive,
  fiscalYear,
  fundCenterId,
}) => {
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
  // Text typed into the Prioritization combobox: options are filtered by "contains", as in RfTurnIn.
  const [picker, setPicker] = React.useState("");

  // Saved rows: the summary, and the amounts Edit pre-fills.
  const [savedLines, setSavedLines] = React.useState<
    (SavedLine & { prioId: string; prioName: string })[]
  >([]);
  const [savedReductions, setSavedReductions] = React.useState<
    { id: string; item: string; tdc: string; mdep: string; amount: number }[]
  >([]);
  const prefill = React.useRef<{
    pf: Map<string, LineAmounts>;
    detail: Map<string, number>;
  }>({
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
        const fc = await webAPI.retrieveRecord(
          FUND_CENTER,
          fundCenterId,
          "?$select=_book_state_value",
        );
        const stateId = cleanId(fc._book_state_value);
        if (cancelled) return;
        setStateName((fc[`_book_state_value${FV}`] as string) ?? "");
        const stateFilter = stateId
          ? ` and _book_state_value eq ${stateId}`
          : "";
        const [prioRes, items, reds] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            PRIORITIZATION,
            "?$select=book_name,book_newfundedamounttdp,book_fundingmode" +
              `&$filter=statecode eq ${STATECODE_ACTIVE} and book_newfiscalyear eq ${fiscalYear}` +
              ` and book_approvalstatus eq ${FINAL_APPROVED} and book_newfundedamounttdp gt 0${stateFilter}` +
              "&$orderby=book_name asc&$top=500",
          ),
          webAPI.retrieveMultipleRecords(
            TURNIN_ITEM,
            `?$select=${SAVED_LINE_SELECT},_book_prioritizationfunding_value,_book_prioritization_value` +
              `&$filter=_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              " and _book_prioritizationfunding_value ne null" +
              "&$expand=book_PrioritizationFunding($select=_book_requirementfunding_value)",
          ),
          webAPI.retrieveMultipleRecords(
            DETAIL_REDUCTION,
            "?$select=book_newamount,_book_itemizeddetail_value" +
              `&$filter=_book_turnin_value eq ${recordId} and statecode eq ${STATECODE_ACTIVE}` +
              // The detail's Requirement Item → Item / TDC / MDEP for the summary's ITEM column.
              "&$expand=book_ItemizedDetail($select=book_name;" +
              "$expand=book_RequirementItem($select=_book_item_value,_book_tdc_value,_book_mdep_value))",
          ),
        ]);
        if (cancelled) return;
        setPrios(
          prioRes.entities.map((e) => ({
            id: cleanId(e.book_prioritizationid),
            name: (e.book_name as string) ?? "(unnamed)",
            funded: num(e.book_newfundedamounttdp),
            fundingMode:
              e.book_fundingmode == null ? null : num(e.book_fundingmode),
          })),
        );
        setSavedLines(
          items.entities.map((e) => {
            const pf = e.book_PrioritizationFunding as
              Record<string, unknown> | undefined;
            return {
              ...readSavedLine(e),
              id: cleanId(e._book_prioritizationfunding_value),
              label:
                (pf?.[`_book_requirementfunding_value${FV}`] as string) ??
                "(Fund/SAG)",
              prioId: cleanId(e._book_prioritization_value),
              prioName:
                (e[`_book_prioritization_value${FV}`] as string) ??
                "(Prioritization)",
            };
          }),
        );
        setSavedReductions(
          reds.entities.map((e) => {
            const d =
              (e.book_ItemizedDetail as Record<string, unknown> | null) ?? {};
            const row = toDetailRow(d, "");
            return {
              id: cleanId(e._book_itemizeddetail_value),
              item: row.item,
              tdc: row.tdc,
              mdep: row.mdep,
              amount: num(e.book_newamount),
            };
          }),
        );
        if (items.entities.length > 0) setMode("view");
      } catch {
        if (!cancelled)
          setError("Could not load the Turn-In's Prioritizations.");
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
      setBlocks((bs) =>
        bs.some((b) => b.prio.id === p.id)
          ? bs
          : [...bs, { prio: p, loading: true, pfRows: [], detailRows: [] }],
      );
      try {
        const [pfRes, idRes] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            PRIO_FUNDING,
            "?$select=book_fundedamount,_book_requirementfunding_value" +
              `&$filter=_book_prioritization_value eq ${p.id} and statecode eq ${STATECODE_ACTIVE}` +
              "&$expand=book_RequirementFunding($select=book_name)",
          ),
          webAPI.retrieveMultipleRecords(
            ITEMIZED_DETAILS,
            DETAIL_SELECT +
              `&$filter=_book_prioritization_value eq ${p.id} and statecode eq ${STATECODE_ACTIVE}&$orderby=book_name asc`,
          ),
        ]);
        const pfFill = prefill.current.pf;
        const dFill = prefill.current.detail;
        const pfRows: PfRow[] = pfRes.entities
          .map((e) => {
            const rf = e.book_RequirementFunding as
              Record<string, unknown> | undefined;
            const id = cleanId(e.book_prioritizationfundingid);
            const fill = pfFill.get(id);
            return {
              id,
              rfId: cleanId(e._book_requirementfunding_value),
              rfName:
                (rf?.book_name as string) ??
                (e[`_book_requirementfunding_value${FV}`] as string) ??
                "(RF)",
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
        setBlocks((bs) =>
          bs.map((b) =>
            b.prio.id === p.id
              ? { ...b, loading: false, pfRows, detailRows }
              : b,
          ),
        );
      } catch {
        setError(`Could not load the funding for ${p.name}.`);
        setBlocks((bs) => bs.filter((b) => b.prio.id !== p.id));
      }
    },
    [webAPI],
  );

  const removePrio = (id: string): void =>
    setBlocks((bs) => bs.filter((b) => b.prio.id !== id));
  const patchPf = (
    prioId: string,
    id: string,
    patch: Partial<LineAmounts>,
  ): void =>
    setBlocks((bs) =>
      bs.map((b) =>
        b.prio.id === prioId
          ? {
              ...b,
              pfRows: b.pfRows.map((r) =>
                r.id === id ? { ...r, ...patch } : r,
              ),
            }
          : b,
      ),
    );
  const patchDetail = (prioId: string, id: string, reduce: string): void =>
    setBlocks((bs) =>
      bs.map((b) =>
        b.prio.id === prioId
          ? {
              ...b,
              detailRows: b.detailRows.map((r) =>
                r.id === id ? { ...r, reduce } : r,
              ),
            }
          : b,
      ),
    );

  // ---- derived ----------------------------------------------------------------------
  const allRows = blocks.flatMap((b) => b.pfRows);
  const total = allRows.reduce((s, r) => s + num(r.amount), 0);
  const canSave =
    isActive &&
    blocks.length > 0 &&
    !blocks.some(
      (b) =>
        b.loading ||
        blockOverLine(b) ||
        blockOverDetail(b) ||
        !blockBalanced(b),
    ) &&
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
        ]),
      ),
      detail: new Map(savedReductions.map((r) => [r.id, r.amount])),
    };
    setBlocks([]);
    const seen = new Set<string>();
    for (const l of savedLines) {
      if (seen.has(l.prioId)) continue;
      seen.add(l.prioId);
      const p = prios.find((x) => x.id === l.prioId) ?? {
        id: l.prioId,
        name: l.prioName,
        funded: 0,
        fundingMode: null,
      };
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
      setSaveMsg(
        "Turn-In saved. Submit it for State approval from the Approval panel.",
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

  // ---- render -------------------------------------------------------------------------
  /** Chips under the item name, as on the Itemized Details Grid; empty values skipped. */
  const detailChips = (r: { tdc: string; mdep: string }): ChipData[] =>
    [
      { type: "tdc", label: "TDC", value: r.tdc },
      { type: "mdep", label: "MDEP", value: r.mdep },
    ].filter((c) => c.value !== "");

  /** ITEM cell: item name with TDC / MDEP chips underneath (Itemized Details Grid design). */
  const itemCell = (r: {
    item: string;
    tdc: string;
    mdep: string;
  }): React.ReactElement => (
    <>
      <ItemName name={r.item !== "" ? r.item : "(no item)"} />
      <ChipList chips={detailChips(r)} />
    </>
  );

  const statusFor = (): React.ReactElement =>
    isActive ? (
      <StatusLabel kind="neutral">Draft — Not Yet Approved</StatusLabel>
    ) : (
      <StatusLabel kind="success">Processed</StatusLabel>
    );

  const renderSummary = (): React.ReactElement => {
    const groups = new Map<string, typeof savedLines>();
    for (const l of savedLines)
      groups.set(l.prioName, [...(groups.get(l.prioName) ?? []), l]);
    return (
      <div className={styles.stateNarrow}>
        <div className={styles.balanceRow}>
          <Text className={styles.title}>Turn-In Summary</Text>
          {statusFor()}
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
        {savedLines.length === 0 ? (
          <Text className={styles.muted}>
            No Turn-In lines saved yet. Use Edit to add a Prioritization.
          </Text>
        ) : (
          <>
            {/* Saved lines always balance, so the total is green. */}
            <div className={styles.cards}>
              <FigureCard
                title="Turn-In Total"
                value={savedLines.reduce((s, l) => s + l.amount, 0)}
                tone="success"
              />
            </div>
            {SHOW_AFP_ALLOT && (
              <AmountTotals
                styles={styles}
                tdp={savedLines.reduce((s, l) => s + l.amount, 0)}
                afp={savedLines.reduce((s, l) => s + l.afp, 0)}
                allot={savedLines.reduce((s, l) => s + l.allot, 0)}
              />
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>Prioritization</th>
                    <th className={styles.th}>
                      Requirement Funding (Fund/SAG)
                    </th>
                    <th className={mergeClasses(styles.th, styles.num)}>TDP</th>
                    {SHOW_AFP_ALLOT && (
                      <th className={mergeClasses(styles.th, styles.num)}>
                        AFP
                      </th>
                    )}
                    {SHOW_AFP_ALLOT && (
                      <th className={mergeClasses(styles.th, styles.num)}>
                        Allotment
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {[...groups].flatMap(([prioName, lines]) =>
                    lines.map((l, i) => (
                      <tr key={l.id}>
                        <td
                          className={mergeClasses(styles.td, styles.identity)}
                        >
                          {i === 0 ? prioName : ""}
                        </td>
                        <td className={mergeClasses(styles.td, styles.ctx)}>
                          {l.label}
                        </td>
                        <td className={mergeClasses(styles.td, styles.num)}>
                          {money(l.amount)}
                        </td>
                        {SHOW_AFP_ALLOT && (
                          <td className={mergeClasses(styles.td, styles.num)}>
                            {money(l.afp)}
                            {l.afpOverridden ? "" : " (auto)"}
                          </td>
                        )}
                        {SHOW_AFP_ALLOT && (
                          <td className={mergeClasses(styles.td, styles.num)}>
                            {money(l.allot)}
                            {l.allotOverridden ? "" : " (auto)"}
                          </td>
                        )}
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            {savedReductions.length > 0 && (
              <div className={styles.tableWrap}>
                <table className={mergeClasses(styles.table, styles.gridTable)}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Item</th>
                      <th className={mergeClasses(styles.th, styles.num)}>
                        Reduced By
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedReductions.map((r) => (
                      <tr key={r.id}>
                        <td className={mergeClasses(styles.td, styles.itemCol)}>
                          {itemCell(r)}
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
  };

  const renderBlock = (b: Block): React.ReactElement => {
    const t = blockTotal(b);
    const reduced = blockReduced(b);
    const remaining = t - reduced;
    return (
      <div key={b.prio.id} className={styles.section}>
        <div className={styles.balanceRow}>
          <Text className={styles.title}>{b.prio.name}</Text>
          {isItemized(b) && <TagLabel>Itemized</TagLabel>}
          <span className={styles.spacer} />
          <Button
            appearance="subtle"
            size="small"
            className={styles.destructive}
            icon={<DeleteIcon />}
            aria-label={`Remove ${b.prio.name}`}
            onClick={() => removePrio(b.prio.id)}
          >
            Remove
          </Button>
        </div>
        {b.loading ? (
          <Spinner size="tiny" label={`Loading ${b.prio.name}…`} />
        ) : b.pfRows.length === 0 ? (
          <Text className={styles.muted}>
            This Prioritization has no funded Requirement Funding lines.
          </Text>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Requirement Funding (Fund/SAG)</th>
                  <th className={mergeClasses(styles.th, styles.num)}>
                    Funded
                  </th>
                  <th className={mergeClasses(styles.th, styles.num)}>
                    TDP to Turn In
                  </th>
                  {SHOW_AFP_ALLOT && (
                    <th className={mergeClasses(styles.th, styles.num)}>AFP</th>
                  )}
                  {SHOW_AFP_ALLOT && (
                    <th className={mergeClasses(styles.th, styles.num)}>
                      Allotment
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {b.pfRows.map((r) => (
                  <tr key={r.id}>
                    <td className={mergeClasses(styles.td, styles.identity)}>
                      {r.rfName}
                    </td>
                    <td className={mergeClasses(styles.td, styles.num)}>
                      {money(r.funded)}
                    </td>
                    <td className={mergeClasses(styles.td, styles.num)}>
                      <AmountInput
                        aria-label={`TDP to turn in from ${r.rfName}`}
                        value={r.amount}
                        onChange={(v) =>
                          patchPf(b.prio.id, r.id, { amount: v })
                        }
                      />
                    </td>
                    {SHOW_AFP_ALLOT && (
                      <td className={mergeClasses(styles.td, styles.num)}>
                        <AmountInput
                          aria-label={`AFP for ${r.rfName}`}
                          value={r.afp}
                          onChange={(v) => patchPf(b.prio.id, r.id, { afp: v })}
                        />
                      </td>
                    )}
                    {SHOW_AFP_ALLOT && (
                      <td className={mergeClasses(styles.td, styles.num)}>
                        <AmountInput
                          aria-label={`Allotment for ${r.rfName}`}
                          value={r.allot}
                          onChange={(v) =>
                            patchPf(b.prio.id, r.id, { allot: v })
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {blockOverLine(b) && (
          <MessageBar intent="error">
            <MessageBarBody>
              A line exceeds the funding on that Fund/SAG, or an amount is
              negative.
            </MessageBarBody>
          </MessageBar>
        )}

        {isItemized(b) && t > 0 && (
          <>
            {/* Itemized: the details drop by this total (Funded and Requested together). */}
            <div className={styles.cards}>
              <FigureCard title="Turn In Amount" value={t} />
            </div>
            <div className={styles.tableWrap}>
              <table className={mergeClasses(styles.table, styles.gridTable)}>
                <thead>
                  <tr>
                    <th className={styles.th}>Item</th>
                    <th className={mergeClasses(styles.th, styles.num)}>
                      Requested
                    </th>
                    <th className={mergeClasses(styles.th, styles.num)}>
                      Funded
                    </th>
                    <th className={mergeClasses(styles.th, styles.num)}>
                      Reduce By
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {b.detailRows.map((r) => (
                    <tr key={r.id}>
                      <td className={mergeClasses(styles.td, styles.itemCol)}>
                        {itemCell(r)}
                      </td>
                      <td className={mergeClasses(styles.td, styles.num)}>
                        {money(r.requested)}
                      </td>
                      <td className={mergeClasses(styles.td, styles.num)}>
                        {money(r.funded)}
                      </td>
                      <td className={mergeClasses(styles.td, styles.num)}>
                        <AmountInput
                          aria-label={`Reduce detail ${r.name} by`}
                          value={r.reduce}
                          onChange={(v) => patchDetail(b.prio.id, r.id, v)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={styles.totalRow}>
                    <td className={styles.td} colSpan={3}>
                      <div className={styles.balanceRow}>
                        <span>Total</span>
                        {blockBalanced(b) ? (
                          <StatusLabel kind="success">Balanced</StatusLabel>
                        ) : (
                          <StatusLabel kind="warning">
                            {remaining > 0
                              ? `${money(remaining)} left to reduce`
                              : `${money(-remaining)} over`}
                          </StatusLabel>
                        )}
                      </div>
                    </td>
                    <td className={mergeClasses(styles.td, styles.num)}>
                      <div className={styles.stack}>
                        <span>{money(reduced)}</span>
                        <span className={styles.muted}>of {money(t)}</span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {blockOverDetail(b) && (
              <MessageBar intent="error">
                <MessageBarBody>
                  A reduction exceeds the funding on that Itemized Detail.
                </MessageBarBody>
              </MessageBar>
            )}
          </>
        )}
      </div>
    );
  };

  const available = prios.filter(
    (p) => !blocks.some((b) => b.prio.id === p.id),
  );
  const prioOptions = available.filter((p) => matches(p.name, picker));
  const enteredAfp = allRows.reduce((s, r) => s + num(r.afp), 0);
  const enteredAllot = allRows.reduce((s, r) => s + num(r.allot), 0);

  return (
    <FluentProvider theme={checkbookTheme} style={{ width: "100%" }}>
      <div className={styles.root}>
        {loading && <Spinner size="tiny" label="Loading Prioritizations…" />}
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {!loading && !fundCenterId && (
          <div className={styles.awaiting}>
            <Text>
              Set the Turn-In Fund Center (your state) and save to pick
              Prioritizations.
            </Text>
          </div>
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

        {!loading &&
          fundCenterId &&
          (mode === "view" || !isActive) &&
          renderSummary()}

        {!loading && fundCenterId && isActive && mode === "edit" && (
          <div className={styles.stateNarrow}>
            <div
              className={styles.pickerField}
              style={{ width: "100%", minWidth: 0 }}
            >
              <Text className={styles.fieldLabel}>
                Add a Prioritization{stateName ? ` (${stateName})` : ""}
              </Text>
              <Combobox
                appearance="filled-lighter"
                className={styles.editable}
                listbox={{ className: styles.listbox }}
                style={{ width: "100%", maxWidth: "none", minWidth: 0 }}
                placeholder="Search by Requirement name"
                selectedOptions={[]}
                value={picker}
                onChange={(e) => setPicker(e.target.value)}
                onOptionSelect={(_, d) => {
                  const p = prios.find((x) => x.id === d.optionValue);
                  setPicker("");
                  if (p) void addPrio(p);
                }}
              >
                {prioOptions.map((p) => (
                  <Option key={p.id} value={p.id} text={p.name}>
                    {`${p.name} — Funded ${money(p.funded)}`}
                  </Option>
                ))}
                {prioOptions.length === 0 && (
                  <Option key="__none" value="" text="" disabled>
                    {available.length === 0
                      ? "No more Prioritizations to add"
                      : "No Prioritizations match your search"}
                  </Option>
                )}
              </Combobox>
              <Text className={styles.muted}>
                Enter the TDP to turn in per Fund/SAG.
                {SHOW_AFP_ALLOT
                  ? " AFP and Allotment are optional: leave blank to size them automatically, or enter what you want returned."
                  : ""}{" "}
                The Prioritization Requested amount drops by the TDP turned in.
              </Text>
            </div>

            {blocks.map(renderBlock)}

            {blocks.length > 0 && (
              // Green once every itemized Prioritization's details balance, yellow until then.
              <div className={styles.cards}>
                <FigureCard
                  title="Turn-In Total"
                  value={total}
                  tone={blocks.every(blockBalanced) ? "success" : "warning"}
                />
              </div>
            )}
            {blocks.length > 0 && SHOW_AFP_ALLOT && (
              <AmountTotals
                styles={styles}
                tdp={total}
                afp={enteredAfp}
                allot={enteredAllot}
                entered
              />
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
              {blocks.some((b) => !blockBalanced(b)) && !saving && (
                <Text className={styles.muted}>
                  Each itemized Prioritization must reduce its details by its
                  own total before saving.
                </Text>
              )}
            </div>
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
