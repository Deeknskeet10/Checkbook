import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  shorthands,
  tokens,
  Badge,
  Button,
  Combobox,
  Input,
  Option,
  Spinner,
  Text,
  Tooltip,
  Link,
} from "@fluentui/react-components";
type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;
type Navigation = ComponentFramework.Navigation;

export interface PrioritizationFundingGridProps {
  dataset: DataSet;
  webAPI: WebApi;
  navigation: Navigation;
  isDisabled: boolean;
  width: number;
}

/** Property-set aliases declared in ControlManifest.Input.xml. */
const ALIAS = {
  name: "name",
  statePriority: "statePriority",
  approvalStatus: "approvalStatus",
  fiscalYear: "fiscalYear",
  fundingMode: "fundingMode",
  requestedAmount: "requestedAmount",
  fundedAmount: "fundedAmount",
  validatedAmount: "validatedAmount",
  requirement: "requirement",
} as const;

const PRIORITIZATION_ENTITY = "book_prioritization";
const PRIORITIZATION_FUNDING_ENTITY = "book_prioritizationfunding";
const REQUIREMENT_FUNDING_ENTITY = "book_requirementfunding";

// book_fundingmode option values
const FUNDING_MODE_DIRECT = 0;
const FUNDING_MODE_ITEMIZED = 1;

const FY_FILTER_ALL = "all" as const;
type FYFilter = number | typeof FY_FILTER_ALL;

interface PrioRow {
  id: string;
  name: string;
  statePriority: number | null;
  approvalStatus: string | null;
  fiscalYear: number | null;
  fiscalYearLabel: string | null;
  fundingMode: number | null;
  fundingModeLabel: string | null;
  requestedAmount: number | null;
  fundedAmount: number | null;
  validatedAmount: number | null;
  requirementId: string | null;
  requirementName: string | null;
}

interface JunctionRow {
  id: string;
  name: string;
  prioritizationId: string;
  rfId: string;
  rfName: string;
  fundedAmount: number;
  validatedAmount: number;
}

interface RFOption {
  id: string;
  name: string;
  tdp: number | null;
  fiscalYear: number | null;
}

type SaveState = "saving" | "saved" | "error";
type JunctionField = "fundedAmount" | "validatedAmount";

const useStyles = makeStyles({
  root: {
    ...shorthands.padding("8px"),
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: "8px",
    columnGap: "12px",
    ...shorthands.padding("4px", "2px", "12px", "2px"),
  },
  toolbarLeft: {
    display: "flex",
    alignItems: "center",
    columnGap: "12px",
    flexWrap: "wrap",
  },
  fyFilter: {
    display: "flex",
    alignItems: "center",
    columnGap: "6px",
  },
  prioCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    marginBottom: "10px",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  prioHeader: {
    display: "flex",
    alignItems: "center",
    columnGap: "12px",
    rowGap: "4px",
    flexWrap: "wrap",
    ...shorthands.padding("10px", "12px"),
    backgroundColor: tokens.colorNeutralBackground2,
    borderTopLeftRadius: tokens.borderRadiusMedium,
    borderTopRightRadius: tokens.borderRadiusMedium,
  },
  prioName: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    flexGrow: 1,
    minWidth: "180px",
  },
  prioMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  prioMetaStrong: {
    color: tokens.colorNeutralForeground1,
    fontVariantNumeric: "tabular-nums",
  },
  priorityBadge: {
    fontVariantNumeric: "tabular-nums",
  },
  junctionList: {
    ...shorthands.padding("8px", "12px", "12px", "12px"),
    display: "flex",
    flexDirection: "column",
    rowGap: "4px",
  },
  junctionEmpty: {
    color: tokens.colorNeutralForeground3,
    fontStyle: "italic",
    ...shorthands.padding("4px", "0"),
  },
  junctionRow: {
    display: "grid",
    gridTemplateColumns: "minmax(180px, 1.5fr) minmax(140px, 1fr) minmax(140px, 1fr) auto auto",
    alignItems: "center",
    columnGap: "10px",
    ...shorthands.padding("4px", "0"),
  },
  junctionHead: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingBottom: "4px",
    marginBottom: "2px",
  },
  rfCell: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  amountInput: {
    width: "140px",
  },
  amountCell: {
    fontVariantNumeric: "tabular-nums",
  },
  status: {
    marginLeft: "6px",
    fontSize: tokens.fontSizeBase200,
  },
  statusError: { color: tokens.colorPaletteRedForeground1 },
  statusSaved: { color: tokens.colorPaletteGreenForeground1 },
  addRow: {
    display: "flex",
    alignItems: "center",
    columnGap: "8px",
    marginTop: "8px",
    flexWrap: "wrap",
  },
  addCombo: { minWidth: "260px" },
  empty: {
    ...shorthands.padding("16px"),
    color: tokens.colorNeutralForeground3,
  },
});

