import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Divider,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Spinner,
  Text,
} from "@fluentui/react-components";
import {
  WebApi,
  SWAP,
  STATE,
  FV,
  ITEMS_SAVED_EVENT,
  STATECODE_ACTIVE,
  FIRST_PF_LEG_FY,
  Leg,
  Adjustment,
  StateRef,
  loadLegs,
  loadAdjustments,
  num,
  money,
  cleanId,
  errorText,
  useStyles,
} from "./shared";
import { SendSide } from "./SendSide";
import { ReceiveSide } from "./ReceiveSide";

export interface SwapBuilderProps {
  webAPI: WebApi;
  recordId?: string;
  userId?: string;
}

// Either may act for both states (security does not restrict them), so they pick a side.
const ADMIN_ROLES = ["Book - Checkbook Administrator", "System Administrator"];
type Side = "A" | "B";

interface Loaded {
  active: boolean;
  approved: boolean; // either state or BE — SwapLineLock freezes the lines
  fy: number | null;
  stateA: StateRef | null;
  stateB: StateRef | null;
  stateABu: string;
  stateBBu: string;
  userBu: string;
  isAdmin: boolean;
  legs: Leg[];
  reductions: Adjustment[];
  increases: Adjustment[];
}

/**
 * FY27 State Swap entry (docs/StateSwap-FY27-Redesign.md §7). The user's side is the
 * state whose business unit they belong to (the same test SwapValidator uses for
 * approvals); a Checkbook or System Administrator picks a side. Each side edits only what it owns:
 * the legs it sends (+ detail reductions) and where legs sent to it land (+ detail
 * increases). Once either state approves, SwapLineLock freezes everything and this shows
 * a read-only summary — as it does for users outside both states.
 */
export const SwapBuilderApp: React.FC<SwapBuilderProps> = ({ webAPI, recordId, userId }) => {
  const styles = useStyles();
  const id = cleanId(recordId);
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [chosen, setChosen] = React.useState<Side>("A");
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const onSaved = (): void => setReloadKey((k) => k + 1);
    window.addEventListener(ITEMS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(ITEMS_SAVED_EVENT, onSaved);
  }, []);

  React.useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const uid = cleanId(userId);
        // Role query mirrors UserRoleHelper: direct OR team-derived roles.
        const roleQuery = uid
          ? webAPI.retrieveMultipleRecords(
              "role",
              "?$select=name&$filter=" +
                `systemuserroles_association/any(o:o/systemuserid eq ${uid})` +
                ` or teamroles_association/any(t:t/teammembership_association/any(m:m/systemuserid eq ${uid}))`
            )
          : Promise.resolve({ entities: [] as ComponentFramework.WebApi.Entity[], nextLink: "" });
        const userQuery = uid
          ? webAPI.retrieveRecord("systemuser", uid, "?$select=_businessunitid_value")
          : Promise.resolve({} as ComponentFramework.WebApi.Entity);
        const [rec, roles, user, legs, reductions, increases] = await Promise.all([
          webAPI.retrieveRecord(
            SWAP,
            id,
            "?$select=statecode,book_newfiscalyear,_book_statea_value,_book_stateb_value," +
              "book_stateaapproved,book_statebapproved,book_beapproved"
          ),
          roleQuery,
          userQuery,
          loadLegs(webAPI, id),
          loadAdjustments(webAPI, id, "reduction"),
          loadAdjustments(webAPI, id, "increase"),
        ]);
        const stateRef = (attr: string): StateRef | null =>
          rec[`_${attr}_value`]
            ? { id: cleanId(rec[`_${attr}_value`]), name: (rec[`_${attr}_value${FV}`] as string) ?? "" }
            : null;
        const stateA = stateRef("book_statea");
        const stateB = stateRef("book_stateb");
        const buOf = async (s: StateRef | null): Promise<string> =>
          s ? cleanId((await webAPI.retrieveRecord(STATE, s.id, "?$select=_owningbusinessunit_value"))._owningbusinessunit_value) : "";
        const [stateABu, stateBBu] = await Promise.all([buOf(stateA), buOf(stateB)]);
        if (cancelled) return;
        setData({
          active: num(rec.statecode) === STATECODE_ACTIVE,
          approved: rec.book_stateaapproved === true || rec.book_statebapproved === true || rec.book_beapproved === true,
          fy: rec.book_newfiscalyear == null ? null : num(rec.book_newfiscalyear),
          stateA,
          stateB,
          stateABu,
          stateBBu,
          userBu: cleanId(user._businessunitid_value),
          isAdmin: roles.entities.some((r) => ADMIN_ROLES.includes(r.name as string)),
          legs,
          reductions,
          increases,
        });
        setError(null);
      } catch (e) {
        if (!cancelled) setError(errorText(e, "Could not load the State Swap."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, id, userId, reloadKey]);

  const wrap = (child: React.ReactNode): React.ReactElement => (
    <FluentProvider theme={webLightTheme} style={{ width: "100%" }}>
      <div className={styles.root}>{child}</div>
    </FluentProvider>
  );
  const message = (intent: "info" | "warning" | "error", text: string): React.ReactElement => (
    <MessageBar intent={intent}>
      <MessageBarBody>{text}</MessageBarBody>
    </MessageBar>
  );

  if (!id) return wrap(message("info", "Save the State Swap first (Name, Fiscal Year, State A and State B), then build its legs here."));
  if (loading && !data) return wrap(<Spinner size="tiny" label="Loading..." />);
  if (error || !data) return wrap(message("error", error ?? "Could not load the State Swap."));
  if (data.fy == null) return wrap(message("info", "Set the Fiscal Year and save, then build the swap here."));
  if (data.fy < FIRST_PF_LEG_FY) return wrap(message("info", "FY26 State Swaps use the Swap Items grid below."));
  if (!data.stateA || !data.stateB) return wrap(message("info", "Set State A and State B and save, then build the swap here."));

  const stateA = data.stateA;
  const stateB = data.stateB;
  const roleSide: Side | null =
    data.userBu && data.userBu === data.stateABu ? "A" : data.userBu && data.userBu === data.stateBBu ? "B" : null;
  const side: Side | null = roleSide ?? (data.isAdmin ? chosen : null);
  const editable = data.active && !data.approved && side !== null;
  // The listener above reloads this control too (and the approval bar re-reads readiness).
  const done = (): void => {
    window.dispatchEvent(new CustomEvent(ITEMS_SAVED_EVENT, { detail: { id } }));
  };

  if (!editable) {
    return wrap(
      <>
        {!data.active || data.approved
          ? message(
              "warning",
              "A state has approved this swap (or it has been processed), so its legs are locked. A denial re-opens editing."
            )
          : message("info", `Only ${stateA.name} and ${stateB.name} users can edit this swap.`)}
        <Summary legs={data.legs} reductions={data.reductions} increases={data.increases} stateA={stateA} stateB={stateB} />
      </>
    );
  }

  const mine = side === "A" ? stateA : stateB;
  const other = side === "A" ? stateB : stateA;
  return wrap(
    <>
      {roleSide === null && (
        <div className={styles.balanceRow}>
          <Text className={styles.heading}>Act for</Text>
          <RadioGroup layout="horizontal" value={chosen} onChange={(_, d) => setChosen(d.value as Side)}>
            <Radio value="A" label={`State A — ${stateA.name}`} />
            <Radio value="B" label={`State B — ${stateB.name}`} />
          </RadioGroup>
        </div>
      )}
      <SendSide
        key={`send-${side}-${reloadKey}`}
        webAPI={webAPI}
        swapId={id}
        fiscalYear={data.fy}
        myState={mine}
        otherState={other}
        myLegs={data.legs.filter((l) => l.debitStateId === mine.id)}
        myReductions={data.reductions.filter((a) => a.stateId === mine.id)}
        onSaved={done}
      />
      <Divider />
      <ReceiveSide
        key={`receive-${side}-${reloadKey}`}
        webAPI={webAPI}
        swapId={id}
        fiscalYear={data.fy}
        myState={mine}
        otherState={other}
        incoming={data.legs.filter((l) => l.debitStateId === other.id)}
        myIncreases={data.increases.filter((a) => a.stateId === mine.id)}
        onSaved={done}
      />
    </>
  );
};

