import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
  Input,
  Textarea,
  Spinner,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;

export interface ValidateAndFundGridProps {
  dataset: DataSet;
  webAPI: WebApi;
  navigation: ComponentFramework.Navigation;
  isDisabled: boolean;
  requirementFundingId?: string;
  requirementFundingName?: string;
}

const PRIORITIZATION_ENTITY = "book_prioritization";
const ITEMIZED_DETAILS_ENTITY = "book_itemizeddetails";
const REQUIREMENT_FUNDING_ENTITY = "book_requirementfunding";
const FV = "@OData.Community.Display.V1.FormattedValue";

/** Prioritization decimal fields (the float twins are being retired). */
const PRIO_VALIDATED = "book_validatedamount";
const PRIO_FUNDED = "book_newfundedamounttdp";
/** Itemized Details decimal fields. */
const ITEM_VALIDATED = "book_validatedamount";
const ITEM_FUNDED = "book_fundedamount";
const ITEM_NPM_COMMENT = "book_npmcomment";

interface PrioRow {
  id: string;
  stateName: string;
  statePriority: number | null;
  requested: number;
  validated: number;
  funded: number;
}

interface ItemRow {
  id: string;
  prioritizationId: string;
  label: string;
  requested: number;
  validated: number;
  funded: number;
  npmComment: string;
}

const fmtMoney = (n: number | null | undefined): string =>
  n == null
    ? "$0.00"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const parseMoney = (s: string): number => {
  if (s == null) return 0;
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
};

/**
 * Sanitize free-typed currency text: digits, an optional leading `-`, and at
 * most one decimal point followed by up to two digits. Keeps the user's
 * literal text so partial decimals like "100." don't snap back to "100".
 */
const sanitizeMoneyText = (s: string): string => {
  let out = (s ?? "").replace(/[^0-9.-]/g, "");
  // Only one leading `-`.
  const neg = out.startsWith("-");
  out = (neg ? "-" : "") + out.replace(/-/g, "");
  // Only one decimal point.
  const dot = out.indexOf(".");
  if (dot !== -1) {
    out =
      out.slice(0, dot + 1) +
      out.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  }
  return out;
};

/**
 * Right-aligned currency input that preserves the literal text the user is
 * typing (including a trailing "." or "100.5" en route to "100.50"). Reports
 * the parsed numeric value to the parent on every keystroke, and reformats
 * the displayed text to two decimal places on blur.
 */
const MoneyInput: React.FC<{
  value: number;
  onChange: (n: number) => void;
}> = ({ value, onChange }) => {
  const [text, setText] = React.useState<string>(() =>
    value === 0 ? "" : value.toFixed(2),
  );
  // Track the numeric value we last emitted so external resets (cancel, reload)
  // re-seed the displayed text without clobbering in-progress typing.
  const lastEmittedRef = React.useRef<number>(value);
  React.useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setText(value === 0 ? "" : value.toFixed(2));
      lastEmittedRef.current = value;
    }
  }, [value]);

  return (
    <Input
      appearance="outline"
      value={text}
      onChange={(_e, d) => {
        const cleaned = sanitizeMoneyText(d.value);
        setText(cleaned);
        const parsed = parseMoney(cleaned);
        lastEmittedRef.current = parsed;
        onChange(parsed);
      }}
      onBlur={() => {
        const parsed = parseMoney(text);
        const formatted = text.trim() === "" ? "" : parsed.toFixed(2);
        setText(formatted);
        if (parsed !== lastEmittedRef.current) {
          lastEmittedRef.current = parsed;
          onChange(parsed);
        }
      }}
      style={{ maxWidth: 140, marginLeft: "auto", marginRight: "auto" }}
      input={{
        style: { textAlign: "center", fontVariantNumeric: "tabular-nums" },
      }}
    />
  );
};

const stripBraces = (id: string): string =>
  id.replace(/[{}]/g, "").toLowerCase();

