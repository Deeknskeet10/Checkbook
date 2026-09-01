import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  shorthands,
  tokens,
  Button,
  Input,
  Spinner,
  Text,
} from "@fluentui/react-components";

type WebApi = ComponentFramework.WebApi;

export interface StateSpendPlanGridProps {
  webAPI: WebApi;
  isDisabled: boolean;
  width: number;
  /** GUID of the book_state to plan (from the host page). */
  stateId: string | null;
  /** Fiscal year (calendar year, e.g. 2027) from the host page. */
  fiscalYear: number | null;
}

const SPEND_PLAN_ENTITY = "book_spendplan";
const PF_ENTITY = "book_prioritizationfunding";
const PRIORITIZATION_ENTITY = "book_prioritization";
const FUNDING_LINE_ENTITY = "book_fundingline";
const STATE_ENTITY = "book_state";

const FV = "@OData.Community.Display.V1.FormattedValue";

/** book_spendplanmode = State-Rollup. */
const MODE_STATE_ROLLUP = 1;

const MONTHS: { label: string; col: string }[] = [
  { label: "Oct", col: "book_newoctober" },
  { label: "Nov", col: "book_newnovember" },
  { label: "Dec", col: "book_newdecember" },
  { label: "Jan", col: "book_newjanuary" },
  { label: "Feb", col: "book_newfebruary" },
  { label: "Mar", col: "book_newmarch" },
  { label: "Apr", col: "book_newapril" },
  { label: "May", col: "book_newmay" },
  { label: "Jun", col: "book_newjune" },
  { label: "Jul", col: "book_newjuly" },
  { label: "Aug", col: "book_newaugust" },
  { label: "Sep", col: "book_newseptember" },
];

const ROW_TYPE_PLANNED = 0;
const ROW_TYPE_ACTUAL = 1;
type RowType = typeof ROW_TYPE_PLANNED | typeof ROW_TYPE_ACTUAL;

const MIN_FISCAL_YEAR = 2027;

/** One (Fund, SAG) bucket for the state + FY. */
interface Bucket {
  key: string;
  fundId: string;
  fundName: string;
  sagId: string;
  sagName: string;
  /** Rollup of the state's State-Rollup PF funded amounts at this Fund/SAG. */
  funded: number;
}

/** A stored book_spendplan row (FY27 Mode-C shape). */
interface SpRecord {
  id: string;
  fundId: string;
  sagId: string;
  fundName: string;
  sagName: string;
  rowType: RowType;
  months: (number | null)[];
}

