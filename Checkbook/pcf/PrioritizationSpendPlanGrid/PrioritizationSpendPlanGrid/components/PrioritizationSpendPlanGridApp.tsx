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
  Tooltip,
} from "@fluentui/react-components";

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;

export interface PrioritizationSpendPlanGridProps {
  dataset: DataSet;
  webAPI: WebApi;
  isDisabled: boolean;
  width: number;
  /** Id of the parent Prioritization record (the form's record). */
  prioritizationId: string | null;
}

/** Property-set aliases declared in ControlManifest.Input.xml. */
const ALIAS = {
  requirementFunding: "requirementFunding",
  fundedAmount: "fundedAmount",
  validatedAmount: "validatedAmount",
} as const;

const SPEND_PLAN_ENTITY = "book_spendplan";
const PRIORITIZATION_ENTITY = "book_prioritization";
const ITEMIZED_DETAILS_ENTITY = "book_itemizeddetails";

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

/** book_approvalstatus value for the final (NPM Review) state. */
const APPROVAL_FINAL = 4;
/** First fiscal year that uses this grid; earlier FYs keep the legacy page. */
const MIN_FISCAL_YEAR = 2027;

/** One Prioritization Funding row (per allocated Requirement Funding). */
interface PfRow {
  id: string;
  rfName: string;
  funded: number;
}

/** A Fund Center band under a PF section. Key "" = state level / rollup. */
interface FcBucket {
  key: string;
  name: string;
  /** Sum of Itemized Detail funded amounts routed at this FC (Prio-wide). */
  idFunded: number;
}

/** A stored book_spendplan row (FY27 shape). */
interface SpRecord {
  id: string;
  pfId: string;
  fcKey: string;
  rowType: RowType;
  months: (number | null)[];
}

