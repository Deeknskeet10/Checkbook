import * as React from "react";
import { Text } from "@fluentui/react-components";
import { num, money, cleanId, useStyles } from "./shared";

/**
 * Per-line TDP / AFP / Allotment entry, shared by both Turn-In types. TDP is required;
 * AFP and Allotment are optional — blank means "size it automatically"
 * (TurnInItemAmountCalculator: TDP × the line's Fund/PG percentage); a value is saved with
 * its override flag so the plugin keeps it as entered.
 */
export interface LineAmounts {
  amount: string;
  afp: string; // "" = auto
  allot: string; // "" = auto
}

export function lineAmountFields(l: LineAmounts): Record<string, unknown> {
  const afpSet = l.afp.trim() !== "";
  const allotSet = l.allot.trim() !== "";
  const fields: Record<string, unknown> = {
    book_newturninamount: num(l.amount),
    book_afpoverridden: afpSet,
    book_allotmentoverridden: allotSet,
  };
  if (afpSet) fields.book_afpamount = num(l.afp);
  if (allotSet) fields.book_allotmentamount = num(l.allot);
  return fields;
}

export const SAVED_LINE_SELECT =
  "book_newturninamount,book_afpamount,book_allotmentamount,book_afpoverridden,book_allotmentoverridden";

export interface SavedLine {
  id: string;
  label: string;
  amount: number;
  afp: number;
  allot: number;
  afpOverridden: boolean;
  allotOverridden: boolean;
}

export function readSavedLine(e: Record<string, unknown>): SavedLine {
  return {
    id: cleanId(e.book_turninitemsid),
    label: "",
    amount: num(e.book_newturninamount),
    afp: num(e.book_afpamount),
    allot: num(e.book_allotmentamount),
    afpOverridden: e.book_afpoverridden === true,
    allotOverridden: e.book_allotmentoverridden === true,
  };
}

/** Totals row: TDP / AFP / Allotment. `entered` = edit mode, where blank AFP/Allotment are auto. */
export const AmountTotals: React.FC<{
  styles: ReturnType<typeof useStyles>;
  tdp: number;
  afp: number;
  allot: number;
  entered?: boolean;
}> = ({ styles, tdp, afp, allot, entered }) => (
  <div className={styles.balanceRow}>
    <Text>
      Turn-In total — TDP <b>{money(tdp)}</b> · AFP <b>{money(afp)}</b> · Allotment <b>{money(allot)}</b>
      {entered ? " (AFP / Allotment entered; blank lines are sized automatically on save)" : ""}
    </Text>
  </div>
);
