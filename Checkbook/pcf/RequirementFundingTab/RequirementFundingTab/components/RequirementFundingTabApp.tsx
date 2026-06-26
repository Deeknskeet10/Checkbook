import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Text,
  Spinner,
  Combobox,
  Option,
  Badge,
} from "@fluentui/react-components";

import {
  RequirementDetailsRankApp,
} from "../../../RequirementDetailsRank/RequirementDetailsRank/RequirementDetailsRankApp";
import {
  PrioritizationFundingGridApp,
  PrioRow,
} from "../../../PrioritizationFundingGrid/PrioritizationFundingGrid/components/PrioritizationFundingGridApp";
import {
  RequirementDetailFundingGridApp,
  RDRow,
} from "../../../RequirementDetailFundingGrid/RequirementDetailFundingGrid/components/RequirementDetailFundingGridApp";

export interface RequirementFundingTabAppProps {
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  parentRequirementId: string | null;
  isDisabled: boolean;
}

const FY_FILTER_ALL = "all" as const;
type FYFilter = number | typeof FY_FILTER_ALL;

const FV = "@OData.Community.Display.V1.FormattedValue";
const RF_ENTITY = "book_requirementfunding";
const PRIO_ENTITY = "book_prioritization";
const RD_ENTITY = "book_requirementdetails";

// Federal FY: Oct–Sept, named for ending year. Oct 2025 = FY 2026.
function currentFiscalYear(now: Date = new Date()): number {
  return now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
}