interface PrioInfo {
  fiscalYear: number | null;
  approvalStatus: number | null;
  fundCenterName: string;
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
  bandIndent: {
    paddingLeft: "26px",
  },
  sectionRow: {
    backgroundColor: tokens.colorNeutralBackground3,
    fontWeight: tokens.fontWeightSemibold,
  },
  sectionCell: {
    ...shorthands.padding("6px"),
  },
  fcHeaderRow: {
    backgroundColor: tokens.colorNeutralBackground2,
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
  chevronBtn: {
    minWidth: "24px",
    ...shorthands.padding("0px", "4px"),
    marginRight: "4px",
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

function extractLookupId(value: unknown): string | null {
  if (!value) return null;
  const v = value as { id?: { guid?: string } | string; guid?: string };
  const raw = (typeof v.id === "object" ? v.id?.guid : v.id) ?? v.guid ?? null;
  return raw ? stripGuid(raw) : null;
}

/**
 * Reads the fiscal year from the raw option value; goal_fiscalyear values are
 * the calendar year itself, but fall back to parsing the label in case an
 * environment uses coded values.
 */
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

const cellKey = (
  pfId: string,
  fcKey: string,
  rowType: RowType,
  monthIdx: number
): string => `${pfId}|${fcKey}|${rowType}|${monthIdx}`;

const groupKey = (pfId: string, fcKey: string, rowType: RowType): string =>
  `${pfId}|${fcKey}|${rowType}`;

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

export const PrioritizationSpendPlanGridApp: React.FC<
  PrioritizationSpendPlanGridProps
> = (props) => {
  const { dataset, webAPI, isDisabled } = props;
  const styles = useStyles();
  const prioritizationId = props.prioritizationId
    ? stripGuid(props.prioritizationId)
    : null;

  // ----- PF rows straight from the bound subgrid dataset -----
  const pfRows = React.useMemo<PfRow[]>(() => {
    return dataset.sortedRecordIds.map((id) => {
      const r = dataset.records[id];
      return {
        id: stripGuid(id) ?? id,
        rfName:
          r.getFormattedValue(ALIAS.requirementFunding) || "(unnamed funding)",
        funded: num(r.getValue(ALIAS.fundedAmount)),
      };
    });
  }, [dataset.sortedRecordIds, dataset.records]);

  // ----- Server data -----
  const [prioInfo, setPrioInfo] = React.useState<PrioInfo | null>(null);
  const [idBuckets, setIdBuckets] = React.useState<FcBucket[] | null>(null);
  const [spRecords, setSpRecords] = React.useState<SpRecord[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!prioritizationId) return;
    let cancelled = false;
    setLoadError(null);

    void (async () => {
      try {
        const prio = await webAPI.retrieveRecord(
          PRIORITIZATION_ENTITY,
          prioritizationId,
          "?$select=book_newfiscalyear,book_approvalstatus,_book_fundcenter_value"
        );
        if (cancelled) return;
        setPrioInfo({
          fiscalYear: parseFiscalYear(
            prio.book_newfiscalyear,
            (prio[`book_newfiscalyear${FV}`] as string) ?? ""
          ),
          approvalStatus: toNumber(prio.book_approvalstatus),
          fundCenterName:
            (prio[`_book_fundcenter_value${FV}`] as string) ?? "",
        });

        const ids = await webAPI.retrieveMultipleRecords(
          ITEMIZED_DETAILS_ENTITY,
          "?$select=_book_fundcenter_value,book_fundedamount" +
            `&$filter=_book_prioritization_value eq ${prioritizationId} and statecode eq 0`
        );
        if (cancelled) return;
        const byFc = new Map<string, FcBucket>();
        for (const e of ids.entities) {
          const fcId = stripGuid(e._book_fundcenter_value) ?? "";
          const name = (e[`_book_fundcenter_value${FV}`] as string) ?? "";
          const existing = byFc.get(fcId);
          const funded = num(e.book_fundedamount);
          if (existing) existing.idFunded += funded;
          else byFc.set(fcId, { key: fcId, name, idFunded: funded });
        }
        setIdBuckets(Array.from(byFc.values()));
      } catch {
        if (!cancelled)
          setLoadError("Could not load the Prioritization or its Itemized Details.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [prioritizationId, webAPI, reloadKey]);

  React.useEffect(() => {
    const pfIds = pfRows.map((p) => p.id);
    if (pfIds.length === 0) {
      setSpRecords([]);
      return;
    }
    let cancelled = false;

    const filter = pfIds
      .map((id) => `_book_prioritizationfunding_value eq ${id}`)
      .join(" or ");
    const monthCols = MONTHS.map((m) => m.col).join(",");
    const options =
      `?$select=book_spendplanid,_book_prioritizationfunding_value,_book_fundcenter_value,book_rowtype,${monthCols}` +
      `&$filter=(${filter}) and statecode eq 0`;

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
            pfId: stripGuid(e._book_prioritizationfunding_value) ?? "",
            fcKey: stripGuid(e._book_fundcenter_value) ?? "",
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
  }, [pfRows, webAPI, reloadKey]);

  const recordMap = React.useMemo(() => {
    const map = new Map<string, SpRecord>();
    (spRecords ?? []).forEach((r) =>
      map.set(groupKey(r.pfId, r.fcKey, r.rowType), r)
    );
    return map;
  }, [spRecords]);

  // ----- FC buckets shown under each PF section -----
  // Union of the FCs on the Prio's Itemized Details and any FCs that already
  // have stored spend plan rows (so no data is hidden after FCs change).
  const fcBuckets = React.useMemo<FcBucket[]>(() => {
    const byKey = new Map<string, FcBucket>();
    (idBuckets ?? []).forEach((b) => byKey.set(b.key, { ...b }));
    (spRecords ?? []).forEach((r) => {
      if (!byKey.has(r.fcKey))
        byKey.set(r.fcKey, { key: r.fcKey, name: "", idFunded: 0 });
    });
    const stateName = prioInfo?.fundCenterName
      ? `State level (${prioInfo.fundCenterName})`
      : "State level";
    const buckets = Array.from(byKey.values()).map((b) =>
      b.key === "" ? { ...b, name: stateName } : b
    );
    buckets.sort((a, b) => {
      if (a.key === "") return -1;
      if (b.key === "") return 1;
      return a.name.localeCompare(b.name);
    });
    return buckets;
  }, [idBuckets, spRecords, prioInfo]);

  // Only a real breakdown (2+ distinct destinations) warrants expandable
  // bands; a single destination stays on the rollup row (fc empty).
  const multiFc = fcBuckets.length > 1;

  // ----- Gating -----
  const fiscalYear = prioInfo?.fiscalYear ?? null;
  const isFy27Plus = fiscalYear !== null && fiscalYear >= MIN_FISCAL_YEAR;
  const isFinalApproved = prioInfo?.approvalStatus === APPROVAL_FINAL;
  const canEdit = !isDisabled && isFy27Plus && isFinalApproved;

  /** True when the given FY month is fully in the past. */
  const monthPassed = React.useCallback(
    (idx: number): boolean => {
      if (fiscalYear === null) return false;
      const calYear = idx < 3 ? fiscalYear - 1 : fiscalYear;
      const monthNum = (idx + 9) % 12; // Oct=9 … Sep=8
      const monthEnd = new Date(calYear, monthNum + 1, 1);
      return new Date() >= monthEnd;
    },
    [fiscalYear]
  );

  // ----- Edits -----
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  const storedCell = React.useCallback(
    (pfId: string, fcKey: string, rowType: RowType, idx: number): number | null =>
      recordMap.get(groupKey(pfId, fcKey, rowType))?.months[idx] ?? null,
    [recordMap]
  );

  const effectiveCell = React.useCallback(
    (pfId: string, fcKey: string, rowType: RowType, idx: number): number | null => {
      const pending = edits[cellKey(pfId, fcKey, rowType, idx)];
      if (pending !== undefined) return toNumber(pending);
      return storedCell(pfId, fcKey, rowType, idx);
    },
    [edits, storedCell]
  );

  const cellDisplay = (
    pfId: string,
    fcKey: string,
    rowType: RowType,
    idx: number
  ): string => {
    const pending = edits[cellKey(pfId, fcKey, rowType, idx)];
    if (pending !== undefined) return pending;
    const stored = storedCell(pfId, fcKey, rowType, idx);
    return stored === null ? "" : String(stored);
  };

  const onCellChange = (
    pfId: string,
    fcKey: string,
    rowType: RowType,
    idx: number,
    value: string
  ): void => {
    setSaveSuccess(false);
    setEdits((prev) => ({
      ...prev,
      [cellKey(pfId, fcKey, rowType, idx)]: value,
    }));
  };

  const hasEdits = React.useMemo(() => {
    return Object.entries(edits).some(([key, value]) => {
      const [pfId, fcKey, rowType, idx] = key.split("|");
      const stored = storedCell(
        pfId,
        fcKey,
        Number(rowType) as RowType,
        Number(idx)
      );
      return toNumber(value) !== stored;
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

    // Group changed cells into one payload per stored row.
    const groups = new Map<
      string,
      { pfId: string; fcKey: string; rowType: RowType; changes: Record<string, number | null> }
    >();
    for (const [key, value] of Object.entries(edits)) {
      const [pfId, fcKey, rowTypeStr, idxStr] = key.split("|");
      const rowType = Number(rowTypeStr) as RowType;
      const idx = Number(idxStr);
      const newValue = toNumber(value);
      if (newValue === storedCell(pfId, fcKey, rowType, idx)) continue;
      const gk = groupKey(pfId, fcKey, rowType);
      const group =
        groups.get(gk) ?? { pfId, fcKey, rowType, changes: {} };
      group.changes[MONTHS[idx].col] = newValue;
      groups.set(gk, group);
    }

    try {
      for (const group of groups.values()) {
        const existing = recordMap.get(
          groupKey(group.pfId, group.fcKey, group.rowType)
        );
        if (existing) {
          await webAPI.updateRecord(SPEND_PLAN_ENTITY, existing.id, group.changes);
        } else {
          const pf = pfRows.find((p) => p.id === group.pfId);
          const fcName = fcBuckets.find((b) => b.key === group.fcKey)?.name;
          const payload: Record<string, unknown> = {
            ...group.changes,
            // FY27 rows anchor on the PF junction; book_prioritization stays
            // empty (the legacy alternate key allows only one row per Prio).
            "book_PrioritizationFunding@odata.bind": `/book_prioritizationfundings(${group.pfId})`,
            book_rowtype: group.rowType,
            book_name: `${pf?.rfName ?? "Spend Plan"} - ${
              group.fcKey ? fcName ?? "FC" : "State"
            } - ${group.rowType === ROW_TYPE_ACTUAL ? "Actual" : "Planned"}`,
          };
          if (group.fcKey)
            payload["book_FundCenter@odata.bind"] = `/book_fundcenters(${group.fcKey})`;
          await webAPI.createRecord(SPEND_PLAN_ENTITY, payload);
        }
      }
      setEdits({});
      setSaveSuccess(true);
      setReloadKey((k) => k + 1);
    } catch (e) {
      const message =
        (e as { message?: string })?.message ??
        "Some Spend Plan rows could not be saved.";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  // ----- Derived totals -----
  const bandTotal = React.useCallback(
    (pfId: string, fcKey: string, rowType: RowType): number =>
      MONTHS.reduce(
        (acc, _m, idx) => acc + (effectiveCell(pfId, fcKey, rowType, idx) ?? 0),
        0
      ),
    [effectiveCell]
  );

  const rollupMonth = React.useCallback(
    (pfId: string, rowType: RowType, idx: number): number =>
      fcBuckets.reduce(
        (acc, b) => acc + (effectiveCell(pfId, b.key, rowType, idx) ?? 0),
        0
      ),
    [fcBuckets, effectiveCell]
  );

  const pfPlannedTotal = React.useCallback(
    (pfId: string): number =>
      multiFc
        ? fcBuckets.reduce(
            (acc, b) => acc + bandTotal(pfId, b.key, ROW_TYPE_PLANNED),
            0
          )
        : bandTotal(pfId, "", ROW_TYPE_PLANNED),
    [multiFc, fcBuckets, bandTotal]
  );

  // Prio-level crosscheck: per-FC planned across all PFs vs the Itemized
  // Detail funded routed at that FC. Advisory only (see design notes).
  const fcMismatches = React.useMemo<string[]>(() => {
    if (!multiFc) return [];
    const notes: string[] = [];
    for (const bucket of fcBuckets) {
      if (bucket.idFunded <= 0) continue;
      const planned = pfRows.reduce(
        (acc, pf) => acc + bandTotal(pf.id, bucket.key, ROW_TYPE_PLANNED),
        0
      );
      if (!nearlyEqual(planned, bucket.idFunded))
        notes.push(
          `${bucket.name || "Fund Center"}: planned ${formatCurrency(planned)} vs ` +
            `${formatCurrency(bucket.idFunded)} funded on Itemized Details`
        );
    }
    return notes;
  }, [multiFc, fcBuckets, pfRows, bandTotal]);

  const toggleExpanded = (pfId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pfId)) next.delete(pfId);
      else next.add(pfId);
      return next;
    });
  };

  // ----- Cells -----
  const monthCell = (
    pfId: string,
    fcKey: string,
    rowType: RowType,
    idx: number
  ): React.ReactNode => {
    const passed = monthPassed(idx);
    const editable =
      canEdit && (rowType === ROW_TYPE_PLANNED ? !passed : passed);
    if (!editable) {
      const value = effectiveCell(pfId, fcKey, rowType, idx);
      const locked =
        rowType === ROW_TYPE_PLANNED ? passed : !passed;
      const label = value === null ? (locked ? "—" : "") : formatCurrency(value);
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
        value={cellDisplay(pfId, fcKey, rowType, idx)}
        onChange={(_e, data) =>
          onCellChange(pfId, fcKey, rowType, idx, data.value)
        }
        input={{
          style: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
        }}
      />
    );
  };

  const varianceCell = (
    pfId: string,
    fcKey: string,
    idx: number,
    fromRollup: boolean
  ): React.ReactNode => {
    const planned = fromRollup
      ? rollupMonth(pfId, ROW_TYPE_PLANNED, idx)
      : effectiveCell(pfId, fcKey, ROW_TYPE_PLANNED, idx) ?? 0;
    const actual = fromRollup
      ? rollupMonth(pfId, ROW_TYPE_ACTUAL, idx)
      : effectiveCell(pfId, fcKey, ROW_TYPE_ACTUAL, idx);
    if (!monthPassed(idx) || actual === null) return <span>—</span>;
    const variance = actual - planned;
    const cls =
      variance > 0.005
        ? styles.varianceOver
        : variance < -0.005
          ? styles.varianceUnder
          : undefined;
    return <span className={cls}>{formatCurrency(variance)}</span>;
  };

  /** One Planned/Actual/Variance band (3 rows). */
  const bandRows = (
    pfId: string,
    fcKey: string,
    indent: boolean,
    readOnlyRollup: boolean
  ): React.ReactNode => {
    const labelCls = `${styles.bandLabel}${indent ? " " + styles.bandIndent : ""}`;
    return (
      <>
        <tr>
          <td className={`${styles.td} ${labelCls}`}>Planned</td>
          {MONTHS.map((_m, idx) => (
            <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
              {readOnlyRollup ? (
                <span>
                  {formatCurrency(rollupMonth(pfId, ROW_TYPE_PLANNED, idx))}
                </span>
              ) : (
                monthCell(pfId, fcKey, ROW_TYPE_PLANNED, idx)
              )}
            </td>
          ))}
          <td className={`${styles.td} ${styles.tdNum}`}>
            {formatCurrency(
              readOnlyRollup
                ? fcBuckets.reduce(
                    (acc, b) => acc + bandTotal(pfId, b.key, ROW_TYPE_PLANNED),
                    0
                  )
                : bandTotal(pfId, fcKey, ROW_TYPE_PLANNED)
            )}
          </td>
        </tr>
        <tr>
          <td className={`${styles.td} ${labelCls}`}>Actual</td>
          {MONTHS.map((_m, idx) => (
            <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
              {readOnlyRollup ? (
                <span>
                  {formatCurrency(rollupMonth(pfId, ROW_TYPE_ACTUAL, idx))}
                </span>
              ) : (
                monthCell(pfId, fcKey, ROW_TYPE_ACTUAL, idx)
              )}
            </td>
          ))}
          <td className={`${styles.td} ${styles.tdNum}`}>
            {formatCurrency(
              readOnlyRollup
                ? fcBuckets.reduce(
                    (acc, b) => acc + bandTotal(pfId, b.key, ROW_TYPE_ACTUAL),
                    0
                  )
                : bandTotal(pfId, fcKey, ROW_TYPE_ACTUAL)
            )}
          </td>
        </tr>
        <tr>
          <td className={`${styles.td} ${labelCls}`}>Variance</td>
          {MONTHS.map((_m, idx) => (
            <td key={idx} className={`${styles.td} ${styles.tdNum}`}>
              {varianceCell(pfId, fcKey, idx, readOnlyRollup)}
            </td>
          ))}
          <td className={`${styles.td} ${styles.tdNum}`} />
        </tr>
      </>
    );
  };

  // ----- Render -----
  const loading =
    prioInfo === null || idBuckets === null || spRecords === null;

  if (!prioritizationId) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className={styles.empty}>
          Save the Prioritization first to build its Spend Plan.
        </div>
      </FluentProvider>
    );
  }

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
        <div className={styles.toolbar}>
          <Text weight="semibold">
            Spend Plan{fiscalYear !== null ? ` (FY ${fiscalYear})` : ""}
          </Text>
          <div className={styles.toolbarButtons}>
            {canEdit && (
              <>
                <Button
                  size="small"
                  appearance="primary"
                  disabled={!hasEdits || saving}
                  onClick={() => void onSave()}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="small"
                  appearance="secondary"
                  disabled={!hasEdits || saving}
                  onClick={onDiscard}
                >
                  Discard
                </Button>
              </>
            )}
            <Button
              size="small"
              appearance="subtle"
              disabled={saving}
              onClick={() => {
                dataset.refresh();
                setReloadKey((k) => k + 1);
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
        {!loading && !isFy27Plus && (
          <div className={styles.empty}>
            {fiscalYear === null
              ? "Set the Fiscal Year on this Prioritization to build a Spend Plan."
              : `FY ${fiscalYear} Prioritizations use the existing Spend Plan page; this grid covers FY ${MIN_FISCAL_YEAR} and later.`}
          </div>
        )}
        {!loading && isFy27Plus && !isFinalApproved && (
          <div className={`${styles.banner} ${styles.bannerWarn}`}>
            Spend Plans open for entry once funding is final (NPM Review).
          </div>
        )}
        {fcMismatches.length > 0 && (
          <div className={`${styles.banner} ${styles.bannerWarn}`}>
            Fund Center totals differ from Itemized Detail funding:{" "}
            {fcMismatches.join("; ")}
          </div>
        )}

        {loading ? (
          <Spinner label="Loading Spend Plan…" />
        ) : !isFy27Plus ? null : pfRows.length === 0 ? (
          <div className={styles.empty}>
            No Requirement Funding has been allocated to this Prioritization
            yet — allocate funding before building a Spend Plan.
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
                {pfRows.map((pf) => {
                  const isOpen = expanded.has(pf.id);
                  const planned = pfPlannedTotal(pf.id);
                  const matches = nearlyEqual(planned, pf.funded);
                  return (
                    <React.Fragment key={pf.id}>
                      <tr className={styles.sectionRow}>
                        <td
                          className={`${styles.td} ${styles.sectionCell}`}
                          colSpan={MONTHS.length + 2}
                        >
                          {multiFc && (
                            <Button
                              size="small"
                              appearance="subtle"
                              className={styles.chevronBtn}
                              onClick={() => toggleExpanded(pf.id)}
                              aria-label={
                                isOpen
                                  ? "Collapse Fund Center breakdown"
                                  : "Expand Fund Center breakdown"
                              }
                            >
                              {isOpen ? "▾" : "▸"}
                            </Button>
                          )}
                          {pf.rfName}
                          <Tooltip
                            content="Planned total vs the funded amount on this Prioritization Funding row"
                            relationship="label"
                          >
                            <span
                              className={`${styles.matchBadge} ${
                                matches ? styles.matchOk : styles.matchOff
                              }`}
                            >
                              Planned {formatCurrency(planned)} / Funded{" "}
                              {formatCurrency(pf.funded)}
                            </span>
                          </Tooltip>
                        </td>
                      </tr>
                      {multiFc
                        ? bandRows(pf.id, "", false, true)
                        : bandRows(pf.id, "", false, false)}
                      {multiFc &&
                        isOpen &&
                        fcBuckets.map((bucket) => (
                          <React.Fragment key={bucket.key || "__state__"}>
                            <tr className={styles.fcHeaderRow}>
                              <td
                                className={`${styles.td} ${styles.bandIndent}`}
                                colSpan={MONTHS.length + 2}
                              >
                                <Text size={200} weight="semibold">
                                  {bucket.name || "Fund Center"}
                                  {bucket.idFunded > 0
                                    ? ` — ${formatCurrency(bucket.idFunded)} on Itemized Details`
                                    : ""}
                                </Text>
                              </td>
                            </tr>
                            {bandRows(pf.id, bucket.key, true, false)}
                          </React.Fragment>
                        ))}
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
