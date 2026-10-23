import * as React from "react";
import {
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
  PRIORITIZATION,
  PRIO_FUNDING,
  SWAP_ITEM,
  SET,
  STATECODE_ACTIVE,
  FINAL_APPROVED,
  FUNDING_MODE_ITEMIZED,
  EPS,
  Leg,
  Adjustment,
  StateRef,
  PfLine,
  DetailRow,
  PF_SELECT,
  readPfLine,
  loadDetails,
  saveAdjustments,
  num,
  money,
  cleanId,
  errorText,
  useStyles,
} from "./shared";
import { DetailGrid, detailBalanced, detailInvalid } from "./details";

/**
 * Sending side: the user's state adds one or more of its NPM Review Prioritizations and
 * enters what each funded Prioritization Funding line (one per Fund/SAG) sends. A line can
 * be split into several legs so the receiver can land them on different lines. Itemized
 * Prioritizations reduce their details by what they send. Only this state's legs and
 * reductions are written — the receiver's credit picks on these legs are left alone.
 */
export interface SendSideProps {
  webAPI: WebApi;
  swapId: string;
  fiscalYear: number;
  myState: StateRef;
  otherState: StateRef;
  myLegs: Leg[];
  myReductions: Adjustment[];
  onSaved: () => void;
}

interface LegEntry {
  key: string;
  itemId?: string;
  amount: string;
  landsOn: string;
}
interface LineRow extends PfLine {
  legs: LegEntry[];
}
interface Block {
  prioId: string;
  prioName: string;
  itemized: boolean;
  loading: boolean;
  lines: LineRow[];
  details: DetailRow[];
}
interface PrioOpt {
  id: string;
  name: string;
  funded: number;
}

let nextKey = 0;
const newLeg = (): LegEntry => ({ key: `new-${nextKey++}`, amount: "", landsOn: "" });

const lineSent = (l: LineRow): number => l.legs.reduce((s, x) => s + num(x.amount), 0);
const lineOver = (l: LineRow): boolean => lineSent(l) > l.funded + EPS || l.legs.some((x) => num(x.amount) < 0);
const blockSent = (b: Block): number => b.lines.reduce((s, l) => s + lineSent(l), 0);
const blockOk = (b: Block): boolean =>
  !b.loading &&
  !b.lines.some(lineOver) &&
  (!b.itemized || (!detailInvalid(b.details, "reduce") && detailBalanced(b.details, blockSent(b))));