const useStyles = makeStyles({
  root: {
    ...shorthands.padding("8px"),
    fontFamily: tokens.fontFamilyBase,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: "4px",
    ...shorthands.padding("4px", "2px", "8px", "2px"),
  },
  toolbarButtons: {
    display: "flex",
    columnGap: "8px",
    alignItems: "center",
  },
  banner: {
    ...shorthands.padding("6px", "10px"),
    marginBottom: "8px",
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
  },
  bannerError: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
  },
  bannerSuccess: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    color: tokens.colorPaletteGreenForeground1,
  },
  scrollContainer: {
    width: "100%",
    overflowX: "auto",
  },
  table: {
    borderCollapse: "collapse",
    width: "100%",
    fontSize: tokens.fontSizeBase200,
  },
  th: {
    textAlign: "center",
    whiteSpace: "nowrap",
    fontWeight: tokens.fontWeightSemibold,
    ...shorthands.padding("4px", "6px"),
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  thBand: {
    textAlign: "left",
    minWidth: "220px",
  },
  td: {
    ...shorthands.padding("2px", "4px"),
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    whiteSpace: "nowrap",
  },
  tdNum: {
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    minWidth: "86px",
  },
  bandLabel: {
    ...shorthands.padding("2px", "6px"),
    whiteSpace: "nowrap",
  },
  sectionRow: {
    backgroundColor: tokens.colorNeutralBackground3,
    fontWeight: tokens.fontWeightSemibold,
  },
  sectionCell: {
    ...shorthands.padding("6px"),
  },
  monthInput: {
    minWidth: "84px",
    width: "84px",
  },
  lockedCell: {
    color: tokens.colorNeutralForeground3,
  },
  varianceOver: {
    color: tokens.colorPaletteRedForeground1,
  },
  varianceUnder: {
    color: tokens.colorNeutralForeground3,
  },
  matchBadge: {
    marginLeft: "10px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightRegular,
  },
  matchOk: {
    color: tokens.colorPaletteGreenForeground1,
  },
  matchOff: {
    color: tokens.colorPaletteDarkOrangeForeground1,
  },
  empty: {
    ...shorthands.padding("16px"),
    color: tokens.colorNeutralForeground3,
  },
});

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function num(value: unknown): number {
  return toNumber(value) ?? 0;
}

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function stripGuid(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value.replace(/[{}]/g, "").toLowerCase();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const bucketKey = (fundId: string, sagId: string): string =>
  `${fundId}|${sagId}`;

const cellKey = (bKey: string, rowType: RowType, idx: number): string =>
  `${bKey}|${rowType}|${idx}`;

const groupKey = (bKey: string, rowType: RowType): string =>
  `${bKey}|${rowType}`;

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/** True when the given FY month (0 = Oct … 11 = Sep) is fully past. */
function monthPassed(fiscalYear: number, idx: number): boolean {
  const calYear = idx < 3 ? fiscalYear - 1 : fiscalYear;
  const monthNum = (idx + 9) % 12; // Oct=9 … Sep=8
  return new Date() >= new Date(calYear, monthNum + 1, 1);
}

export const StateSpendPlanGridApp: React.FC<StateSpendPlanGridProps> = (
  props
) => {
  const { webAPI, isDisabled } = props;
  const styles = useStyles();
  const stateId = props.stateId ? stripGuid(props.stateId) : null;
  const fiscalYear = props.fiscalYear ?? null;

  const [stateLabel, setStateLabel] = React.useState<string>("");
  const [pfBuckets, setPfBuckets] = React.useState<Bucket[] | null>(null);
  const [spRecords, setSpRecords] = React.useState<SpRecord[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const isFy27Plus = fiscalYear !== null && fiscalYear >= MIN_FISCAL_YEAR;

  // ----- Load buckets (rollup) + existing rows -----
  React.useEffect(() => {
    if (!stateId || !isFy27Plus) return;
    let cancelled = false;
    setLoadError(null);
    setPfBuckets(null);
    setSpRecords(null);

    void (async () => {
      try {
        const st = await webAPI.retrieveRecord(
          STATE_ENTITY,
          stateId,
          "?$select=book_name,book_abbreviation"
        );
        if (cancelled) return;
        setStateLabel(
          (st.book_abbreviation as string) || (st.book_name as string) || ""
        );

        // 1. Prioritizations in this state + FY (direct columns).
        const prios = await webAPI.retrieveMultipleRecords(
          PRIORITIZATION_ENTITY,
          "?$select=book_prioritizationid" +
            `&$filter=_book_state_value eq ${stateId} and book_newfiscalyear eq ${fiscalYear} and statecode eq 0`
        );
        const prioIds = prios.entities
          .map((e) => stripGuid(e.book_prioritizationid))
          .filter((id): id is string => !!id);

        // 2. Their State-Rollup PFs (chunked to keep the URL bounded).
        const pfRows: { funded: number; loaId: string }[] = [];
        for (const ids of chunk(prioIds, 30)) {
          const orFilter = ids
            .map((id) => `_book_prioritization_value eq ${id}`)
            .join(" or ");
          const res = await webAPI.retrieveMultipleRecords(
            PF_ENTITY,
            "?$select=book_fundedamount,_book_lineofaccounting_value" +
              `&$filter=book_spendplanmode eq ${MODE_STATE_ROLLUP} and statecode eq 0 and (${orFilter})`
          );
          for (const e of res.entities) {
            const loaId = stripGuid(e._book_lineofaccounting_value);
            if (loaId)
              pfRows.push({ funded: num(e.book_fundedamount), loaId });
          }
        }
        if (cancelled) return;

        // 3. Distinct LOAs → Fund/SAG (+ names).
        const loaIds = Array.from(new Set(pfRows.map((p) => p.loaId)));
        const loaMap = new Map<
          string,
          { fundId: string; fundName: string; sagId: string; sagName: string }
        >();
        for (const ids of chunk(loaIds, 30)) {
          const orFilter = ids
            .map((id) => `book_fundinglineid eq ${id}`)
            .join(" or ");
          const res = await webAPI.retrieveMultipleRecords(
            FUNDING_LINE_ENTITY,
            "?$select=book_fundinglineid,_book_fund_value,_book_sag_value" +
              `&$filter=${orFilter}`
          );
          for (const e of res.entities) {
            const id = stripGuid(e.book_fundinglineid);
            if (!id) continue;
            loaMap.set(id, {
              fundId: stripGuid(e._book_fund_value) ?? "",
              fundName: (e[`_book_fund_value${FV}`] as string) ?? "",
              sagId: stripGuid(e._book_sag_value) ?? "",
              sagName: (e[`_book_sag_value${FV}`] as string) ?? "",
            });
          }
        }
        if (cancelled) return;

        // 4. Group PF funded by (Fund, SAG).
        const byBucket = new Map<string, Bucket>();
        for (const pf of pfRows) {
          const loa = loaMap.get(pf.loaId);
          if (!loa?.fundId || !loa.sagId) continue;
          const key = bucketKey(loa.fundId, loa.sagId);
          const existing = byBucket.get(key);
          if (existing) existing.funded += pf.funded;
          else
            byBucket.set(key, {
              key,
              fundId: loa.fundId,
              fundName: loa.fundName,
              sagId: loa.sagId,
              sagName: loa.sagName,
              funded: pf.funded,
            });
        }
        setPfBuckets(Array.from(byBucket.values()));

        // 5. Existing Mode-C spend plan rows for this state + FY.
        const monthCols = MONTHS.map((m) => m.col).join(",");
        const spRes = await webAPI.retrieveMultipleRecords(
          SPEND_PLAN_ENTITY,
          `?$select=book_spendplanid,_book_fund_value,_book_sag_value,book_rowtype,${monthCols}` +
            `&$filter=_book_state_value eq ${stateId} and book_newfiscalyear eq ${fiscalYear} and statecode eq 0`
        );
        if (cancelled) return;
        setSpRecords(
          spRes.entities.map((e) => ({
            id: e.book_spendplanid as string,
            fundId: stripGuid(e._book_fund_value) ?? "",
            sagId: stripGuid(e._book_sag_value) ?? "",
            fundName: (e[`_book_fund_value${FV}`] as string) ?? "",
            sagName: (e[`_book_sag_value${FV}`] as string) ?? "",
            rowType:
              toNumber(e.book_rowtype) === ROW_TYPE_ACTUAL
                ? ROW_TYPE_ACTUAL
                : ROW_TYPE_PLANNED,
            months: MONTHS.map((m) => toNumber(e[m.col])),
          }))
        );
      } catch (e) {
        if (!cancelled)
          setLoadError(
            (e as { message?: string })?.message ??
              "Could not load the state spend plan."
          );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stateId, fiscalYear, isFy27Plus, webAPI, reloadKey]);

  const recordMap = React.useMemo(() => {
    const map = new Map<string, SpRecord>();
    (spRecords ?? []).forEach((r) =>
      map.set(groupKey(bucketKey(r.fundId, r.sagId), r.rowType), r)
    );
    return map;
  }, [spRecords]);

  // Union PF-derived buckets with any stored rows' buckets (so data never hides).
  const buckets = React.useMemo<Bucket[]>(() => {
    const byKey = new Map<string, Bucket>();
    (pfBuckets ?? []).forEach((b) => byKey.set(b.key, { ...b }));
    (spRecords ?? []).forEach((r) => {
      const key = bucketKey(r.fundId, r.sagId);
      if (!byKey.has(key))
        byKey.set(key, {
          key,
          fundId: r.fundId,
          fundName: r.fundName,
          sagId: r.sagId,
          sagName: r.sagName,
          funded: 0,
        });
    });
    return Array.from(byKey.values()).sort((a, b) =>
      `${a.fundName} ${a.sagName}`.localeCompare(`${b.fundName} ${b.sagName}`)
    );
  }, [pfBuckets, spRecords]);

  // ----- Edits -----
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState(false);

  const canEdit = !isDisabled && isFy27Plus && !!stateId;

  const storedCell = React.useCallback(
    (bKey: string, rowType: RowType, idx: number): number | null =>
      recordMap.get(groupKey(bKey, rowType))?.months[idx] ?? null,
    [recordMap]
  );

  const effectiveCell = React.useCallback(
    (bKey: string, rowType: RowType, idx: number): number | null => {
      const pending = edits[cellKey(bKey, rowType, idx)];
      if (pending !== undefined) return toNumber(pending);
      return storedCell(bKey, rowType, idx);
    },
    [edits, storedCell]
  );

  const cellDisplay = (bKey: string, rowType: RowType, idx: number): string => {
    const pending = edits[cellKey(bKey, rowType, idx)];
    if (pending !== undefined) return pending;
    const stored = storedCell(bKey, rowType, idx);
    return stored === null ? "" : String(stored);
  };

  const onCellChange = (
    bKey: string,
    rowType: RowType,
    idx: number,
    value: string
  ): void => {
    setSaveSuccess(false);
    setEdits((prev) => ({ ...prev, [cellKey(bKey, rowType, idx)]: value }));
  };

  const hasEdits = React.useMemo(() => {
    return Object.entries(edits).some(([key, value]) => {
      const [fundId, sagId, rowType, idx] = key.split("|");
      return (
        toNumber(value) !==
        storedCell(bucketKey(fundId, sagId), Number(rowType) as RowType, Number(idx))
      );
    });
  }, [edits, storedCell]);

  const onDiscard = (): void => {
    setEdits({});
    setSaveError(null);
    setSaveSuccess(false);
  };

  const onSave = async (): Promise<void> => {
    if (!hasEdits || saving || !stateId || fiscalYear === null) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const groups = new Map<
      string,
      { bKey: string; rowType: RowType; changes: Record<string, number | null> }
    >();
    for (const [key, value] of Object.entries(edits)) {
      // key = fundId|sagId|rowType|idx
      const [fundId, sagId, rowTypeStr, idxStr] = key.split("|");
      const bKey = bucketKey(fundId, sagId);
      const rowType = Number(rowTypeStr) as RowType;
      const idx = Number(idxStr);
      const newValue = toNumber(value);
      if (newValue === storedCell(bKey, rowType, idx)) continue;
      const gk = groupKey(bKey, rowType);
      const group = groups.get(gk) ?? { bKey, rowType, changes: {} };
      group.changes[MONTHS[idx].col] = newValue;
      groups.set(gk, group);
    }

    try {
      for (const group of groups.values()) {
        const existing = recordMap.get(groupKey(group.bKey, group.rowType));
        if (existing) {
          await webAPI.updateRecord(
            SPEND_PLAN_ENTITY,
            existing.id,
            group.changes
          );
        } else {
          const bucket = buckets.find((b) => b.key === group.bKey);
          if (!bucket) continue;
          const payload: Record<string, unknown> = {
            ...group.changes,
            // Mode-C rows anchor on State + Fund + SAG; PF / RF / Prio stay empty.
            "book_State@odata.bind": `/book_states(${stateId})`,
            "book_Fund@odata.bind": `/book_funds(${bucket.fundId})`,
            "book_Sag@odata.bind": `/book_sags(${bucket.sagId})`,
            book_newfiscalyear: fiscalYear,
            book_rowtype: group.rowType,
            book_name: `FY${fiscalYear}-${stateLabel || "State"}-${
              bucket.fundName || "Fund"
            }-${bucket.sagName || "SAG"}-Rollup-${
              group.rowType === ROW_TYPE_ACTUAL ? "Actual" : "Planned"
            }`,
          };
          await webAPI.createRecord(SPEND_PLAN_ENTITY, payload);
        }
      }
      setEdits({});
      setSaveSuccess(true);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setSaveError(
        (e as { message?: string })?.message ??
          "Some Spend Plan rows could not be saved."
      );
    } finally {
      setSaving(false);
    }
  };

  // ----- Derived totals -----
  const bandTotal = React.useCallback(
    (bKey: string, rowType: RowType): number =>
      MONTHS.reduce(
        (acc, _m, idx) => acc + (effectiveCell(bKey, rowType, idx) ?? 0),
        0
      ),
    [effectiveCell]
  );

  // ----- Cells -----
  const monthCell = (
    bKey: string,
    rowType: RowType,
    idx: number
  ): React.ReactNode => {
    const passed = fiscalYear !== null && monthPassed(fiscalYear, idx);
    const editable =
      canEdit && (rowType === ROW_TYPE_PLANNED ? !passed : passed);
    if (!editable) {
      const value = effectiveCell(bKey, rowType, idx);
      const locked = rowType === ROW_TYPE_PLANNED ? passed : !passed;
      const label =
        value === null ? (locked ? "—" : "") : formatCurrency(value);
      return (
        <span className={locked ? styles.lockedCell : undefined}>{label}</span>
      );
    }
    return (
      <Input
        type="number"
        size="small"
        appearance="filled-lighter"
        className={styles.monthInput}
        value={cellDisplay(bKey, rowType, idx)}
        onChange={(_e, data) => onCellChange(bKey, rowType, idx, data.value)}
        input={{
          style: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
        }}
      />
    );
  };

  const varianceCell = (bKey: string, idx: number): React.ReactNode => {
    const planned = effectiveCell(bKey, ROW_TYPE_PLANNED, idx) ?? 0;
    const actual = effectiveCell(bKey, ROW_TYPE_ACTUAL, idx);
    if (fiscalYear === null || !monthPassed(fiscalYear, idx) || actual === null)
      return <span>—</span>;
    const variance = actual - planned;
    const cls =
      variance > 0.005
        ? styles.varianceOver
        : variance < -0.005
          ? styles.varianceUnder
          : undefined;
    return <span className={cls}>{formatCurrency(variance)}</span>;
  };

  const bandRows = (bucket: Bucket): React.ReactNode => (
    <>
      <tr>
        <td className={`${styles.td} ${styles.bandLabel}`}>Planned</td>
        {MONTHS.map((_m, idx) => (
          <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
            {monthCell(bucket.key, ROW_TYPE_PLANNED, idx)}
          </td>
        ))}
        <td className={`${styles.td} ${styles.tdNum}`}>
          {formatCurrency(bandTotal(bucket.key, ROW_TYPE_PLANNED))}
        </td>
      </tr>
      <tr>
        <td className={`${styles.td} ${styles.bandLabel}`}>Actual</td>
        {MONTHS.map((_m, idx) => (
          <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
            {monthCell(bucket.key, ROW_TYPE_ACTUAL, idx)}
          </td>
        ))}
        <td className={`${styles.td} ${styles.tdNum}`}>
          {formatCurrency(bandTotal(bucket.key, ROW_TYPE_ACTUAL))}
        </td>
      </tr>
      <tr>
        <td className={`${styles.td} ${styles.bandLabel}`}>Variance</td>
        {MONTHS.map((_m, idx) => (
          <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
            {varianceCell(bucket.key, idx)}
          </td>
        ))}
        <td className={`${styles.td} ${styles.tdNum}`} />
      </tr>
    </>
  );

  const loading = isFy27Plus && (pfBuckets === null || spRecords === null);

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root} style={{ width: props.width || undefined }}>
        <div className={styles.toolbar}>
          <Text weight="semibold">
            State Spend Plan{stateLabel ? ` — ${stateLabel}` : ""}
            {fiscalYear !== null ? ` (FY ${fiscalYear})` : ""}
          </Text>
          <div className={styles.toolbarButtons}>
            <Button
              appearance="primary"
              size="small"
              disabled={!canEdit || !hasEdits || saving}
              onClick={() => void onSave()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              size="small"
              disabled={!hasEdits || saving}
              onClick={onDiscard}
            >
              Discard
            </Button>
            <Button
              size="small"
              appearance="subtle"
              disabled={saving}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Refresh
            </Button>
          </div>
        </div>

        {loadError && (
          <div className={`${styles.banner} ${styles.bannerError}`}>
            {loadError}
          </div>
        )}
        {saveError && (
          <div className={`${styles.banner} ${styles.bannerError}`}>
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className={`${styles.banner} ${styles.bannerSuccess}`}>
            Spend Plan saved.
          </div>
        )}

        {!stateId || fiscalYear === null ? (
          <div className={styles.empty}>
            Open this page for a state and fiscal year to see its rollup spend
            plan.
          </div>
        ) : !isFy27Plus ? (
          <div className={styles.empty}>
            State rollup spend plans cover FY {MIN_FISCAL_YEAR} and later.
          </div>
        ) : loading ? (
          <Spinner label="Loading state spend plan…" />
        ) : buckets.length === 0 ? (
          <div className={styles.empty}>
            No distributed, non-breakout funding rolls up for {stateLabel || "this state"} in FY {fiscalYear} yet.
          </div>
        ) : (
          <div className={styles.scrollContainer}>
            <table className={styles.table} aria-label="State Spend Plan">
              <thead>
                <tr>
                  <th className={`${styles.th} ${styles.thBand}`} />
                  {MONTHS.map((m) => (
                    <th key={m.col} className={styles.th}>
                      {m.label}
                    </th>
                  ))}
                  <th className={styles.th}>Total</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((bucket) => {
                  const planned = bandTotal(bucket.key, ROW_TYPE_PLANNED);
                  const matches = nearlyEqual(planned, bucket.funded);
                  return (
                    <React.Fragment key={bucket.key}>
                      <tr className={styles.sectionRow}>
                        <td
                          className={`${styles.td} ${styles.sectionCell}`}
                          colSpan={MONTHS.length + 2}
                        >
                          {bucket.fundName || "Fund"} / {bucket.sagName || "SAG"}{" "}
                          — Planned {formatCurrency(planned)} / Funded{" "}
                          {formatCurrency(bucket.funded)}
                          <span
                            className={`${styles.matchBadge} ${
                              matches ? styles.matchOk : styles.matchOff
                            }`}
                          >
                            {matches ? "✓ matches" : "✎ in progress"}
                          </span>
                        </td>
                      </tr>
                      {bandRows(bucket)}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