function stripBraces(s: string | null | undefined): string {
  return (s ?? "").replace(/[{}]/g, "").toLowerCase();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(n: number | null): string {
  if (n == null) return "";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

interface RFRow {
  id: string;
  name: string;
  tdp: number | null;
  funded: number | null;
  withholding: number | null;
  fiscalYear: number | null;
  fiscalYearLabel: string | null;
}

export const RequirementFundingTabApp: React.FC<RequirementFundingTabAppProps> = (
  props
) => {
  const { webAPI, navigation, parentRequirementId, isDisabled } = props;

  const [prios, setPrios] = React.useState<PrioRow[]>([]);
  const [rds, setRds] = React.useState<RDRow[]>([]);
  const [rfs, setRfs] = React.useState<RFRow[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!parentRequirementId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const filter = `_book_requirement_value eq ${parentRequirementId} and statecode eq 0`;

    const prioSelect =
      "?$select=book_prioritizationid,book_name,book_statepriority," +
      "book_approvalstatus,book_newfiscalyear,book_fundingmode," +
      "book_requestedamount,book_newfundedamounttdp,book_validatedamount," +
      "_book_requirement_value,_book_state_value&$filter=" + filter;

    const rdSelect =
      "?$select=book_requirementdetailsid,book_name,_book_item_value," +
      "_book_mdep_value,_book_tdc_value,book_priorityorder," +
      "book_fundedamount,book_validatedamount,_book_requirement_value" +
      "&$filter=" + filter;

    const rfSelect =
      "?$select=book_requirementfundingid,book_name,book_newtdp," +
      "book_newfundedamount,book_newwithholding,book_newfiscalyear" +
      "&$filter=" + filter;

    Promise.all([
      webAPI.retrieveMultipleRecords(PRIO_ENTITY, prioSelect),
      webAPI.retrieveMultipleRecords(RD_ENTITY, rdSelect),
      webAPI.retrieveMultipleRecords(RF_ENTITY, rfSelect),
    ])
      .then(([prRes, rdRes, rfRes]) => {
        if (cancelled) return;

        const nextPrios: PrioRow[] = prRes.entities.map(
          (e: Record<string, unknown>) => ({
            id: e.book_prioritizationid as string,
            name: (e.book_name as string) ?? "(unnamed)",
            statePriority: (e.book_statepriority as number | null) ?? null,
            approvalStatus:
              (e[`book_approvalstatus${FV}`] as string | undefined) ?? null,
            fiscalYear: (e.book_newfiscalyear as number | null) ?? null,
            fiscalYearLabel:
              (e[`book_newfiscalyear${FV}`] as string | undefined) ?? null,
            stateName:
              (e[`_book_state_value${FV}`] as string | undefined) ?? null,
            fundingMode: (e.book_fundingmode as number | null) ?? null,
            fundingModeLabel:
              (e[`book_fundingmode${FV}`] as string | undefined) ?? null,
            requestedAmount: num(e.book_requestedamount),
            fundedAmount: num(e.book_newfundedamounttdp),
            validatedAmount: num(e.book_validatedamount),
            requirementId: stripBraces(e._book_requirement_value as string),
            requirementName:
              (e[`_book_requirement_value${FV}`] as string | undefined) ?? null,
          })
        );

        const nextRds: RDRow[] = rdRes.entities.map(
          (e: Record<string, unknown>) => ({
            id: e.book_requirementdetailsid as string,
            name: (e.book_name as string) ?? "(unnamed)",
            itemId: stripBraces(e._book_item_value as string) || null,
            itemName:
              (e[`_book_item_value${FV}`] as string | undefined) ?? null,
            mdepName:
              (e[`_book_mdep_value${FV}`] as string | undefined) ?? null,
            tdcName:
              (e[`_book_tdc_value${FV}`] as string | undefined) ?? null,
            priorityOrder: (e.book_priorityorder as number | null) ?? null,
            fundedAmount: numOrNull(e.book_fundedamount),
            validatedAmount: numOrNull(e.book_validatedamount),
            requirementId: stripBraces(e._book_requirement_value as string),
            requirementName:
              (e[`_book_requirement_value${FV}`] as string | undefined) ?? null,
          })
        );

        const nextRfs: RFRow[] = rfRes.entities.map(
          (e: Record<string, unknown>) => ({
            id: e.book_requirementfundingid as string,
            name: (e.book_name as string) ?? "(unnamed)",
            tdp: numOrNull(e.book_newtdp),
            funded: numOrNull(e.book_newfundedamount),
            withholding: numOrNull(e.book_newwithholding),
            fiscalYear: (e.book_newfiscalyear as number | null) ?? null,
            fiscalYearLabel:
              (e[`book_newfiscalyear${FV}`] as string | undefined) ?? null,
          })
        );

        setPrios(nextPrios);
        setRds(nextRds);
        setRfs(nextRfs);
        setLoading(false);
        return null;
      })
      .catch((err: { message?: string }) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load Requirement Funding data.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [parentRequirementId, webAPI, reloadKey]);

  const fyOptions = React.useMemo<{ value: number; label: string }[]>(() => {
    const seen = new Map<number, string>();
    for (const p of prios) {
      if (p.fiscalYear == null) continue;
      if (!seen.has(p.fiscalYear)) {
        seen.set(p.fiscalYear, p.fiscalYearLabel ?? `FY ${p.fiscalYear}`);
      }
    }
    for (const rf of rfs) {
      if (rf.fiscalYear == null) continue;
      if (!seen.has(rf.fiscalYear)) {
        seen.set(rf.fiscalYear, rf.fiscalYearLabel ?? `FY ${rf.fiscalYear}`);
      }
    }
    return Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => b.value - a.value);
  }, [prios, rfs]);

  const [fyFilter, setFyFilter] = React.useState<FYFilter>(FY_FILTER_ALL);
  const fyDefaultApplied = React.useRef(false);

  React.useEffect(() => {
    if (fyOptions.length === 0) return;
    if (!fyDefaultApplied.current) {
      const cur = currentFiscalYear();
      const match = fyOptions.find((o) => o.label.includes(String(cur)));
      setFyFilter(match ? match.value : fyOptions[0].value);
      fyDefaultApplied.current = true;
    } else if (
      fyFilter !== FY_FILTER_ALL &&
      !fyOptions.some((o) => o.value === fyFilter)
    ) {
      setFyFilter(FY_FILTER_ALL);
    }
  }, [fyOptions, fyFilter]);

  const fyLabelFor = (value: number | null): string => {
    if (value == null) return "All";
    return fyOptions.find((o) => o.value === value)?.label ?? `FY ${value}`;
  };

  // Visibility per the spec confirmed with the user:
  // Sec 1: show if RDs exist
  // Sec 2: always show (FY-filtered)
  // Sec 3: show if Prios exist
  // Sec 4: show if RDs exist AND no Prios
  const hasPrios = prios.length > 0;
  const hasRDs = rds.length > 0;
  const showSec1 = hasRDs;
  const showSec3 = hasPrios;
  const showSec4 = hasRDs && !hasPrios;

  const refresh = React.useCallback(() => setReloadKey((k) => k + 1), []);

  const visibleRfs = React.useMemo(() => {
    if (fyFilter === FY_FILTER_ALL) return rfs;
    return rfs.filter((r) => r.fiscalYear === fyFilter);
  }, [rfs, fyFilter]);

  if (!parentRequirementId) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className="book-rft-root">
          <div className="book-rft-empty">
            Save the Requirement to view its funding.
          </div>
        </div>
      </FluentProvider>
    );
  }

  return (
    <FluentProvider theme={webLightTheme}>
      <div className="book-rft-root">
        <div className="book-rft-toolbar">
          <Text weight="semibold" size={400}>
            Funding
          </Text>
          {fyOptions.length > 0 && (
            <>
              <Text size={200}>Fiscal Year</Text>
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
            </>
          )}
          <Badge appearance="outline" color="informative">
            {prios.length} Prio{prios.length === 1 ? "" : "s"} · {rds.length} RD
            {rds.length === 1 ? "" : "s"} · {rfs.length} RF
            {rfs.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {loading && <Spinner label="Loading funding data…" />}
        {error && <div className="book-rft-empty">{error}</div>}

        {!loading && !error && (
          <>
            {showSec1 && (
              <section className="book-rft-section">
                <div className="book-rft-section-header">Requirement Details</div>
                <div className="book-rft-section-body">
                  <RequirementDetailsRankApp
                    webAPI={webAPI}
                    navigation={navigation}
                    parentRequirementId={parentRequirementId}
                    initialRowsOverride={rds.map((r) => ({
                      id: r.id,
                      name: r.name,
                      priorityOrder: r.priorityOrder,
                      itemId: r.itemId,
                      itemLabel: r.itemName,
                      tdcLabel: r.tdcName,
                    }))}
                    onRefresh={refresh}
                    hideHeader
                  />
                </div>
              </section>
            )}

            <section className="book-rft-section">
              <div className="book-rft-section-header">
                Requirement Fundings ({visibleRfs.length})
              </div>
              <div className="book-rft-section-body">
                {visibleRfs.length === 0 ? (
                  <div className="book-rft-empty">
                    No Requirement Fundings
                    {fyFilter !== FY_FILTER_ALL
                      ? ` for ${fyLabelFor(fyFilter)}`
                      : ""}
                    .
                  </div>
                ) : (
                  <table className="book-rft-rf-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>FY</th>
                        <th className="book-rft-rf-num">TDP</th>
                        <th className="book-rft-rf-num">Funded</th>
                        <th className="book-rft-rf-num">Withholding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRfs.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <a
                              className="book-rft-rf-link"
                              onClick={() =>
                                void navigation.openForm({
                                  entityName: RF_ENTITY,
                                  entityId: r.id,
                                })
                              }
                            >
                              {r.name}
                            </a>
                          </td>
                          <td>
                            {r.fiscalYearLabel ??
                              (r.fiscalYear != null
                                ? `FY ${r.fiscalYear}`
                                : "")}
                          </td>
                          <td className="book-rft-rf-num">{formatMoney(r.tdp)}</td>
                          <td className="book-rft-rf-num">{formatMoney(r.funded)}</td>
                          <td className="book-rft-rf-num">
                            {formatMoney(r.withholding)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {showSec3 && (
              <section className="book-rft-section">
                <div className="book-rft-section-header">
                  Funding by Prioritizations
                </div>
                <div className="book-rft-section-body">
                  <PrioritizationFundingGridApp
                    webAPI={webAPI}
                    navigation={navigation}
                    isDisabled={isDisabled}
                    width={0}
                    prioRowsOverride={prios}
                    fyFilterOverride={fyFilter}
                    hideTitle
                    onAfterSave={refresh}
                  />
                </div>
              </section>
            )}

            {showSec4 && (
              <section className="book-rft-section">
                <div className="book-rft-section-header">
                  Funding by Requirement Details
                </div>
                <div className="book-rft-section-body">
                  <RequirementDetailFundingGridApp
                    webAPI={webAPI}
                    navigation={navigation}
                    isDisabled={isDisabled}
                    width={0}
                    rdRowsOverride={rds}
                    fyFilterOverride={fyFilter}
                    hideTitle
                    onAfterSave={refresh}
                  />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </FluentProvider>
  );
};