export const SendSide: React.FC<SendSideProps> = ({
  webAPI,
  swapId,
  fiscalYear,
  myState,
  otherState,
  myLegs,
  myReductions,
  onSaved,
}) => {
  const styles = useStyles();
  const [prios, setPrios] = React.useState<PrioOpt[]>([]);
  const [blocks, setBlocks] = React.useState<Block[]>([]);
  const [picker, setPicker] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Saved legs / reductions pre-fill the grids, so re-saving updates rows in place.
  const prefill = React.useMemo(() => {
    const legs = new Map<string, LegEntry[]>();
    for (const l of myLegs) {
      const landsOn = l.creditPfId ? `${l.creditPrioName} — ${l.creditLine}` : "";
      legs.set(l.debitPfId, [...(legs.get(l.debitPfId) ?? []), { key: l.id, itemId: l.id, amount: String(l.amount), landsOn }]);
    }
    return { legs, details: new Map(myReductions.map((r) => [r.detailId, r.amount])) };
  }, [myLegs, myReductions]);

  // Prioritizations with a block open (or loading) — guards double-adds without waiting on state.
  const opened = React.useRef(new Set<string>());
  const removePrio = (prioId: string): void => {
    opened.current.delete(prioId);
    setBlocks((bs) => bs.filter((b) => b.prioId !== prioId));
  };

  const addPrio = React.useCallback(
    async (prioId: string, prioName: string): Promise<void> => {
      if (opened.current.has(prioId)) return;
      opened.current.add(prioId);
      setBlocks((bs) => [...bs, { prioId, prioName, itemized: false, loading: true, lines: [], details: [] }]);
      try {
        const [pfRes, prio] = await Promise.all([
          webAPI.retrieveMultipleRecords(
            PRIO_FUNDING,
            PF_SELECT + `&$filter=_book_prioritization_value eq ${prioId} and statecode eq ${STATECODE_ACTIVE}`
          ),
          webAPI.retrieveRecord(PRIORITIZATION, prioId, "?$select=book_fundingmode"),
        ]);
        const itemized = num(prio.book_fundingmode) === FUNDING_MODE_ITEMIZED;
        const lines: LineRow[] = pfRes.entities
          .map(readPfLine)
          .filter((l) => l.funded > 0 || prefill.legs.has(l.id))
          .map((l) => ({ ...l, legs: prefill.legs.get(l.id) ?? [newLeg()] }));
        const details = itemized ? await loadDetails(webAPI, prioId, prefill.details) : [];
        setBlocks((bs) => bs.map((b) => (b.prioId === prioId ? { ...b, itemized, loading: false, lines, details } : b)));
      } catch (e) {
        setError(errorText(e, `Could not load the funding for ${prioName}.`));
        removePrio(prioId);
      }
    },
    [webAPI, prefill]
  );

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          PRIORITIZATION,
          "?$select=book_name,book_newfundedamounttdp" +
            `&$filter=statecode eq ${STATECODE_ACTIVE} and book_newfiscalyear eq ${fiscalYear}` +
            ` and book_approvalstatus eq ${FINAL_APPROVED} and book_newfundedamounttdp gt 0` +
            ` and _book_state_value eq ${myState.id}&$orderby=book_name asc&$top=500`
        );
        if (cancelled) return;
        setPrios(
          res.entities.map((e) => ({
            id: cleanId(e.book_prioritizationid),
            name: (e.book_name as string) ?? "(unnamed)",
            funded: num(e.book_newfundedamounttdp),
          }))
        );
      } catch (e) {
        if (!cancelled) setError(errorText(e, "Could not load your Prioritizations."));
      }
    })();
    const seen = new Set<string>();
    for (const l of myLegs) {
      if (!l.debitPrioId || seen.has(l.debitPrioId)) continue;
      seen.add(l.debitPrioId);
      void addPrio(l.debitPrioId, l.debitPrioName);
    }
    return () => {
      cancelled = true;
    };
    // Mount-only: the shell remounts this component after every save.
  }, []);

  const patchLine = (prioId: string, lineId: string, f: (l: LineRow) => LineRow): void =>
    setBlocks((bs) =>
      bs.map((b) => (b.prioId === prioId ? { ...b, lines: b.lines.map((l) => (l.id === lineId ? f(l) : l)) } : b))
    );
  const setLegAmount = (prioId: string, lineId: string, key: string, amount: string): void =>
    patchLine(prioId, lineId, (l) => ({ ...l, legs: l.legs.map((x) => (x.key === key ? { ...x, amount } : x)) }));
  const splitLine = (prioId: string, lineId: string): void =>
    patchLine(prioId, lineId, (l) => ({ ...l, legs: [...l.legs, newLeg()] }));
  const removeLeg = (prioId: string, lineId: string, key: string): void =>
    patchLine(prioId, lineId, (l) => {
      const legs = l.legs.filter((x) => x.key !== key);
      return { ...l, legs: legs.length > 0 ? legs : [newLeg()] };
    });
  const setDetail = (prioId: string, detailId: string, value: string): void =>
    setBlocks((bs) =>
      bs.map((b) =>
        b.prioId === prioId ? { ...b, details: b.details.map((d) => (d.id === detailId ? { ...d, value } : d)) } : b
      )
    );

  const total = blocks.reduce((s, b) => s + blockSent(b), 0);
  const hadSaved = myLegs.length > 0 || myReductions.length > 0;
  const canSave = !saving && blocks.every(blockOk) && (total > EPS || hadSaved);

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const savedAmount = new Map(myLegs.map((l) => [l.id, l.amount]));
      const kept = new Set<string>();
      for (const b of blocks) {
        for (const l of b.lines) {
          for (const x of l.legs.filter((y) => num(y.amount) > 0)) {
            const amount = num(x.amount);
            if (x.itemId) {
              kept.add(x.itemId);
              if (Math.abs((savedAmount.get(x.itemId) ?? 0) - amount) >= EPS)
                await webAPI.updateRecord(SWAP_ITEM, x.itemId, { book_newamount: amount });
            } else {
              await webAPI.createRecord(SWAP_ITEM, {
                book_newamount: amount,
                "book_StateSwap@odata.bind": `/${SET.swap}(${swapId})`,
                "book_DebitPrioritizationFunding@odata.bind": `/${SET.pf}(${l.id})`,
              });
            }
          }
        }
      }
      const reductions = blocks
        .filter((b) => b.itemized)
        .flatMap((b) => b.details.filter((d) => num(d.value) > 0).map((d) => ({ detailId: d.id, amount: num(d.value) })));
      await saveAdjustments(webAPI, swapId, "reduction", myReductions, reductions);
      // Removed legs last — the only step that needs the Delete privilege.
      for (const l of myLegs) if (!kept.has(l.id)) await webAPI.deleteRecord(SWAP_ITEM, l.id);
      onSaved();
    } catch (e) {
      setError(errorText(e, "Could not save what your state sends."));
      setSaving(false);
    }
  };

  const renderBlock = (b: Block): React.ReactElement => (
    <div key={b.prioId} className={styles.section}>
      <Divider />
      <div className={styles.balanceRow}>
        <Text className={styles.heading}>{b.prioName}</Text>
        {b.itemized && <Badge appearance="outline">Itemized</Badge>}
        <Button size="small" appearance="subtle" onClick={() => removePrio(b.prioId)}>
          Remove
        </Button>
      </div>
      {b.loading ? (
        <Spinner size="tiny" label="Loading..." />
      ) : b.lines.length === 0 ? (
        <Text>This Prioritization has no funded Requirement Funding lines.</Text>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Requirement Funding (Fund/SAG)</th>
              <th className={styles.th}>Fund / PG</th>
              <th className={styles.th}>Funded</th>
              <th className={styles.th}>Send</th>
              <th className={styles.th}>Lands on ({otherState.name})</th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((l) => (
              <tr key={l.id}>
                <td className={styles.td}>{l.rfName}</td>
                <td className={styles.td}>{l.fundPg}</td>
                <td className={styles.td}>{money(l.funded)}</td>
                <td className={styles.td}>
                  <div className={styles.legStack}>
                    {l.legs.map((x) => (
                      <div key={x.key} className={styles.legRow}>
                        <Input
                          className={styles.amtInput}
                          type="number"
                          value={x.amount}
                          onChange={(_, d) => setLegAmount(b.prioId, l.id, x.key, d.value)}
                        />
                        {l.legs.length > 1 && (
                          <Button size="small" appearance="subtle" onClick={() => removeLeg(b.prioId, l.id, x.key)}>
                            ×
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button size="small" appearance="transparent" onClick={() => splitLine(b.prioId, l.id)}>
                      + Split into another leg
                    </Button>
                  </div>
                </td>
                <td className={styles.td}>
                  <div className={styles.legStack}>
                    {l.legs.map((x) => (
                      <Text key={x.key} className={x.landsOn ? undefined : styles.muted}>
                        {x.landsOn || (x.itemId ? "Not chosen yet" : "Chosen after you save")}
                      </Text>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {b.lines.some(lineOver) && (
        <MessageBar intent="error">
          <MessageBarBody>A line sends more than its funding, or an amount is negative.</MessageBarBody>
        </MessageBar>
      )}
      {b.itemized && !b.loading && (blockSent(b) > 0 || b.details.some((d) => num(d.value) !== 0)) && (
        <DetailGrid
          mode="reduce"
          rows={b.details}
          required={blockSent(b)}
          editable
          onChange={(id, v) => setDetail(b.prioId, id, v)}
        />
      )}
    </div>
  );

  const available = prios.filter((p) => !blocks.some((b) => b.prioId === p.id));

  return (
    <div className={styles.section}>
      <Text className={styles.title}>
        {myState.name} sends to {otherState.name}
      </Text>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.pickers}>
        <div className={styles.pickerField}>
          <Text className={styles.heading}>Add a Prioritization ({myState.name})</Text>
          <Combobox
            placeholder="Select a Prioritization to send funds from"
            selectedOptions={[]}
            value={picker}
            onChange={(e) => setPicker(e.target.value)}
            onOptionSelect={(_, d) => {
              const p = prios.find((x) => x.id === d.optionValue);
              setPicker("");
              if (p) void addPrio(p.id, p.name);
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
        Enter what each Fund/SAG line sends. {otherState.name} picks the line each leg lands on (same Fund and PG).
        Split a line to let them land it on more than one line. Requested is not reduced.
      </Text>

      {blocks.map(renderBlock)}

      <Divider />
      <div className={styles.footer}>
        <Text>
          Sending <b>{money(total)}</b>
        </Text>
        <Button appearance="primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? "Saving..." : "Save what we send"}
        </Button>
        {saving && <Spinner size="tiny" />}
        {blocks.some((b) => !b.loading && b.itemized && !detailBalanced(b.details, blockSent(b))) && !saving && (
          <Text>Each itemized Prioritization must reduce its details by what it sends before saving.</Text>
        )}
      </div>
    </div>
  );
};