const getLookupName = (v: unknown): string => {
  if (!v) return "";
  if (Array.isArray(v)) return (v[0] as { name?: string })?.name ?? "";
  return (v as { name?: string }).name ?? "";
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const ValidateAndFundGridApp: React.FC<ValidateAndFundGridProps> = (
  props
) => {
  const { dataset, webAPI, navigation, isDisabled, requirementFundingId, requirementFundingName } =
    props;

  // --- Prioritization rows straight from the dataset --------------------
  const initialPrioRows = React.useMemo<PrioRow[]>(() => {
    return dataset.sortedRecordIds
      .map((id) => dataset.records[id])
      .map((r) => ({
        id: r.getRecordId(),
        stateName: getLookupName(r.getValue("state")),
        statePriority: (r.getValue("statePriority") as number | null) ?? null,
        requested: num(r.getValue("requestedAmount")),
        validated: num(r.getValue("validatedAmount")),
        funded: num(r.getValue("fundedAmount")),
      }))
      .sort((a, b) => {
        const byState = a.stateName.localeCompare(b.stateName);
        if (byState !== 0) return byState;
        const pa = a.statePriority ?? Number.MAX_SAFE_INTEGER;
        const pb = b.statePriority ?? Number.MAX_SAFE_INTEGER;
        return pa - pb;
      });
  }, [dataset.sortedRecordIds.join("|")]);

  const [prioRows, setPrioRows] = React.useState<PrioRow[]>(initialPrioRows);
  const [itemRows, setItemRows] = React.useState<ItemRow[]>([]);
  const [baselinePrio, setBaselinePrio] = React.useState<PrioRow[]>(initialPrioRows);
  const [baselineItems, setBaselineItems] = React.useState<ItemRow[]>([]);

  const [editMode, setEditMode] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loadingItems, setLoadingItems] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [tdp, setTdp] = React.useState<number | null>(null);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    setPrioRows(initialPrioRows);
    setBaselinePrio(initialPrioRows);
  }, [initialPrioRows]);

  // --- Itemized Details for every child Prioritization (one query) ------
  React.useEffect(() => {
    let cancelled = false;
    const ids = initialPrioRows.map((r) => r.id);
    if (ids.length === 0) {
      setItemRows([]);
      setBaselineItems([]);
      setLoadingItems(false);
      return;
    }
    setLoadingItems(true);
    const filter = ids
      .map((id) => `_book_prioritization_value eq ${stripBraces(id)}`)
      .join(" or ");
    const options =
      "?$select=_book_prioritization_value,_book_requirementitem_value," +
      `book_requestedamount,${ITEM_VALIDATED},${ITEM_FUNDED},${ITEM_NPM_COMMENT}` +
      `&$filter=(${filter})`;

    void (async () => {
      try {
        const res = await webAPI.retrieveMultipleRecords(
          ITEMIZED_DETAILS_ENTITY,
          options
        );
        if (cancelled) return;
        const rows: ItemRow[] = res.entities.map((e) => ({
          id: e.book_itemizeddetailsid as string,
          prioritizationId: stripBraces(
            (e._book_prioritization_value as string) ?? ""
          ),
          label:
            (e[`_book_requirementitem_value${FV}`] as string) ||
            "(unnamed line item)",
          requested: num(e.book_requestedamount),
          validated: num(e[ITEM_VALIDATED]),
          funded: num(e[ITEM_FUNDED]),
          npmComment: (e[ITEM_NPM_COMMENT] as string) ?? "",
        }));
        setItemRows(rows);
        setBaselineItems(rows);
      } catch {
        if (!cancelled) setError("Could not load Itemized Details.");
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialPrioRows, webAPI, reloadKey]);

  // --- Requirement Funding TDP (the funding pool) -----------------------
  React.useEffect(() => {
    if (!requirementFundingId) return;
    const id = stripBraces(requirementFundingId);
    void (async () => {
      try {
        const rec = await webAPI.retrieveRecord(
          REQUIREMENT_FUNDING_ENTITY,
          id,
          "?$select=book_newtdp"
        );
        setTdp(num(rec.book_newtdp));
      } catch {
        setTdp(null);
      }
    })();
  }, [requirementFundingId, webAPI]);

  // --- Derived helpers --------------------------------------------------
  const itemsFor = React.useCallback(
    (prioId: string) => itemRows.filter((i) => i.prioritizationId === prioId),
    [itemRows]
  );
  const hasItemized = React.useCallback(
    (prioId: string) => itemsFor(prioId).length > 0,
    [itemsFor]
  );

  /** Effective Validated/Funded for a row — summed from Itemized Details when present. */
  const effective = React.useCallback(
    (prio: PrioRow): { validated: number; funded: number; derived: boolean } => {
      const items = itemsFor(prio.id);
      if (items.length > 0) {
        return {
          validated: items.reduce((s, i) => s + i.validated, 0),
          funded: items.reduce((s, i) => s + i.funded, 0),
          derived: true,
        };
      }
      return { validated: prio.validated, funded: prio.funded, derived: false };
    },
    [itemsFor]
  );

  const totals = React.useMemo(() => {
    let requested = 0,
      validated = 0,
      funded = 0,
      unfunded = 0;
    for (const p of prioRows) {
      const eff = effective(p);
      requested += p.requested;
      validated += eff.validated;
      funded += eff.funded;
      unfunded += Math.max(p.requested - eff.funded, 0);
    }
    return { requested, validated, funded, unfunded };
  }, [prioRows, effective]);

  // Withhold == Available == TDP − Funded. It is maintained as a field on the
  // Requirement Funding by the plugins; computed here from live edits purely as
  // an at-a-glance guardrail. The plugins remain the enforcer on save.
  const available = (tdp ?? 0) - totals.funded;
  const overAllocated = tdp != null && totals.funded > tdp;

  // --- Editing ----------------------------------------------------------
  const updatePrioMoney = (
    id: string,
    field: "validated" | "funded",
    value: number
  ): void => {
    setPrioRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const updateItemMoney = (
    id: string,
    field: "validated" | "funded",
    value: number
  ): void => {
    setItemRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const updateItemComment = (id: string, raw: string): void => {
    setItemRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, npmComment: raw } : r))
    );
  };

  const onCancel = (): void => {
    setPrioRows(baselinePrio);
    setItemRows(baselineItems);
    setEditMode(false);
    setError(null);
    setSuccess(null);
  };

  const onSave = async (): Promise<void> => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      // Direct Prioritizations (no Itemized Details) that changed.
      const prioBase = new Map(baselinePrio.map((r) => [r.id, r]));
      for (const r of prioRows) {
        if (hasItemized(r.id)) continue;
        const base = prioBase.get(r.id);
        if (base && base.validated === r.validated && base.funded === r.funded)
          continue;
        await webAPI.updateRecord(PRIORITIZATION_ENTITY, r.id, {
          [PRIO_VALIDATED]: r.validated,
          [PRIO_FUNDED]: r.funded,
        });
      }

      // Itemized Details that changed.
      const itemBase = new Map(baselineItems.map((r) => [r.id, r]));
      for (const it of itemRows) {
        const base = itemBase.get(it.id);
        if (
          base &&
          base.validated === it.validated &&
          base.funded === it.funded &&
          base.npmComment === it.npmComment
        )
          continue;
        await webAPI.updateRecord(ITEMIZED_DETAILS_ENTITY, it.id, {
          [ITEM_VALIDATED]: it.validated,
          [ITEM_FUNDED]: it.funded,
          [ITEM_NPM_COMMENT]: it.npmComment.trim() === "" ? null : it.npmComment,
        });
      }

      // The Prioritization→Requirement Funding roll-up is maintained by the
      // project's plugins — the grid does not write it.
      setSuccess("Validation & funding saved.");
      setEditMode(false);
      dataset.refresh();
      setReloadKey((k) => k + 1);
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setError(msg ?? "Save failed. Please try again or contact support.");
    } finally {
      setSaving(false);
    }
  };

  const toggleExpand = (id: string): void =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // --- Render -----------------------------------------------------------
  const stat = (
    label: string,
    value: string,
    tone: "neutral" | "good" | "warn" | "bad" = "neutral"
  ): React.ReactElement => {
    const palette = {
      neutral: { bg: "#FFFFFF", border: "#EDEBE9", color: "#323130" },
      good: { bg: "#DFF6DD", border: "#107C10", color: "#0E5A0E" },
      warn: { bg: "#FFF4CE", border: "#797673", color: "#5D5A58" },
      bad: { bg: "#FDE7E9", border: "#A4262C", color: "#A4262C" },
    }[tone];
    return (
      <div
        style={{
          flex: 1,
          minWidth: 120,
          padding: "8px 12px",
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          borderRadius: 4,
          color: palette.color,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase" }}>
          {label}
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </div>
      </div>
    );
  };

  return (
    <FluentProvider theme={webLightTheme} style={{ width: "100%" }}>
      <div
        className="ValidateAndFundGrid-root"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: 12,
          fontFamily: "Segoe UI, sans-serif",
          fontSize: 13,
          background: "#FFFFFF",
        }}
      >
        {/* Title */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            Validate &amp; Fund
            {requirementFundingName ? `: ${requirementFundingName}` : ""}
          </span>
          <Badge appearance="outline" color="informative">
            {prioRows.length}{" "}
            {prioRows.length === 1 ? "prioritization" : "prioritizations"}
          </Badge>
          <span style={{ flex: 1 }} />
          {!editMode && (
            <Button
              appearance="primary"
              disabled={isDisabled || saving || prioRows.length === 0}
              onClick={() => setEditMode(true)}
            >
              Edit
            </Button>
          )}
          {editMode && (
            <>
              <Button onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => void onSave()}
                disabled={saving}
              >
                {saving ? <Spinner size="extra-tiny" /> : "Save"}
              </Button>
            </>
          )}
        </div>

        {/* TDP guardrail strip — wraps to 2x2 on narrow viewports */}
        {tdp != null && (
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            {stat("TDP", fmtMoney(tdp))}
            {stat(
              "Currently Funded",
              fmtMoney(totals.funded),
              overAllocated ? "bad" : "neutral"
            )}
            {stat(
              "Withhold (Available)",
              fmtMoney(available),
              available < 0 ? "bad" : "good"
            )}
          </div>
        )}

        {overAllocated && tdp != null && (
          <MessageBar intent="warning" style={{ marginBottom: 10 }}>
            <MessageBarBody>
              <strong>Over-allocated:</strong> Funded total (
              {fmtMoney(totals.funded)}) exceeds TDP ({fmtMoney(tdp)}) by{" "}
              {fmtMoney(totals.funded - tdp)} — the funding plugins will reject
              this on save.
            </MessageBarBody>
          </MessageBar>
        )}
        {error && (
          <MessageBar intent="error" style={{ marginBottom: 10 }}>
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {success && (
          <MessageBar intent="success" style={{ marginBottom: 10 }}>
            <MessageBarBody>{success}</MessageBarBody>
          </MessageBar>
        )}

        {prioRows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0" }}>
            No prioritizations under this Requirement Funding yet.
          </div>
        ) : (
          <div
            style={{
              border: "1px solid #EDEBE9",
              borderRadius: 4,
              maxHeight: "min(75vh, 900px)",
              overflowY: "auto",
              overflowX: "auto",
            }}
          >
            <table
              style={{
                width: "100%",
                minWidth: 720,
                borderCollapse: "separate",
                borderSpacing: 0,
                fontSize: 13,
              }}
            >
              <thead>
                <tr>
                  <th style={stickyTh}>State</th>
                  <th style={stickyThNum}>Requested</th>
                  <th style={stickyThNum}>Validated</th>
                  <th style={stickyThNum}>Funded (TDP)</th>
                  <th style={stickyThNum}>Unfunded</th>
                </tr>
              </thead>
              <tbody>
                {prioRows.map((p) => {
                  const eff = effective(p);
                  const items = itemsFor(p.id);
                  const isOpen = !!expanded[p.id];
                  const unfunded = Math.max(p.requested - eff.funded, 0);
                  return (
                    <React.Fragment key={p.id}>
                      <tr style={{ borderTop: "1px solid #EDEBE9" }}>
                        <td style={tdLeft}>
                          <div
                            style={{ display: "flex", alignItems: "center", gap: 6 }}
                          >
                            {eff.derived && (
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => toggleExpand(p.id)}
                              >
                                {isOpen ? "▾" : "▸"}
                              </Button>
                            )}
                            <div>
                              <div
                                role="link"
                                tabIndex={0}
                                onClick={() => {
                                  void navigation?.openForm({
                                    entityName: PRIORITIZATION_ENTITY,
                                    entityId: p.id,
                                  });
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    void navigation?.openForm({
                                      entityName: PRIORITIZATION_ENTITY,
                                      entityId: p.id,
                                    });
                                  }
                                }}
                                title="Open prioritization"
                                style={{
                                  fontWeight: 600,
                                  color: "#0078D4",
                                  cursor: "pointer",
                                  textDecoration: "none",
                                }}
                                onMouseEnter={(e) =>
                                  ((e.currentTarget as HTMLDivElement).style.textDecoration = "underline")
                                }
                                onMouseLeave={(e) =>
                                  ((e.currentTarget as HTMLDivElement).style.textDecoration = "none")
                                }
                              >
                                {p.stateName || "—"}
                              </div>
                              {p.statePriority != null && (
                                <div style={{ color: "#605E5C", fontSize: 11 }}>
                                  Priority #{p.statePriority}
                                  {eff.derived
                                    ? ` · ${items.length} itemized`
                                    : ""}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={tdNum}>{fmtMoney(p.requested)}</td>
                        <td style={tdNum}>
                          {editMode && !eff.derived ? (
                            <MoneyInput
                              value={p.validated}
                              onChange={(n) =>
                                updatePrioMoney(p.id, "validated", n)
                              }
                            />
                          ) : (
                            fmtMoney(eff.validated)
                          )}
                        </td>
                        <td style={tdNum}>
                          {editMode && !eff.derived ? (
                            <MoneyInput
                              value={p.funded}
                              onChange={(n) =>
                                updatePrioMoney(p.id, "funded", n)
                              }
                            />
                          ) : (
                            fmtMoney(eff.funded)
                          )}
                        </td>
                        <td
                          style={{
                            ...tdNum,
                            color: unfunded > 0 ? "#A4262C" : "#107C10",
                          }}
                        >
                          {fmtMoney(unfunded)}
                        </td>
                      </tr>

                      {/* Itemized Details drill-down */}
                      {eff.derived && isOpen && (
                        <tr style={{ background: "#FAF9F8" }}>
                          <td style={{ padding: 0 }} colSpan={5}>
                            <table
                              style={{
                                width: "100%",
                                borderCollapse: "collapse",
                              }}
                            >
                              <thead>
                                <tr style={{ color: "#605E5C" }}>
                                  <th style={subTh}>Requirement Item</th>
                                  <th style={subThNum}>Requested</th>
                                  <th style={subThNum}>Validated</th>
                                  <th style={subThNum}>Funded</th>
                                  <th style={subTh}>NPM Comment</th>
                                </tr>
                              </thead>
                              <tbody>
                                {items.map((it) => (
                                  <tr
                                    key={it.id}
                                    style={{ borderTop: "1px solid #EDEBE9" }}
                                  >
                                    <td style={{ ...tdLeft, paddingLeft: 28 }}>
                                      {it.label}
                                    </td>
                                    <td style={tdNum}>
                                      {fmtMoney(it.requested)}
                                    </td>
                                    <td style={tdNum}>
                                      {editMode ? (
                                        <MoneyInput
                                          value={it.validated}
                                          onChange={(n) =>
                                            updateItemMoney(
                                              it.id,
                                              "validated",
                                              n
                                            )
                                          }
                                        />
                                      ) : (
                                        fmtMoney(it.validated)
                                      )}
                                    </td>
                                    <td style={tdNum}>
                                      {editMode ? (
                                        <MoneyInput
                                          value={it.funded}
                                          onChange={(n) =>
                                            updateItemMoney(
                                              it.id,
                                              "funded",
                                              n
                                            )
                                          }
                                        />
                                      ) : (
                                        fmtMoney(it.funded)
                                      )}
                                    </td>
                                    <td style={tdLeft}>
                                      {editMode ? (
                                        <Textarea
                                          appearance="outline"
                                          resize="vertical"
                                          value={it.npmComment}
                                          onChange={(_e, d) =>
                                            updateItemComment(it.id, d.value)
                                          }
                                        />
                                      ) : (
                                        it.npmComment
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={stickyFootTd}>Total</td>
                  <td style={stickyFootTdNum}>{fmtMoney(totals.requested)}</td>
                  <td style={stickyFootTdNum}>{fmtMoney(totals.validated)}</td>
                  <td
                    style={{
                      ...stickyFootTdNum,
                      color: overAllocated ? "#A4262C" : "#323130",
                    }}
                  >
                    {fmtMoney(totals.funded)}
                  </td>
                  <td
                    style={{
                      ...stickyFootTdNum,
                      color: totals.unfunded > 0 ? "#A4262C" : "#107C10",
                    }}
                  >
                    {fmtMoney(totals.unfunded)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {loadingItems && (
          <div style={{ marginTop: 8 }}>
            <Spinner size="tiny" label="Loading Itemized Details…" />
          </div>
        )}

      </div>
    </FluentProvider>
  );
};

const thLeft: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  borderBottom: "1px solid #EDEBE9",
};
const thNum: React.CSSProperties = { ...thLeft, textAlign: "right" };
const tdLeft: React.CSSProperties = { padding: "8px 12px", verticalAlign: "middle" };
const tdNum: React.CSSProperties = {
  ...tdLeft,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
const subTh: React.CSSProperties = { ...thLeft, fontSize: 11 };

// Sticky variants — used when the table sits in a vertically-scrolling container.
// Background colors are required because sticky cells render over scrolled rows.
const stickyTh: React.CSSProperties = {
  ...thLeft,
  position: "sticky",
  top: 0,
  zIndex: 2,
  background: "#F3F2F1",
};
const stickyThNum: React.CSSProperties = { ...stickyTh, textAlign: "right" };

const stickyFootTd: React.CSSProperties = {
  ...tdLeft,
  position: "sticky",
  bottom: 0,
  zIndex: 2,
  background: "#FAF9F8",
  fontWeight: 700,
  borderTop: "2px solid #EDEBE9",
};
const stickyFootTdNum: React.CSSProperties = {
  ...stickyFootTd,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
const subThNum: React.CSSProperties = { ...subTh, textAlign: "right" };
