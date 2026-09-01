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

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;

export interface RequirementSpendPlanGridProps {
  dataset: DataSet;
  webAPI: WebApi;
  isDisabled: boolean;
  width: number;
  /** Id of the parent Requirement record (the form's record). */
  requirementId: string | null;
}

/** Property-set aliases declared in ControlManifest.Input.xml. */
const ALIAS = {
  fundedAmount: "fundedAmount",
  fiscalYear: "fiscalYear",
} as const;

const SPEND_PLAN_ENTITY = "book_spendplan";
const REQUIREMENT_ENTITY = "book_requirements";

const FV = "@OData.Community.Display.V1.FormattedValue";

/** Federal FY months in order, with their FY27+ decimal column names. */
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

/** First fiscal year that uses this grid; earlier FYs keep the legacy page. */
const MIN_FISCAL_YEAR = 2027;

/** One Requirement Funding row (one per fiscal year). */
interface RfRow {
  id: string;
  funded: number;
  fiscalYear: number | null;
}

/** A stored book_spendplan row (FY27 Mode-A shape). */
interface SpRecord {
  id: string;
  rfId: string;
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
  bannerWarn: {
    backgroundColor: tokens.colorPaletteYellowBackground1,
    color: tokens.colorPaletteYellowForeground1,
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
    minWidth: "200px",
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

function parseFiscalYear(raw: unknown, label: string): number | null {
  const v = toNumber(
    typeof raw === "object" && raw !== null
      ? (raw as { Value?: number }).Value
      : raw
  );
  if (v !== null && v >= 1990 && v <= 2200) return v;
  const m = /(\d{4})/.exec(label);
  return m ? Number(m[1]) : null;
}

const cellKey = (rfId: string, rowType: RowType, monthIdx: number): string =>
  `${rfId}|${rowType}|${monthIdx}`;

const groupKey = (rfId: string, rowType: RowType): string =>
  `${rfId}|${rowType}`;

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/** True when the given FY month (0 = Oct … 11 = Sep) is fully past. */
function monthPassed(fiscalYear: number, idx: number): boolean {
  const calYear = idx < 3 ? fiscalYear - 1 : fiscalYear;
  const monthNum = (idx + 9) % 12; // Oct=9 … Sep=8
  return new Date() >= new Date(calYear, monthNum + 1, 1);
}

export const RequirementSpendPlanGridApp: React.FC<
  RequirementSpendPlanGridProps
> = (props) => {
  const { dataset, webAPI, isDisabled } = props;
  const styles = useStyles();
  const requirementId = props.requirementId
    ? stripGuid(props.requirementId)
    : null;

  // ----- RF rows (one per FY) straight from the bound subgrid dataset -----
  const rfRows = React.useMemo<RfRow[]>(() => {
    return dataset.sortedRecordIds
      .map((id) => {
        const r = dataset.records[id];
        return {
          id: stripGuid(id) ?? id,
          funded: num(r.getValue(ALIAS.fundedAmount)),
          fiscalYear: parseFiscalYear(
            r.getValue(ALIAS.fiscalYear),
            r.getFormattedValue(ALIAS.fiscalYear) || ""
          ),
        };
      })
      .sort((a, b) => (a.fiscalYear ?? 0) - (b.fiscalYear ?? 0));
  }, [dataset.sortedRecordIds, dataset.records]);

  const fy27Rfs = React.useMemo(
    () =>
      rfRows.filter(
        (rf) => rf.fiscalYear !== null && rf.fiscalYear >= MIN_FISCAL_YEAR
      ),
    [rfRows]
  );

  // ----- Server data -----
  const [isNational, setIsNational] = React.useState<boolean | null>(null);
  const [reqName, setReqName] = React.useState<string>("");
  const [spRecords, setSpRecords] = React.useState<SpRecord[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!requirementId) return;
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      try {
        const req = await webAPI.retrieveRecord(
          REQUIREMENT_ENTITY,
          requirementId,
          "?$select=book_national,book_name"
        );
        if (cancelled) return;
        setIsNational(req.book_national === true);
        setReqName((req.book_name as string) ?? "");
      } catch {
        if (!cancelled) setLoadError("Could not load the Requirement.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requirementId, webAPI, reloadKey]);

  React.useEffect(() => {
    const rfIds = fy27Rfs.map((r) => r.id);
    if (rfIds.length === 0) {
      setSpRecords([]);
      return;
    }
    let cancelled = false;
    const filter = rfIds
      .map((id) => `_book_requirementfunding_value eq ${id}`)
      .join(" or ");
    const monthCols = MONTHS.map((m) => m.col).join(",");
    const options =
      `?$select=book_spendplanid,_book_requirementfunding_value,book_rowtype,${monthCols}` +
      `&$filter=(${filter}) and statecode eq 0 and book_rowtype ne null`;

    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          SPEND_PLAN_ENTITY,
          options
        );
        if (cancelled) return;
        setSpRecords(
          res.entities.map((e) => ({
            id: e.book_spendplanid as string,
            rfId: stripGuid(e._book_requirementfunding_value) ?? "",
            rowType:
              toNumber(e.book_rowtype) === ROW_TYPE_ACTUAL
                ? ROW_TYPE_ACTUAL
                : ROW_TYPE_PLANNED,
            months: MONTHS.map((m) => toNumber(e[m.col])),
          }))
        );
      } catch {
        if (!cancelled) setLoadError("Could not load existing Spend Plan rows.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fy27Rfs, webAPI, reloadKey]);

  const recordMap = React.useMemo(() => {
    const map = new Map<string, SpRecord>();
    (spRecords ?? []).forEach((r) => map.set(groupKey(r.rfId, r.rowType), r));
    return map;
  }, [spRecords]);

  // ----- Edits -----
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState(false);

  const canEdit = !isDisabled && isNational === true;

  const storedCell = React.useCallback(
    (rfId: string, rowType: RowType, idx: number): number | null =>
      recordMap.get(groupKey(rfId, rowType))?.months[idx] ?? null,
    [recordMap]
  );

  const effectiveCell = React.useCallback(
    (rfId: string, rowType: RowType, idx: number): number | null => {
      const pending = edits[cellKey(rfId, rowType, idx)];
      if (pending !== undefined) return toNumber(pending);
      return storedCell(rfId, rowType, idx);
    },
    [edits, storedCell]
  );

  const cellDisplay = (rfId: string, rowType: RowType, idx: number): string => {
    const pending = edits[cellKey(rfId, rowType, idx)];
    if (pending !== undefined) return pending;
    const stored = storedCell(rfId, rowType, idx);
    return stored === null ? "" : String(stored);
  };

  const onCellChange = (
    rfId: string,
    rowType: RowType,
    idx: number,
    value: string
  ): void => {
    setSaveSuccess(false);
    setEdits((prev) => ({ ...prev, [cellKey(rfId, rowType, idx)]: value }));
  };

  const hasEdits = React.useMemo(() => {
    return Object.entries(edits).some(([key, value]) => {
      const [rfId, rowType, idx] = key.split("|");
      return (
        toNumber(value) !==
        storedCell(rfId, Number(rowType) as RowType, Number(idx))
      );
    });
  }, [edits, storedCell]);

  const onDiscard = (): void => {
    setEdits({});
    setSaveError(null);
    setSaveSuccess(false);
  };

  const onSave = async (): Promise<void> => {
    if (!hasEdits || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const groups = new Map<
      string,
      { rfId: string; rowType: RowType; changes: Record<string, number | null> }
    >();
    for (const [key, value] of Object.entries(edits)) {
      const [rfId, rowTypeStr, idxStr] = key.split("|");
      const rowType = Number(rowTypeStr) as RowType;
      const idx = Number(idxStr);
      const newValue = toNumber(value);
      if (newValue === storedCell(rfId, rowType, idx)) continue;
      const gk = groupKey(rfId, rowType);
      const group = groups.get(gk) ?? { rfId, rowType, changes: {} };
      group.changes[MONTHS[idx].col] = newValue;
      groups.set(gk, group);
    }

    try {
      for (const group of groups.values()) {
        const existing = recordMap.get(groupKey(group.rfId, group.rowType));
        if (existing) {
          await webAPI.updateRecord(
            SPEND_PLAN_ENTITY,
            existing.id,
            group.changes
          );
        } else {
          const fy = fy27Rfs.find((r) => r.id === group.rfId)?.fiscalYear;
          const payload: Record<string, unknown> = {
            ...group.changes,
            // Mode-A rows anchor on the RF (per-FY); PF / state stay empty.
            "book_RequirementFunding@odata.bind": `/book_requirementfundings(${group.rfId})`,
            book_rowtype: group.rowType,
            book_name: `${reqName || "Requirement"} - FY${fy ?? ""} - CM - ${
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
    (rfId: string, rowType: RowType): number =>
      MONTHS.reduce(
        (acc, _m, idx) => acc + (effectiveCell(rfId, rowType, idx) ?? 0),
        0
      ),
    [effectiveCell]
  );

  // ----- Cells -----
  const monthCell = (
    rfId: string,
    fiscalYear: number,
    rowType: RowType,
    idx: number
  ): React.ReactNode => {
    const passed = monthPassed(fiscalYear, idx);
    const editable =
      canEdit && (rowType === ROW_TYPE_PLANNED ? !passed : passed);
    if (!editable) {
      const value = effectiveCell(rfId, rowType, idx);
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
        value={cellDisplay(rfId, rowType, idx)}
        onChange={(_e, data) => onCellChange(rfId, rowType, idx, data.value)}
        input={{
          style: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
        }}
      />
    );
  };

  const varianceCell = (
    rfId: string,
    fiscalYear: number,
    idx: number
  ): React.ReactNode => {
    const planned = effectiveCell(rfId, ROW_TYPE_PLANNED, idx) ?? 0;
    const actual = effectiveCell(rfId, ROW_TYPE_ACTUAL, idx);
    if (!monthPassed(fiscalYear, idx) || actual === null)
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

  const bandRows = (rf: RfRow): React.ReactNode => {
    const fy = rf.fiscalYear ?? MIN_FISCAL_YEAR;
    return (
      <>
        <tr>
          <td className={`${styles.td} ${styles.bandLabel}`}>Planned</td>
          {MONTHS.map((_m, idx) => (
            <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
              {monthCell(rf.id, fy, ROW_TYPE_PLANNED, idx)}
            </td>
          ))}
          <td className={`${styles.td} ${styles.tdNum}`}>
            {formatCurrency(bandTotal(rf.id, ROW_TYPE_PLANNED))}
          </td>
        </tr>
        <tr>
          <td className={`${styles.td} ${styles.bandLabel}`}>Actual</td>
          {MONTHS.map((_m, idx) => (
            <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
              {monthCell(rf.id, fy, ROW_TYPE_ACTUAL, idx)}
            </td>
          ))}
          <td className={`${styles.td} ${styles.tdNum}`}>
            {formatCurrency(bandTotal(rf.id, ROW_TYPE_ACTUAL))}
          </td>
        </tr>
        <tr>
          <td className={`${styles.td} ${styles.bandLabel}`}>Variance</td>
          {MONTHS.map((_m, idx) => (
            <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
              {varianceCell(rf.id, fy, idx)}
            </td>
          ))}
          <td className={`${styles.td} ${styles.tdNum}`} />
        </tr>
      </>
    );
  };

  const loading = isNational === null || spRecords === null;

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root} style={{ width: props.width || undefined }}>
        <div className={styles.toolbar}>
          <Text weight="semibold">Spend Plan (Centrally Managed)</Text>
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
              onClick={() => {
                setReloadKey((k) => k + 1);
                dataset.refresh();
              }}
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
        {!loading && isNational === false && (
          <div className={styles.empty}>
            This spend plan is only maintained for Centrally Managed
            requirements. Distributed requirements are planned on their
            Prioritizations or the state rollup.
          </div>
        )}

        {loading ? (
          <Spinner label="Loading Spend Plan…" />
        ) : isNational === false ? null : fy27Rfs.length === 0 ? (
          <div className={styles.empty}>
            No FY{MIN_FISCAL_YEAR}+ Requirement Funding has been created for this
            Requirement yet.
          </div>
        ) : (
          <div className={styles.scrollContainer}>
            <table className={styles.table} aria-label="Spend Plan">
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
                {fy27Rfs.map((rf) => {
                  const planned = bandTotal(rf.id, ROW_TYPE_PLANNED);
                  const matches = nearlyEqual(planned, rf.funded);
                  return (
                    <React.Fragment key={rf.id}>
                      <tr className={styles.sectionRow}>
                        <td
                          className={`${styles.td} ${styles.sectionCell}`}
                          colSpan={MONTHS.length + 2}
                        >
                          FY {rf.fiscalYear} — Planned {formatCurrency(planned)}{" "}
                          / Funded {formatCurrency(rf.funded)}
                          <span
                            className={`${styles.matchBadge} ${
                              matches ? styles.matchOk : styles.matchOff
                            }`}
                          >
                            {matches ? "✓ matches" : "✎ in progress"}
                          </span>
                        </td>
                      </tr>
                      {bandRows(rf)}
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