function extractLookupId(value: unknown): string | null {
  if (!value) return null;
  const v = value as { id?: { guid?: string } | string; guid?: string };
  const raw =
    (typeof v.id === "object" ? v.id?.guid : v.id) ?? v.guid ?? null;
  return raw ? String(raw).replace(/[{}]/g, "").toLowerCase() : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function approvalColor(label: string | null): "danger" | "warning" | "success" | "informative" | "brand" {
  const t = (label ?? "").toLowerCase();
  if (t.includes("approved") || t.includes("funded")) return "success";
  if (t.includes("reject") || t.includes("kick")) return "danger";
  if (t.includes("review") || t.includes("submit")) return "warning";
  if (t.includes("draft") || t.includes("planning")) return "informative";
  return "informative";
}

export const PrioritizationFundingGridApp: React.FC<PrioritizationFundingGridProps> = (
  props
) => {
  const { dataset, webAPI, isDisabled } = props;
  const styles = useStyles();

  // ---- Materialise the Prios from the dataset ----
  const prios = React.useMemo<PrioRow[]>(() => {
    return dataset.sortedRecordIds
      .map((id) => {
        const r = dataset.records[id];
        const reqLookup = r.getValue(ALIAS.requirement);
        const fundingModeRaw = r.getValue(ALIAS.fundingMode);
        const fiscalYearRaw = r.getValue(ALIAS.fiscalYear);
        return {
          id,
          name: (r.getValue(ALIAS.name) as string | null) ?? "(unnamed)",
          statePriority: (r.getValue(ALIAS.statePriority) as number | null) ?? null,
          approvalStatus: r.getFormattedValue(ALIAS.approvalStatus) ?? null,
          // book_newfiscalyear is an OptionSet; getValue returns either an
          // {Value} wrapper or the raw integer depending on host version.
          fiscalYear:
            typeof fiscalYearRaw === "object" && fiscalYearRaw !== null
              ? ((fiscalYearRaw as { Value?: number }).Value ?? null)
              : toNumber(fiscalYearRaw),
          fiscalYearLabel: r.getFormattedValue(ALIAS.fiscalYear) ?? null,
          fundingMode:
            typeof fundingModeRaw === "object" && fundingModeRaw !== null
              ? ((fundingModeRaw as { Value?: number }).Value ?? null)
              : toNumber(fundingModeRaw),
          fundingModeLabel: r.getFormattedValue(ALIAS.fundingMode) ?? null,
          requestedAmount: toNumber(r.getValue(ALIAS.requestedAmount)),
          fundedAmount: toNumber(r.getValue(ALIAS.fundedAmount)),
          validatedAmount: toNumber(r.getValue(ALIAS.validatedAmount)),
          requirementId: extractLookupId(reqLookup),
          requirementName: r.getFormattedValue(ALIAS.requirement) ?? null,
        };
      })
      .sort((a, b) => {
        const pa = a.statePriority ?? Number.MAX_SAFE_INTEGER;
        const pb = b.statePriority ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      });
  }, [dataset.sortedRecordIds, dataset.records]);

  // ---- FY filter ----
  // book_newfiscalyear is a picklist; the option *value* is opaque (e.g.
  // 100000000) but the formatted *label* is human-friendly ("FY 2027").
  // Filtering uses value; the UI shows label.
  const fyOptions = React.useMemo<{ value: number; label: string }[]>(() => {
    const seen = new Map<number, string>();
    for (const p of prios) {
      if (p.fiscalYear == null) continue;
      if (!seen.has(p.fiscalYear)) {
        seen.set(p.fiscalYear, p.fiscalYearLabel ?? `FY ${p.fiscalYear}`);
      }
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => b.value - a.value); // newest first
  }, [prios]);

  const fyLabelFor = (value: number | null): string => {
    if (value == null) return "";
    const hit = fyOptions.find((o) => o.value === value);
    return hit?.label ?? `FY ${value}`;
  };

  const [fyFilter, setFyFilter] = React.useState<FYFilter>(FY_FILTER_ALL);

  // Reset filter if it no longer matches any FY in the set.
  React.useEffect(() => {
    if (fyFilter === FY_FILTER_ALL) return;
    if (!fyOptions.some((o) => o.value === fyFilter)) setFyFilter(FY_FILTER_ALL);
  }, [fyOptions, fyFilter]);

  const visiblePrios = React.useMemo<PrioRow[]>(() => {
    if (fyFilter === FY_FILTER_ALL) return prios;
    return prios.filter((p) => p.fiscalYear === fyFilter);
  }, [prios, fyFilter]);

  // ---- Junction rows per Prio (fetched on prio set change) ----
  const [junctions, setJunctions] = React.useState<Record<string, JunctionRow[]>>({});
  const [junctionsLoading, setJunctionsLoading] = React.useState<boolean>(false);
  const [junctionsError, setJunctionsError] = React.useState<string | null>(null);

  const reloadJunctions = React.useCallback(
    (prioIds: string[]) => {
      if (prioIds.length === 0) {
        setJunctions({});
        return;
      }
      setJunctionsLoading(true);
      setJunctionsError(null);

      const orClause = prioIds
        .map((id) => `_book_prioritization_value eq ${id}`)
        .join(" or ");
      const select =
        "?$select=book_name,book_fundedamount,book_validatedamount," +
        "_book_prioritization_value,_book_requirementfunding_value" +
        "&$expand=book_RequirementFunding($select=book_name)" +
        `&$filter=statecode eq 0 and (${orClause})`;

      webAPI
        .retrieveMultipleRecords(PRIORITIZATION_FUNDING_ENTITY, select)
        .then((res) => {
          const byPrio: Record<string, JunctionRow[]> = {};
          for (const id of prioIds) byPrio[id] = [];
          for (const e of res.entities) {
            const prioId = ((e._book_prioritization_value as string) ?? "")
              .replace(/[{}]/g, "")
              .toLowerCase();
            const rfId = ((e._book_requirementfunding_value as string) ?? "")
              .replace(/[{}]/g, "")
              .toLowerCase();
            const rfName =
              (e.book_RequirementFunding as { book_name?: string } | undefined)
                ?.book_name ?? "(RF)";
            const row: JunctionRow = {
              id: e.book_prioritizationfundingid as string,
              name: (e.book_name as string) ?? "",
              prioritizationId: prioId,
              rfId,
              rfName,
              fundedAmount: toNumber(e.book_fundedamount) ?? 0,
              validatedAmount: toNumber(e.book_validatedamount) ?? 0,
            };
            if (!byPrio[prioId]) byPrio[prioId] = [];
            byPrio[prioId].push(row);
          }
          for (const id of Object.keys(byPrio)) {
            byPrio[id].sort((a, b) => a.rfName.localeCompare(b.rfName));
          }
          setJunctions(byPrio);
          setJunctionsLoading(false);
          return;
        })
        .catch((err: unknown) => {
          setJunctionsError(
            err instanceof Error ? err.message : "Failed to load Prioritization Fundings."
          );
          setJunctionsLoading(false);
        });
    },
    [webAPI]
  );

  // Re-fetch when the visible Prio set changes.
  const prioIdsKey = prios.map((p) => p.id).join("|");
  React.useEffect(() => {
    reloadJunctions(prios.map((p) => p.id));
  }, [prioIdsKey, reloadJunctions]);

  // ---- Eligible RFs per FY (cached) ----
  // Parent Requirement is shared across all rows in the subgrid; pick the
  // first row's value.
  const parentRequirementId = React.useMemo<string | null>(() => {
    for (const p of prios) if (p.requirementId) return p.requirementId;
    return null;
  }, [prios]);

  const [rfsByFY, setRfsByFY] = React.useState<Record<number, RFOption[]>>({});
  const [rfsLoadingFY, setRfsLoadingFY] = React.useState<Record<number, boolean>>({});

  const ensureRFsForFY = React.useCallback(
    (fy: number): void => {
      if (!parentRequirementId) return;
      if (rfsByFY[fy] || rfsLoadingFY[fy]) return;
      setRfsLoadingFY((prev) => ({ ...prev, [fy]: true }));

      const select =
        "?$select=book_name,book_newtdp,book_newfiscalyear" +
        `&$filter=_book_requirement_value eq ${parentRequirementId}` +
        ` and book_newfiscalyear eq ${fy}` +
        " and statecode eq 0";

      webAPI
        .retrieveMultipleRecords(REQUIREMENT_FUNDING_ENTITY, select)
        .then((res) => {
          const options: RFOption[] = res.entities.map((e) => ({
            id: e.book_requirementfundingid as string,
            name: (e.book_name as string) ?? "(RF)",
            tdp: toNumber(e.book_newtdp),
            fiscalYear: (e.book_newfiscalyear as number | null) ?? null,
          }));
          options.sort((a, b) => a.name.localeCompare(b.name));
          setRfsByFY((prev) => ({ ...prev, [fy]: options }));
          setRfsLoadingFY((prev) => ({ ...prev, [fy]: false }));
          return;
        })
        .catch(() => {
          setRfsLoadingFY((prev) => ({ ...prev, [fy]: false }));
        });
    },
    [parentRequirementId, rfsByFY, rfsLoadingFY, webAPI]
  );

  // ---- Pending edits + save state on junction inputs ----
  const [edits, setEdits] = React.useState<
    Record<string, Partial<Record<JunctionField, string>>>
  >({});
  const [saveState, setSaveState] = React.useState<Record<string, SaveState>>({});

  const onCellChange = (id: string, field: JunctionField, value: string): void => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const commitCell = (row: JunctionRow, field: JunctionField): void => {
    const pending = edits[row.id]?.[field];
    if (pending === undefined) return;
    const newValue = toNumber(pending) ?? 0;
    const original = row[field];
    if (newValue === original) {
      // Clear the edit; nothing to save.
      setEdits((prev) => {
        const copy = { ...prev[row.id] };
        delete copy[field];
        const next = { ...prev };
        if (Object.keys(copy).length === 0) delete next[row.id];
        else next[row.id] = copy;
        return next;
      });
      return;
    }

    const logicalField =
      field === "fundedAmount" ? "book_fundedamount" : "book_validatedamount";

    setSaveState((prev) => ({ ...prev, [row.id]: "saving" }));
    webAPI
      .updateRecord(PRIORITIZATION_FUNDING_ENTITY, row.id, {
        [logicalField]: newValue,
      })
      .then(() => {
        setSaveState((prev) => ({ ...prev, [row.id]: "saved" }));
        // Patch the local junction state so totals reflect immediately.
        setJunctions((prev) => {
          const list = prev[row.prioritizationId];
          if (!list) return prev;
          return {
            ...prev,
            [row.prioritizationId]: list.map((j) =>
              j.id === row.id ? { ...j, [field]: newValue } : j
            ),
          };
        });
        // Clear the pending edit so the value isn't shown twice.
        setEdits((prev) => {
          const copy = { ...prev[row.id] };
          delete copy[field];
          const next = { ...prev };
          if (Object.keys(copy).length === 0) delete next[row.id];
          else next[row.id] = copy;
          return next;
        });
        window.setTimeout(() => {
          setSaveState((prev) => {
            const next = { ...prev };
            if (next[row.id] === "saved") delete next[row.id];
            return next;
          });
        }, 2500);
        // Refresh dataset so the Prio's funded total picks up the rollup.
        dataset.refresh();
        return;
      })
      .catch(() => {
        setSaveState((prev) => ({ ...prev, [row.id]: "error" }));
      });
  };

  // ---- Add junction ----
  const [addOpenFor, setAddOpenFor] = React.useState<string | null>(null);
  const [addRFFor, setAddRFFor] = React.useState<Record<string, string>>({});
  const [adding, setAdding] = React.useState<Record<string, boolean>>({});

  const createJunction = (prio: PrioRow): void => {
    const rfId = addRFFor[prio.id];
    if (!rfId) return;
    setAdding((prev) => ({ ...prev, [prio.id]: true }));

    const payload = {
      [`book_Prioritization@odata.bind`]: `/${PRIORITIZATION_ENTITY}s(${prio.id})`,
      [`book_RequirementFunding@odata.bind`]: `/${REQUIREMENT_FUNDING_ENTITY}s(${rfId})`,
      book_fundedamount: 0,
      book_validatedamount: 0,
    };

    webAPI
      .createRecord(PRIORITIZATION_FUNDING_ENTITY, payload)
      .then(() => {
        setAddOpenFor(null);
        setAddRFFor((prev) => {
          const next = { ...prev };
          delete next[prio.id];
          return next;
        });
        setAdding((prev) => ({ ...prev, [prio.id]: false }));
        reloadJunctions(prios.map((p) => p.id));
        dataset.refresh();
        return;
      })
      .catch((err: unknown) => {
        setAdding((prev) => ({ ...prev, [prio.id]: false }));
        setJunctionsError(
          err instanceof Error
            ? err.message
            : "Failed to add Prioritization Funding."
        );
      });
  };

  // ---- Delete junction ----
  const deleteJunction = (row: JunctionRow): void => {
    setSaveState((prev) => ({ ...prev, [row.id]: "saving" }));
    webAPI
      .deleteRecord(PRIORITIZATION_FUNDING_ENTITY, row.id)
      .then(() => {
        setJunctions((prev) => {
          const list = prev[row.prioritizationId];
          if (!list) return prev;
          return {
            ...prev,
            [row.prioritizationId]: list.filter((j) => j.id !== row.id),
          };
        });
        setSaveState((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        dataset.refresh();
        return;
      })
      .catch(() => {
        setSaveState((prev) => ({ ...prev, [row.id]: "error" }));
      });
  };

  // ---- Render helpers ----
  const renderStatus = (id: string): React.ReactNode => {
    const s = saveState[id];
    if (!s) return null;
    if (s === "saving") return <Spinner size="extra-tiny" className={styles.status} />;
    if (s === "saved")
      return <span className={`${styles.status} ${styles.statusSaved}`}>Saved</span>;
    return (
      <Tooltip content="Save failed — re-check the value" relationship="label">
        <span className={`${styles.status} ${styles.statusError}`}>Error</span>
      </Tooltip>
    );
  };

  const displayValue = (row: JunctionRow, field: JunctionField): string => {
    const pending = edits[row.id]?.[field];
    if (pending !== undefined) return pending;
    return String(row[field] ?? 0);
  };

  const renderJunctionInput = (row: JunctionRow, field: JunctionField): React.ReactNode => (
    <Input
      type="number"
      appearance="filled-lighter"
      className={styles.amountInput}
      disabled={isDisabled}
      value={displayValue(row, field)}
      onChange={(_e, data) => onCellChange(row.id, field, data.value)}
      onBlur={() => commitCell(row, field)}
      input={{ style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
    />
  );

  const renderAddRow = (prio: PrioRow): React.ReactNode => {
    if (prio.fiscalYear == null) {
      return (
        <div className={styles.addRow}>
          <Text size={200} className={styles.junctionEmpty}>
            Prioritization has no Fiscal Year — set one before adding RF allocations.
          </Text>
        </div>
      );
    }
    const fy = prio.fiscalYear;
    const allRFs = rfsByFY[fy] ?? [];
    const usedIds = new Set((junctions[prio.id] ?? []).map((j) => j.rfId));
    const eligibleRFs = allRFs.filter((rf) => !usedIds.has(rf.id));
    const selectedId = addRFFor[prio.id] ?? "";
    const selectedName = eligibleRFs.find((rf) => rf.id === selectedId)?.name ?? "";

    const isOpen = addOpenFor === prio.id;
    if (!isOpen) {
      return (
        <div className={styles.addRow}>
          <Button
            appearance="subtle"
            size="small"
            disabled={isDisabled}
            onClick={() => {
              setAddOpenFor(prio.id);
              ensureRFsForFY(fy);
            }}
          >
            + Add from RF
          </Button>
        </div>
      );
    }

    return (
      <div className={styles.addRow}>
        {rfsLoadingFY[fy] ? (
          <Spinner size="extra-tiny" label="Loading RFs…" labelPosition="after" />
        ) : eligibleRFs.length === 0 ? (
          <Text size={200} className={styles.junctionEmpty}>
            No additional {fyLabelFor(fy)} Requirement Fundings available for this Requirement.
          </Text>
        ) : (
          <Combobox
            className={styles.addCombo}
            size="small"
            placeholder={`Select an FY ${fy} Requirement Funding`}
            value={selectedName}
            selectedOptions={selectedId ? [selectedId] : []}
            onOptionSelect={(_e, data) =>
              setAddRFFor((prev) => ({ ...prev, [prio.id]: data.optionValue ?? "" }))
            }
            disabled={isDisabled}
          >
            {eligibleRFs.map((rf) => (
              <Option key={rf.id} value={rf.id} text={rf.name}>
                {rf.name}
                {rf.tdp != null ? ` — TDP ${formatCurrency(rf.tdp)}` : ""}
              </Option>
            ))}
          </Combobox>
        )}
        <Button
          appearance="primary"
          size="small"
          disabled={isDisabled || !selectedId || adding[prio.id]}
          onClick={() => createJunction(prio)}
        >
          {adding[prio.id] ? "Adding…" : "Add"}
        </Button>
        <Button
          appearance="subtle"
          size="small"
          onClick={() => {
            setAddOpenFor(null);
            setAddRFFor((prev) => {
              const next = { ...prev };
              delete next[prio.id];
              return next;
            });
          }}
        >
          Cancel
        </Button>
      </div>
    );
  };

  const renderPrio = (prio: PrioRow): React.ReactNode => {
    const list = junctions[prio.id] ?? [];
    const fundedSum = list.reduce((s, j) => s + (j.fundedAmount || 0), 0);
    const validatedSum = list.reduce((s, j) => s + (j.validatedAmount || 0), 0);
    const isItemized = prio.fundingMode === FUNDING_MODE_ITEMIZED;

    return (
      <div key={prio.id} className={styles.prioCard}>
        <div className={styles.prioHeader}>
          {prio.statePriority != null && (
            <Badge
              appearance="filled"
              color="informative"
              shape="rounded"
              className={styles.priorityBadge}
            >
              #{prio.statePriority}
            </Badge>
          )}
          <Link
            as="button"
            className={styles.prioName}
            onClick={() =>
              void props.navigation.openForm({
                entityName: PRIORITIZATION_ENTITY,
                entityId: prio.id,
                openInNewWindow: false,
              })
            }
          >
            {prio.name}
          </Link>
          {prio.fiscalYear != null && (
            <Badge appearance="outline" color="informative">
              {prio.fiscalYearLabel ?? `FY ${prio.fiscalYear}`}
            </Badge>
          )}
          {prio.fundingModeLabel && (
            <Badge
              appearance="tint"
              color={isItemized ? "warning" : "informative"}
            >
              {prio.fundingModeLabel}
            </Badge>
          )}
          {prio.approvalStatus && (
            <Badge appearance="tint" color={approvalColor(prio.approvalStatus)}>
              {prio.approvalStatus}
            </Badge>
          )}
          <span className={styles.prioMeta}>
            Requested{" "}
            <span className={styles.prioMetaStrong}>
              {formatCurrency(prio.requestedAmount)}
            </span>{" "}
            · Funded{" "}
            <span className={styles.prioMetaStrong}>
              {formatCurrency(prio.fundedAmount)}
            </span>{" "}
            · Validated{" "}
            <span className={styles.prioMetaStrong}>
              {formatCurrency(prio.validatedAmount)}
            </span>
          </span>
        </div>
        <div className={styles.junctionList}>
          {list.length === 0 ? (
            <div className={styles.junctionEmpty}>
              No Requirement Funding allocations yet.
            </div>
          ) : (
            <>
              <div className={`${styles.junctionRow} ${styles.junctionHead}`}>
                <div>Requirement Funding</div>
                <div>Funded</div>
                <div>Validated</div>
                <div />
                <div />
              </div>
              {list.map((j) => (
                <div key={j.id} className={styles.junctionRow}>
                  <div className={styles.rfCell}>
                    <Link
                      as="button"
                      onClick={() =>
                        void props.navigation.openForm({
                          entityName: REQUIREMENT_FUNDING_ENTITY,
                          entityId: j.rfId,
                          openInNewWindow: false,
                        })
                      }
                    >
                      {j.rfName}
                    </Link>
                  </div>
                  <div>{renderJunctionInput(j, "fundedAmount")}</div>
                  <div>{renderJunctionInput(j, "validatedAmount")}</div>
                  <div>{renderStatus(j.id)}</div>
                  <div>
                    <Tooltip content="Remove allocation" relationship="label">
                      <Button
                        appearance="subtle"
                        size="small"
                        disabled={isDisabled}
                        onClick={() => deleteJunction(j)}
                        aria-label="Remove allocation"
                      >
                        ✕
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              ))}
              <div className={`${styles.junctionRow}`} style={{ marginTop: 4 }}>
                <div className={styles.prioMeta} style={{ textAlign: "right" }}>
                  Totals
                </div>
                <div className={styles.amountCell}>{formatCurrency(fundedSum)}</div>
                <div className={styles.amountCell}>{formatCurrency(validatedSum)}</div>
                <div />
                <div />
              </div>
            </>
          )}
          {renderAddRow(prio)}
          {isItemized && (
            <Text size={200} className={styles.junctionEmpty}>
              Itemized mode: the Prioritization Funded total is driven by Itemized
              Details. Junctions are the per-RF distribution and do not roll up.
            </Text>
          )}
        </div>
      </div>
    );
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <Text weight="semibold">
              Prioritization Funding ({visiblePrios.length} of {prios.length})
            </Text>
            {fyOptions.length > 1 && (
              <div className={styles.fyFilter}>
                <Text size={200}>FY</Text>
                <Combobox
                  size="small"
                  value={
                    fyFilter === FY_FILTER_ALL ? "All" : fyLabelFor(fyFilter)
                  }
                  selectedOptions={[
                    fyFilter === FY_FILTER_ALL ? FY_FILTER_ALL : String(fyFilter),
                  ]}
                  onOptionSelect={(_e, data) => {
                    const v = data.optionValue;
                    if (!v || v === FY_FILTER_ALL) setFyFilter(FY_FILTER_ALL);
                    else setFyFilter(Number(v));
                  }}
                >
                  <Option value={FY_FILTER_ALL} text="All">
                    All
                  </Option>
                  {fyOptions.map((opt) => (
                    <Option key={opt.value} value={String(opt.value)} text={opt.label}>
                      {opt.label}
                    </Option>
                  ))}
                </Combobox>
              </div>
            )}
          </div>
          <Button
            size="small"
            appearance="subtle"
            disabled={dataset.loading || junctionsLoading}
            onClick={() => {
              dataset.refresh();
              reloadJunctions(prios.map((p) => p.id));
            }}
          >
            Refresh
          </Button>
        </div>

        {junctionsError && (
          <div className={`${styles.empty} ${styles.statusError}`}>
            {junctionsError}
          </div>
        )}

        {dataset.loading ? (
          <Spinner label="Loading Prioritizations…" />
        ) : visiblePrios.length === 0 ? (
          <div className={styles.empty}>
            No Prioritizations for this Requirement{" "}
            {fyFilter !== FY_FILTER_ALL ? `in FY ${fyFilter}` : ""}.
          </div>
        ) : (
          visiblePrios.map((p) => renderPrio(p))
        )}
      </div>
    </FluentProvider>
  );
};
