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

export interface RequirementDetailFundingGridProps {
  dataset: DataSet;
  webAPI: WebApi;
  navigation: Navigation;
  isDisabled: boolean;
  width: number;
}

/** Property-set aliases declared in ControlManifest.Input.xml. */
const ALIAS = {
  name: "name",
  item: "item",
  mdep: "mdep",
  tdc: "tdc",
  priorityOrder: "priorityOrder",
  fundedAmount: "fundedAmount",
  validatedAmount: "validatedAmount",
  requirement: "requirement",
} as const;

const REQUIREMENT_DETAIL_ENTITY = "book_requirementdetails";
const REQUIREMENT_DETAIL_FUNDING_ENTITY = "book_requirementdetailfunding";
const REQUIREMENT_FUNDING_ENTITY = "book_requirementfunding";

// Entity set names (plural) for @odata.bind URLs. PCF's WebAPI methods take
// the logical name, but bind URLs need the EntitySetName from Entity.xml.
// Note book_requirementdetails pluralises to *-es (not -s) — book_requirementfunding
// is the regular -s case.
const REQUIREMENT_DETAIL_SET = "book_requirementdetailses";
const REQUIREMENT_FUNDING_SET = "book_requirementfundings";

const FY_FILTER_ALL = "all" as const;
type FYFilter = number | typeof FY_FILTER_ALL;

interface RDRow {
  id: string;
  name: string;
  itemId: string | null;
  itemName: string | null;
  mdepName: string | null;
  tdcName: string | null;
  priorityOrder: number | null;
  fundedAmount: number | null;
  validatedAmount: number | null;
  requirementId: string | null;
  requirementName: string | null;
}

interface JunctionRow {
  id: string;
  name: string;
  requirementDetailId: string;
  rfId: string;
  rfName: string;
  rfFiscalYear: number | null;
  rfFiscalYearLabel: string | null;
  fundedAmount: number;
  validatedAmount: number;
}

interface RFOption {
  id: string;
  name: string;
  tdp: number | null;
  fiscalYear: number | null;
  fiscalYearLabel: string | null;
}

type SaveState = "saving" | "saved" | "error";
type JunctionField = "fundedAmount" | "validatedAmount";

// Dataverse subgrids default to ~4–25 rows per page. Bump to a comfortable
// page size so the NPM doesn't see "4 of N" without doing anything; users can
// still click Load more if the bucket exceeds this.
const PAGE_SIZE = 100;

