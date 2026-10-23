import * as React from "react";
import { Badge, Input, MessageBar, MessageBarBody, Text } from "@fluentui/react-components";
import { DetailRow, EPS, num, money, useStyles } from "./shared";

/**
 * Itemized Detail grid for one Prioritization. Reductions (sending side) and increases
 * (receiving side) are Prio-level amounts: they must total exactly what the Prioritization
 * sends / receives across all its legs, but which detail pairs with which line doesn't
 * matter (docs/StateSwap-FY27-Redesign.md §2). SwapRules enforces the same at approval.
 */
export type DetailMode = "reduce" | "increase";

export const detailTotal = (rows: DetailRow[]): number => rows.reduce((s, r) => s + num(r.value), 0);
export const detailInvalid = (rows: DetailRow[], mode: DetailMode): boolean =>
  rows.some((r) => num(r.value) < 0 || (mode === "reduce" && num(r.value) > r.funded + EPS));
export const detailBalanced = (rows: DetailRow[], required: number): boolean =>
  Math.abs(detailTotal(rows) - required) < EPS;

export const DetailGrid: React.FC<{
  mode: DetailMode;
  rows: DetailRow[];
  required: number;
  editable: boolean;
  onChange: (detailId: string, value: string) => void;
}> = ({ mode, rows, required, editable, onChange }) => {
  const styles = useStyles();
  const entered = detailTotal(rows);
  const left = required - entered;
  const verb = mode === "reduce" ? "Reduce" : "Increase";
  return (
    <>
      <Text>
        Itemized: {verb.toLowerCase()} its details by a total of <b>{money(required)}</b>
        {mode === "reduce" ? " (Funded and Requested drop together)." : "."}
      </Text>
      {rows.length === 0 ? (
        <Text className={styles.muted}>This Prioritization has no Itemized Details.</Text>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Item · TDC · MDEP</th>
              <th className={styles.th}>Detail #</th>
              <th className={styles.th}>Funded</th>
              <th className={styles.th}>Requested</th>
              <th className={styles.th}>{verb} by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={styles.td}>{r.label}</td>
                <td className={styles.td}>{r.name}</td>
                <td className={styles.td}>{money(r.funded)}</td>
                <td className={styles.td}>{money(r.requested)}</td>
                <td className={styles.td}>
                  {editable ? (
                    <Input
                      className={styles.amtInput}
                      type="number"
                      value={r.value}
                      onChange={(_, d) => onChange(r.id, d.value)}
                    />
                  ) : (
                    money(num(r.value))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {detailInvalid(rows, mode) && (
        <MessageBar intent="error">
          <MessageBarBody>
            {mode === "reduce"
              ? "A reduction is negative or exceeds the funding on that Itemized Detail."
              : "An increase is negative."}
          </MessageBarBody>
        </MessageBar>
      )}
      <div className={styles.balanceRow}>
        <Text>
          {mode === "reduce" ? "Reduced" : "Increased"} <b>{money(entered)}</b> of <b>{money(required)}</b>
        </Text>
        {detailBalanced(rows, required) ? (
          <Badge color="success" appearance="tint">Balanced</Badge>
        ) : (
          <Badge color="warning" appearance="tint">
            {left > 0 ? `${money(left)} left to ${verb.toLowerCase()}` : `${money(-left)} over`}
          </Badge>
        )}
      </div>
    </>
  );
};
