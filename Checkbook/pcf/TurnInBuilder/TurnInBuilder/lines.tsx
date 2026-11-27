import * as React from "react";
import { mergeClasses } from "@fluentui/react-components";
import { num, money, moneyShort, cleanId, useStyles } from "./shared";
import { MoneyInput } from "./designSystem";

/**
 * Per-line TDP / AFP / Allotment entry, shared by both Turn-In types. TDP is required;
 * AFP and Allotment are optional — blank means "size it automatically"
 * (TurnInItemAmountCalculator: TDP × the line's Fund/PG percentage); a value is saved with
 * its override flag so the plugin keeps it as entered.
 */
/**
 * Temporarily off: AFP / Allotment entry is a future feature. While false the inputs, columns
 * and totals are hidden; new lines save with blank AFP / Allotment, so they are sized
 * automatically. An override already saved on a line is kept when that line is edited.
 * Set to true to bring the AFP / Allotment UI back in both builders.
 */
export const SHOW_AFP_ALLOT = false;

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

/**
 * Money box (Design Documentation §6.2) over the builders' string state: "" = blank.
 * `live` so totals, balance badges and the Save button track typing.
 */
export const AmountInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label": string;
}> = ({ value, onChange, disabled, "aria-label": ariaLabel }) => {
  const styles = useStyles();
  return (
    <MoneyInput
      live
      aria-label={ariaLabel}
      className={styles.amtInput}
      disabled={disabled}
      value={value.trim() === "" ? null : num(value)}
      onCommit={(v) => onChange(v === null ? "" : String(v))}
    />
  );
};

/**
 * Figure card: 13px title, 20px short amount ($1.00M), 14px exact amount beneath.
 * `tone` tints it: available = blue, success = green, warning = yellow; default grey.
 */
export const FigureCard: React.FC<{
  title: string;
  value: number;
  tone?: "neutral" | "available" | "success" | "warning";
}> = ({ title, value, tone = "neutral" }) => {
  const styles = useStyles();
  return (
    <div
      className={mergeClasses(
        styles.card,
        tone === "available" && styles.cardAvailable,
        tone === "success" && styles.cardSuccess,
        tone === "warning" && styles.cardWarning,
      )}
    >
      <span className={styles.cardTitle}>{title}</span>
      <span className={styles.cardValue}>{moneyShort(value)}</span>
      <span className={styles.cardSub}>{money(value)}</span>
    </div>
  );
};

/** Totals bar: TDP / AFP / Allotment. `entered` = edit mode, where blank AFP/Allotment are auto. */
export const AmountTotals: React.FC<{
  styles: ReturnType<typeof useStyles>;
  tdp: number;
  afp: number;
  allot: number;
  entered?: boolean;
}> = ({ styles, tdp, afp, allot, entered }) => (
  <div className={styles.totals}>
    <span>Turn-In Total</span>
    <span className={styles.spacer} />
    {SHOW_AFP_ALLOT ? (
      <span className={styles.num}>
        TDP {money(tdp)} · AFP {money(afp)} · Allotment {money(allot)}
        {entered && (
          <span className={mergeClasses(styles.muted)}>
            {" "}
            (blank AFP / Allotment sized on save)
          </span>
        )}
      </span>
    ) : (
      <span className={styles.num}>TDP {money(tdp)}</span>
    )}
  </div>
);
