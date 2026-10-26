import * as React from "react";
import {
  Badge,
  Button,
  Divider,
  Dropdown,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
} from "@fluentui/react-components";
import {
  WebApi,
  PRIO_FUNDING,
  SWAP_ITEM,
  SET,
  Leg,
  Adjustment,
  StateRef,
  PfLine,
  DetailRow,
  PF_SELECT,
  readPfLine,
  eligiblePfFilter,
  loadDetails,
  saveAdjustments,
  num,
  money,
  errorText,
  useStyles,
} from "./shared";
import { DetailGrid, detailBalanced, detailInvalid } from "./details";

/**
 * Receiving side: for each leg the other state sends, the user picks the line it lands on
 * — a funded Prioritization Funding line on one of this state's NPM Review Prioritizations,
 * with the leg's Fund and PG. Itemized Prioritizations increase their details by what they
 * receive. Only the credit lookup on those legs and this state's increases are written.
 * A saved pick can be changed but not cleared.
 */
export interface ReceiveSideProps {
  webAPI: WebApi;
  swapId: string;
  fiscalYear: number;
  myState: StateRef;
  otherState: StateRef;
  incoming: Leg[];
  myIncreases: Adjustment[];
  onSaved: () => void;
}

interface DetailBlock {
  loading: boolean;
  rows: DetailRow[];
}