/** Read-only view of every leg and detail adjustment, both directions. */
const Summary: React.FC<{
  legs: Leg[];
  reductions: Adjustment[];
  increases: Adjustment[];
  stateA: StateRef;
  stateB: StateRef;
}> = ({ legs, reductions, increases, stateA, stateB }) => {
  const styles = useStyles();
  const direction = (from: StateRef, to: StateRef): React.ReactElement | null => {
    const rows = legs.filter((l) => l.debitStateId === from.id);
    if (rows.length === 0) return null;
    return (
      <div className={styles.section}>
        <Text className={styles.heading}>
          {from.name} sends {money(rows.reduce((s, l) => s + l.amount, 0))} to {to.name}
        </Text>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>From</th>
              <th className={styles.th}>Fund / PG</th>
              <th className={styles.th}>Amount</th>
              <th className={styles.th}>Lands on</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td className={styles.td}>
                  {l.debitPrioName}
                  <br />
                  <span className={styles.muted}>{l.debitLine}</span>
                </td>
                <td className={styles.td}>{l.fundPg}</td>
                <td className={styles.td}>{money(l.amount)}</td>
                <td className={styles.td}>
                  {l.creditPfId ? (
                    <>
                      {l.creditPrioName}
                      <br />
                      <span className={styles.muted}>{l.creditLine}</span>
                    </>
                  ) : (
                    <span className={styles.muted}>Not chosen yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };
  const adjustments = (title: string, rows: Adjustment[], sign: string): React.ReactElement | null =>
    rows.length === 0 ? null : (
      <div className={styles.section}>
        <Text className={styles.heading}>{title}</Text>
        <table className={styles.table}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={styles.td}>{r.detailLabel}</td>
                <td className={styles.td}>
                  {sign}
                  {money(r.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (legs.length === 0) return <Text>No swap legs saved yet.</Text>;
  return (
    <>
      {direction(stateA, stateB)}
      {direction(stateB, stateA)}
      {adjustments("Itemized Detail reductions", reductions, "−")}
      {adjustments("Itemized Detail increases", increases, "+")}
    </>
  );
};