const useStyles = makeStyles({
  root: {
    ...shorthands.padding("8px"),
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
  },
  rdListScroll: {
    maxHeight: "70vh",
    overflowY: "auto",
    paddingRight: "4px",
  },
  loadMoreRow: {
    display: "flex",
    justifyContent: "center",
    ...shorthands.padding("8px", "0"),
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
  rdCard: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    marginBottom: "10px",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  rdHeader: {
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
  rdName: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    flexGrow: 1,
    minWidth: "180px",
  },
  rdMeta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  rdMetaStrong: {
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

export const RequirementDetailFundingGridApp: React.FC<RequirementDetailFundingGridProps> = (
  props
) => {
  const { dataset, webAPI, isDisabled } = props;
  const styles = useStyles();

  // Bump the dataset page size once on mount. Without this Dataverse hands us
  // only the subgrid's default page (often ~4) — mirrors PrioritizationFundingGrid.
  const pageSizeApplied = React.useRef(false);
  React.useEffect(() => {
    if (pageSizeApplied.current) return;
    if (dataset.paging && typeof dataset.paging.setPageSize === "function") {
      try {
        dataset.paging.setPageSize(PAGE_SIZE);
        pageSizeApplied.current = true;
      } catch {
        // host may throw if setPageSize is called before the first load
      }
    }
  }, [dataset.paging]);

  // ---- Materialise the RDs from the dataset ----
  const rds = React.useMemo<RDRow[]>(() => {
    return dataset.sortedRecordIds
      .map((id) => {
        const r = dataset.records[id];
        const reqLookup = r.getValue(ALIAS.requirement);
        const itemLookup = r.getValue(ALIAS.item);
        return {
          id,
          name: (r.getValue(ALIAS.name) as string | null) ?? "(unnamed)",
          itemId: extractLookupId(itemLookup),
          itemName: r.getFormattedValue(ALIAS.item) ?? null,
          mdepName: r.getFormattedValue(ALIAS.mdep) ?? null,
          tdcName: r.getFormattedValue(ALIAS.tdc) ?? null,
          priorityOrder:
            (r.getValue(ALIAS.priorityOrder) as number | null) ?? null,
          fundedAmount: toNumber(r.getValue(ALIAS.fundedAmount)),
          validatedAmount: toNumber(r.getValue(ALIAS.validatedAmount)),
          requirementId: extractLookupId(reqLookup),
          requirementName: r.getFormattedValue(ALIAS.requirement) ?? null,
        };
      })
      // Sort by Priority Order (nulls sink), then Name for stable display.
      .sort((a, b) => {
        const pa = a.priorityOrder ?? Number.MAX_SAFE_INTEGER;
        const pb = b.priorityOrder ?? Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      });
  }, [dataset.sortedRecordIds, dataset.records]);

  // ---- Junction rows per RD (fetched on RD set change) ----
  const [junctions, setJunctions] = React.useState<Record<string, JunctionRow[]>>({});
  const [junctionsLoading, setJunctionsLoading] = React.useState<boolean>(false);
  const [junctionsError, setJunctionsError] = React.useState<string | null>(null);

  const reloadJunctions = React.useCallback(
    (rdIds: string[]) => {
      if (rdIds.length === 0) {
        setJunctions({});
        return;
      }
      setJunctionsLoading(true);
      setJunctionsError(null);

      const orClause = rdIds
        .map((id) => `_book_requirementdetail_value eq ${id}`)
        .join(" or ");
      const select =
        "?$select=book_name,book_fundedamount,book_validatedamount," +
        "_book_requirementdetail_value,_book_requirementfunding_value" +
        "&$expand=book_RequirementFunding($select=book_name,book_newfiscalyear)" +
        `&$filter=statecode eq 0 and (${orClause})`;

      webAPI
        .retrieveMultipleRecords(REQUIREMENT_DETAIL_FUNDING_ENTITY, select)
        .then((res) => {
          const byRD: Record<string, JunctionRow[]> = {};
          for (const id of rdIds) byRD[id] = [];
          for (const e of res.entities) {
            const rdId = ((e._book_requirementdetail_value as string) ?? "")
              .replace(/[{}]/g, "")
              .toLowerCase();
            const rfId = ((e._book_requirementfunding_value as string) ?? "")
              .replace(/[{}]/g, "")
              .toLowerCase();
            const rf = e.book_RequirementFunding as
              | { book_name?: string; book_newfiscalyear?: number }
              | undefined;
            const row: JunctionRow = {
              id: e.book_requirementdetailfundingid as string,
              name: (e.book_name as string) ?? "",
              requirementDetailId: rdId,
              rfId,
              rfName: rf?.book_name ?? "(RF)",
              rfFiscalYear: rf?.book_newfiscalyear ?? null,
              rfFiscalYearLabel:
                e["book_RequirementFunding@OData.Community.Display.V1.FormattedValue"] as string ??
                null,
              fundedAmount: toNumber(e.book_fundedamount) ?? 0,
              validatedAmount: toNumber(e.book_validatedamount) ?? 0,
            };
            if (!byRD[rdId]) byRD[rdId] = [];
            byRD[rdId].push(row);
          }
          for (const id of Object.keys(byRD)) {
            byRD[id].sort((a, b) => a.rfName.localeCompare(b.rfName));
          }
          setJunctions(byRD);
          setJunctionsLoading(false);
          return;
        })
        .catch((err: unknown) => {
          setJunctionsError(
            err instanceof Error ? err.message : "Failed to load Requirement Detail Fundings."
          );
          setJunctionsLoading(false);
        });
    },
    [webAPI]
  );

  // Re-fetch when the visible RD set changes.
  const rdIdsKey = rds.map((r) => r.id).join("|");
  React.useEffect(() => {
    reloadJunctions(rds.map((r) => r.id));
  }, [rdIdsKey, reloadJunctions]);

  // ---- Eligible RFs for the parent Requirement ----
  // Parent Requirement is shared across all rows in the subgrid; pick the
  // first row's value.
  const parentRequirementId = React.useMemo<string | null>(() => {
    for (const r of rds) if (r.requirementId) return r.requirementId;
    return null;
  }, [rds]);

  const [rfs, setRfs] = React.useState<RFOption[] | null>(null);
  const [rfsLoading, setRfsLoading] = React.useState<boolean>(false);

  const ensureRFs = React.useCallback((): void => {
    if (!parentRequirementId) return;
    if (rfs !== null || rfsLoading) return;
    setRfsLoading(true);

    const select =
      "?$select=book_name,book_newtdp,book_newfiscalyear" +
      `&$filter=_book_requirement_value eq ${parentRequirementId}` +
      " and statecode eq 0";

    webAPI
      .retrieveMultipleRecords(REQUIREMENT_FUNDING_ENTITY, select)
      .then((res) => {
        const options: RFOption[] = res.entities.map((e) => ({
          id: e.book_requirementfundingid as string,
          name: (e.book_name as string) ?? "(RF)",
          tdp: toNumber(e.book_newtdp),
          fiscalYear: (e.book_newfiscalyear as number | null) ?? null,
          fiscalYearLabel:
            (e["book_newfiscalyear@OData.Community.Display.V1.FormattedValue"] as string) ??
            null,
        }));
        options.sort((a, b) => a.name.localeCompare(b.name));
        setRfs(options);
        setRfsLoading(false);
        return;
      })
      .catch(() => {
        setRfs([]);
        setRfsLoading(false);
      });
  }, [parentRequirementId, rfs, rfsLoading, webAPI]);

  // Load RFs once we know the parent — drives the FY filter options too.
  React.useEffect(() => {
    ensureRFs();
  }, [ensureRFs]);

  // ---- FY filter (over RF FYs — RD has no FY of its own) ----
  const fyOptions = React.useMemo<{ value: number; label: string }[]>(() => {
    const seen = new Map<number, string>();
    for (const rf of rfs ?? []) {
      if (rf.fiscalYear == null) continue;
      if (!seen.has(rf.fiscalYear)) {
        seen.set(rf.fiscalYear, rf.fiscalYearLabel ?? `FY ${rf.fiscalYear}`);
      }
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => b.value - a.value);
  }, [rfs]);

  const fyLabelFor = (value: number | null): string => {
    if (value == null) return "";
    const hit = fyOptions.find((o) => o.value === value);
    return hit?.label ?? `FY ${value}`;
  };

  // Default to the newest FY so legacy RFs don't clutter the picker by default.
  const [fyFilter, setFyFilter] = React.useState<FYFilter>(FY_FILTER_ALL);
  const fyDefaultApplied = React.useRef(false);

  React.useEffect(() => {
    if (fyOptions.length === 0) return;

    if (!fyDefaultApplied.current) {
      setFyFilter(fyOptions[0].value);
      fyDefaultApplied.current = true;
      return;
    }

    if (fyFilter !== FY_FILTER_ALL && !fyOptions.some((o) => o.value === fyFilter)) {
      setFyFilter(FY_FILTER_ALL);
    }
  }, [fyOptions, fyFilter]);

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
      .updateRecord(REQUIREMENT_DETAIL_FUNDING_ENTITY, row.id, {
        [logicalField]: newValue,
      })
      .then(() => {
        setSaveState((prev) => ({ ...prev, [row.id]: "saved" }));
        setJunctions((prev) => {
          const list = prev[row.requirementDetailId];
          if (!list) return prev;
          return {
            ...prev,
            [row.requirementDetailId]: list.map((j) =>
              j.id === row.id ? { ...j, [field]: newValue } : j
            ),
          };
        });
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

  const createJunction = (rd: RDRow): void => {
    const rfId = addRFFor[rd.id];
    if (!rfId) return;
    setAdding((prev) => ({ ...prev, [rd.id]: true }));

    const payload = {
      [`book_RequirementDetail@odata.bind`]: `/${REQUIREMENT_DETAIL_SET}(${rd.id})`,
      [`book_RequirementFunding@odata.bind`]: `/${REQUIREMENT_FUNDING_SET}(${rfId})`,
      book_fundedamount: 0,
      book_validatedamount: 0,
    };

    webAPI
      .createRecord(REQUIREMENT_DETAIL_FUNDING_ENTITY, payload)
      .then(() => {
        setAddOpenFor(null);
        setAddRFFor((prev) => {
          const next = { ...prev };
          delete next[rd.id];
          return next;
        });
        setAdding((prev) => ({ ...prev, [rd.id]: false }));
        reloadJunctions(rds.map((r) => r.id));
        dataset.refresh();
        return;
      })
      .catch((err: unknown) => {
        setAdding((prev) => ({ ...prev, [rd.id]: false }));
        setJunctionsError(
          err instanceof Error
            ? err.message
            : "Failed to add Requirement Detail Funding."
        );
      });
  };

  // ---- Delete junction ----
  const deleteJunction = (row: JunctionRow): void => {
    setSaveState((prev) => ({ ...prev, [row.id]: "saving" }));
    webAPI
      .deleteRecord(REQUIREMENT_DETAIL_FUNDING_ENTITY, row.id)
      .then(() => {
        setJunctions((prev) => {
          const list = prev[row.requirementDetailId];
          if (!list) return prev;
          return {
            ...prev,
            [row.requirementDetailId]: list.filter((j) => j.id !== row.id),
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

  const renderAddRow = (rd: RDRow): React.ReactNode => {
    const allRFs = rfs ?? [];
    const usedIds = new Set((junctions[rd.id] ?? []).map((j) => j.rfId));
    const eligibleRFs = allRFs
      .filter((rf) => !usedIds.has(rf.id))
      .filter((rf) => fyFilter === FY_FILTER_ALL || rf.fiscalYear === fyFilter);
    const selectedId = addRFFor[rd.id] ?? "";
    const selectedName = eligibleRFs.find((rf) => rf.id === selectedId)?.name ?? "";

    const isOpen = addOpenFor === rd.id;
    if (!isOpen) {
      return (
        <div className={styles.addRow}>
          <Button
            appearance="subtle"
            size="small"
            disabled={isDisabled}
            onClick={() => {
              setAddOpenFor(rd.id);
              ensureRFs();
            }}
          >
            + Add from RF
          </Button>
        </div>
      );
    }

    return (
      <div className={styles.addRow}>
        {rfsLoading ? (
          <Spinner size="extra-tiny" label="Loading RFs…" labelPosition="after" />
        ) : eligibleRFs.length === 0 ? (
          <Text size={200} className={styles.junctionEmpty}>
            No additional{" "}
            {fyFilter === FY_FILTER_ALL ? "" : `${fyLabelFor(fyFilter)} `}Requirement
            Fundings available for this Requirement.
          </Text>
        ) : (
          <Combobox
            className={styles.addCombo}
            size="small"
            placeholder={
              fyFilter === FY_FILTER_ALL
                ? "Select a Requirement Funding"
                : `Select an ${fyLabelFor(fyFilter)} Requirement Funding`
            }
            value={selectedName}
            selectedOptions={selectedId ? [selectedId] : []}
            onOptionSelect={(_e, data) =>
              setAddRFFor((prev) => ({ ...prev, [rd.id]: data.optionValue ?? "" }))
            }
            disabled={isDisabled}
          >
            {eligibleRFs.map((rf) => (
              <Option key={rf.id} value={rf.id} text={rf.name}>
                {rf.name}
                {rf.fiscalYearLabel ? ` — ${rf.fiscalYearLabel}` : ""}
                {rf.tdp != null ? ` — TDP ${formatCurrency(rf.tdp)}` : ""}
              </Option>
            ))}
          </Combobox>
        )}
        <Button
          appearance="primary"
          size="small"
          disabled={isDisabled || !selectedId || adding[rd.id]}
          onClick={() => createJunction(rd)}
        >
          {adding[rd.id] ? "Adding…" : "Add"}
        </Button>
        <Button
          appearance="subtle"
          size="small"
          onClick={() => {
            setAddOpenFor(null);
            setAddRFFor((prev) => {
              const next = { ...prev };
              delete next[rd.id];
              return next;
            });
          }}
        >
          Cancel
        </Button>
      </div>
    );
  };

  const renderRD = (rd: RDRow): React.ReactNode => {
    const list = junctions[rd.id] ?? [];
    const fundedSum = list.reduce((s, j) => s + (j.fundedAmount || 0), 0);
    const validatedSum = list.reduce((s, j) => s + (j.validatedAmount || 0), 0);

    return (
      <div key={rd.id} className={styles.rdCard}>
        <div className={styles.rdHeader}>
          {rd.priorityOrder != null && (
            <Badge
              appearance="filled"
              color="informative"
              shape="rounded"
              className={styles.priorityBadge}
            >
              #{rd.priorityOrder}
            </Badge>
          )}
          <Link
            as="button"
            className={styles.rdName}
            onClick={() =>
              void props.navigation.openForm({
                entityName: REQUIREMENT_DETAIL_ENTITY,
                entityId: rd.id,
                openInNewWindow: false,
              })
            }
          >
            {rd.name}
          </Link>
          {rd.itemName && (
            <Badge appearance="tint" color="brand">
              {rd.itemName}
            </Badge>
          )}
          {rd.tdcName && (
            <Badge appearance="outline" color="informative">
              TDC {rd.tdcName}
            </Badge>
          )}
          {rd.mdepName && (
            <Badge appearance="outline" color="informative">
              MDEP {rd.mdepName}
            </Badge>
          )}
          <span className={styles.rdMeta}>
            Funded{" "}
            <span className={styles.rdMetaStrong}>
              {formatCurrency(rd.fundedAmount)}
            </span>{" "}
            · Validated{" "}
            <span className={styles.rdMetaStrong}>
              {formatCurrency(rd.validatedAmount)}
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
                    {j.rfFiscalYear != null && (
                      <>
                        {" "}
                        <Badge appearance="outline" color="informative">
                          {j.rfFiscalYearLabel ?? fyLabelFor(j.rfFiscalYear)}
                        </Badge>
                      </>
                    )}
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
                <div className={styles.rdMeta} style={{ textAlign: "right" }}>
                  Totals
                </div>
                <div className={styles.amountCell}>{formatCurrency(fundedSum)}</div>
                <div className={styles.amountCell}>{formatCurrency(validatedSum)}</div>
                <div />
                <div />
              </div>
            </>
          )}
          {renderAddRow(rd)}
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
              Requirement Detail Funding ({rds.length})
            </Text>
            {fyOptions.length > 0 && (
              <div className={styles.fyFilter}>
                <Text size={200}>RF FY</Text>
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
              reloadJunctions(rds.map((r) => r.id));
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
          <Spinner label="Loading Requirement Details…" />
        ) : rds.length === 0 ? (
          <div className={styles.empty}>
            No Requirement Details for this Requirement.
          </div>
        ) : (
          <div className={styles.rdListScroll}>
            {rds.map((r) => renderRD(r))}
            {dataset.paging && dataset.paging.hasNextPage && (
              <div className={styles.loadMoreRow}>
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={() => dataset.paging.loadNextPage()}
                >
                  Load more Requirement Details
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