export const ReceiveSide: React.FC<ReceiveSideProps> = ({
  webAPI,
  swapId,
  fiscalYear,
  myState,
  otherState,
  incoming,
  myIncreases,
  onSaved,
}) => {
  const styles = useStyles();
  const [candidates, setCandidates] = React.useState<PfLine[] | null>(null);
  const [choice, setChoice] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(incoming.map((l) => [l.id, l.creditPfId]))
  );
  const [details, setDetails] = React.useState<Record<string, DetailBlock>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          PRIO_FUNDING,
          PF_SELECT + "&$filter=" + eligiblePfFilter(myState.id, fiscalYear)
        );
        if (!cancelled) setCandidates(res.entities.map(readPfLine).sort((a, b) => a.prioName.localeCompare(b.prioName)));
      } catch (e) {
        if (!cancelled) {
          setError(errorText(e, "Could not load your funded Prioritization lines."));
          setCandidates([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, myState.id, fiscalYear]);

  const byId = React.useMemo(() => new Map((candidates ?? []).map((c) => [c.id, c])), [candidates]);

  // Σ legs landing on each itemized Prioritization — what its detail increases must total.
  const itemizedRequired = React.useMemo(() => {
    const m = new Map<string, { name: string; amount: number }>();
    for (const l of incoming) {
      const c = byId.get(choice[l.id] ?? "");
      if (!c?.itemized) continue;
      const cur = m.get(c.prioId);
      m.set(c.prioId, { name: c.prioName, amount: (cur?.amount ?? 0) + l.amount });
    }
    return m;
  }, [incoming, choice, byId]);

  // Load the details of each itemized Prioritization once it receives a leg.
  React.useEffect(() => {
    const prefill = new Map(myIncreases.map((a) => [a.detailId, a.amount]));
    for (const prioId of itemizedRequired.keys()) {
      if (details[prioId]) continue;
      setDetails((d) => ({ ...d, [prioId]: { loading: true, rows: [] } }));
      loadDetails(webAPI, prioId, prefill)
        .then((rows) => setDetails((d) => ({ ...d, [prioId]: { loading: false, rows } })))
        .catch((e) => setError(errorText(e, "Could not load the Itemized Details.")));
    }
  }, [itemizedRequired, details, myIncreases, webAPI]);

  const setDetail = (prioId: string, detailId: string, value: string): void =>
    setDetails((d) => ({
      ...d,
      [prioId]: { ...d[prioId], rows: d[prioId].rows.map((r) => (r.id === detailId ? { ...r, value } : r)) },
    }));

  const blocksOk = [...itemizedRequired].every(([prioId, req]) => {
    const b = details[prioId];
    return b && !b.loading && !detailInvalid(b.rows, "increase") && detailBalanced(b.rows, req.amount);
  });
  const changed =
    incoming.some((l) => (choice[l.id] ?? "") !== l.creditPfId) || itemizedRequired.size > 0 || myIncreases.length > 0;
  const canSave = !saving && candidates !== null && blocksOk && changed;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      for (const l of incoming) {
        const pick = choice[l.id] ?? "";
        if (pick && pick !== l.creditPfId)
          await webAPI.updateRecord(SWAP_ITEM, l.id, {
            "book_CreditPrioritizationFunding@odata.bind": `/${SET.pf}(${pick})`,
          });
      }
      const increases = [...itemizedRequired.keys()].flatMap((prioId) =>
        (details[prioId]?.rows ?? []).filter((r) => num(r.value) > 0).map((r) => ({ detailId: r.id, amount: num(r.value) }))
      );
      await saveAdjustments(webAPI, swapId, "increase", myIncreases, increases);
      onSaved();
    } catch (e) {
      setError(errorText(e, "Could not save where the incoming legs land."));
      setSaving(false);
    }
  };

  const optionText = (c: PfLine): string => `${c.prioName} — ${c.rfName} (Funded ${money(c.funded)})`;
  const total = incoming.reduce((s, l) => s + l.amount, 0);
  const unpicked = incoming.filter((l) => !(choice[l.id] ?? "")).length;

  return (
    <div className={styles.section}>
      <Text className={styles.title}>
        {myState.name} receives from {otherState.name}
      </Text>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {incoming.length === 0 ? (
        <Text className={styles.muted}>{otherState.name} has not sent anything to {myState.name} yet.</Text>
      ) : candidates === null ? (
        <Spinner size="tiny" label="Loading your funded lines..." />
      ) : (
        <>
          <Text className={styles.muted}>
            Pick the line each leg lands on: a funded line on one of your NPM Review Prioritizations with the same Fund
            and PG. Requested is raised only when the new Funded would exceed it.
          </Text>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>From ({otherState.name})</th>
                <th className={styles.th}>Fund / PG</th>
                <th className={styles.th}>Amount</th>
                <th className={styles.th}>Lands on</th>
              </tr>
            </thead>
            <tbody>
              {incoming.map((l) => {
                const matches = candidates.filter((c) => c.fundId === l.fundId && c.pgId === l.pgId);
                const pick = choice[l.id] ?? "";
                const picked = byId.get(pick);
                const label = picked ? optionText(picked) : pick ? `${l.creditPrioName} — ${l.creditLine}` : "";
                return (
                  <tr key={l.id}>
                    <td className={styles.td}>
                      {l.debitPrioName}
                      <br />
                      <span className={styles.muted}>{l.debitLine}</span>
                    </td>
                    <td className={styles.td}>{l.fundPg}</td>
                    <td className={styles.td}>{money(l.amount)}</td>
                    <td className={styles.td}>
                      {matches.length === 0 && !pick ? (
                        <Text className={styles.muted}>No funded line of yours has this Fund and PG.</Text>
                      ) : (
                        <Dropdown
                          className={styles.lineCombo}
                          placeholder="Select a line"
                          value={label}
                          selectedOptions={pick ? [pick] : []}
                          onOptionSelect={(_, d) => setChoice((c) => ({ ...c, [l.id]: d.optionValue ?? "" }))}
                        >
                          {matches.map((c) => (
                            <Option key={c.id} value={c.id} text={optionText(c)}>
                              {optionText(c)}
                            </Option>
                          ))}
                        </Dropdown>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {[...itemizedRequired].map(([prioId, req]) => {
            const b = details[prioId];
            return (
              <div key={prioId} className={styles.section}>
                <Divider />
                <div className={styles.balanceRow}>
                  <Text className={styles.heading}>{req.name}</Text>
                  <Badge appearance="outline">Itemized</Badge>
                </div>
                {!b || b.loading ? (
                  <Spinner size="tiny" label="Loading..." />
                ) : (
                  <DetailGrid
                    mode="increase"
                    rows={b.rows}
                    required={req.amount}
                    editable
                    onChange={(id, v) => setDetail(prioId, id, v)}
                  />
                )}
              </div>
            );
          })}

          <Divider />
          <div className={styles.footer}>
            <Text>
              Receiving <b>{money(total)}</b>
              {unpicked > 0 ? ` · ${unpicked} leg${unpicked === 1 ? "" : "s"} not placed yet` : ""}
            </Text>
            <Button appearance="primary" disabled={!canSave} onClick={() => void save()}>
              {saving ? "Saving..." : "Save where it lands"}
            </Button>
            {saving && <Spinner size="tiny" />}
            {!blocksOk && !saving && (
              <Text>Each itemized Prioritization must increase its details by what it receives before saving.</Text>
            )}
          </div>
        </>
      )}
    </div>
  );
};
