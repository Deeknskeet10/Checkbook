import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
  Input,
  Spinner,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;

export interface ValidateAndFundRequirementDetailsGridProps {
  dataset: DataSet;
  webAPI: WebApi;
  navigation: ComponentFramework.Navigation;
  isDisabled: boolean;
  requirementFundingId?: string;
  requirementFundingName?: string;
}

const REQUIREMENT_DETAIL_FUNDING_ENTITY = "book_requirementdetailfunding";
const REQUIREMENT_DETAILS_ENTITY = "book_requirementdetails";
const REQUIREMENT_FUNDING_ENTITY = "book_requirementfunding";

const RDF_VALIDATED = "book_validatedamount";
const RDF_FUNDED = "book_fundedamount";

interface RdfRow {
  id: string;
  rdId: string;
  rdLabel: string;
  validated: number;
  funded: number;
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

const sanitizeMoneyText = (s: string): string => {
  let out = (s ?? "").replace(/[^0-9.-]/g, "");
  const neg = out.startsWith("-");
  out = (neg ? "-" : "") + out.replace(/-/g, "");
  const dot = out.indexOf(".");
  if (dot !== -1) {
    out =
      out.slice(0, dot + 1) +
      out.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  }
  return out;
};

const MoneyInput: React.FC<{
  value: number;
  onChange: (n: number) => void;
}> = ({ value, onChange }) => {
  const [text, setText] = React.useState<string>(() =>
    value === 0 ? "" : value.toFixed(2),
  );
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

interface LookupRef {
  id?: string;
  name?: string;
}

const getLookup = (v: unknown): LookupRef => {
  if (!v) return {};
  if (Array.isArray(v)) return (v[0] as LookupRef) ?? {};
  return (v as LookupRef) ?? {};
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const ValidateAndFundRequirementDetailsGridApp: React.FC<
  ValidateAndFundRequirementDetailsGridProps
> = (props) => {
  const { dataset, webAPI, navigation, isDisabled, requirementFundingId, requirementFundingName } =
    props;

  // --- Junction rows straight from the dataset --------------------------
  const initialRdfRows = React.useMemo<RdfRow[]>(() => {
    return dataset.sortedRecordIds
      .map((id) => dataset.records[id])
      .map((r) => {
        const rd = getLookup(r.getValue("requirementDetail"));
        const rowName = (r.getValue("name") as string) ?? "";
        return {
          id: r.getRecordId(),
          rdId: rd.id ? stripBraces(rd.id) : "",
          rdLabel: rd.name ?? (rowName !== "" ? rowName : "(unnamed)"),
          validated: num(r.getValue("validatedAmount")),
          funded: num(r.getValue("fundedAmount")),
        };
      })
      .sort((a, b) => a.rdLabel.localeCompare(b.rdLabel));
  }, [dataset.sortedRecordIds.join("|")]);

  const [rdfRows, setRdfRows] = React.useState<RdfRow[]>(initialRdfRows);
  const [baselineRdf, setBaselineRdf] = React.useState<RdfRow[]>(initialRdfRows);

  const [editMode, setEditMode] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [tdp, setTdp] = React.useState<number | null>(null);
  const [withhold, setWithhold] = React.useState<number | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    setRdfRows(initialRdfRows);
    setBaselineRdf(initialRdfRows);
  }, [initialRdfRows]);

  // --- Requirement Funding TDP + Withhold (the funding pool) ------------
  React.useEffect(() => {
    if (!requirementFundingId) return;
    const id = stripBraces(requirementFundingId);
    void (async () => {
      try {
        const rec = await webAPI.retrieveRecord(
          REQUIREMENT_FUNDING_ENTITY,
          id,
          "?$select=book_newtdp,book_newwithholding"
        );
        setTdp(num(rec.book_newtdp));
        setWithhold(num(rec.book_newwithholding));
      } catch {
        setTdp(null);
        setWithhold(null);
      }
    })();
  }, [requirementFundingId, webAPI, reloadKey]);

  const totals = React.useMemo(() => {
    let validated = 0,
      funded = 0;
    for (const r of rdfRows) {
      validated += r.validated;
      funded += r.funded;
    }
    return { validated, funded };
  }, [rdfRows]);

  // Whole-cent comparison: totals.funded is a running JS-float sum, so a total
  // that exactly equals TDP can land a sub-cent epsilon high and trip a strict
  // `>`. The plugin validates with exact C# decimals, so equal-to-the-cent is
  // fine — round both sides to avoid a phantom "exceeds by $0.00" false positive.
  const overAllocated =
    tdp != null && Math.round(totals.funded * 100) > Math.round(tdp * 100);

  const updateRdfMoney = (
    id: string,
    field: "validated" | "funded",
    value: number
  ): void => {
    setRdfRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const onCancel = (): void => {
    setRdfRows(baselineRdf);
    setEditMode(false);
    setError(null);
    setSuccess(null);
  };

  const onSave = async (): Promise<void> => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const baseMap = new Map(baselineRdf.map((r) => [r.id, r]));
      for (const r of rdfRows) {
        const base = baseMap.get(r.id);
        if (base && base.validated === r.validated && base.funded === r.funded)
          continue;
        await webAPI.updateRecord(REQUIREMENT_DETAIL_FUNDING_ENTITY, r.id, {
          [RDF_VALIDATED]: r.validated,
          [RDF_FUNDED]: r.funded,
        });
      }

      // The junction → Requirement Detail and junction → Requirement Funding
      // roll-ups are maintained by the project's plugins — the grid does not
      // write those totals.
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
        className="ValidateAndFundRequirementDetailsGrid-root"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: 12,
          fontFamily: "Segoe UI, sans-serif",
          fontSize: 13,
          background: "#FFFFFF",
        }}
      >
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
            Validate &amp; Fund Requirement Details
            {requirementFundingName ? `: ${requirementFundingName}` : ""}
          </span>
          <Badge appearance="outline" color="informative">
            {rdfRows.length}{" "}
            {rdfRows.length === 1 ? "allocation" : "allocations"}
          </Badge>
          <span style={{ flex: 1 }} />
          {!editMode && (
            <Button
              appearance="primary"
              disabled={isDisabled || saving || rdfRows.length === 0}
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
              fmtMoney(withhold),
              withhold != null && withhold < 0 ? "bad" : "good"
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

        {rdfRows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0" }}>
            No requirement detail allocations under this Requirement Funding yet.
            Use the subgrid Add button to allocate a Requirement Detail.
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
                minWidth: 640,
                borderCollapse: "separate",
                borderSpacing: 0,
                fontSize: 13,
              }}
            >
              <thead>
                <tr>
                  <th style={stickyTh}>Requirement Detail</th>
                  <th style={stickyThNum}>Validated</th>
                  <th style={stickyThNum}>Funded (TDP)</th>
                </tr>
              </thead>
              <tbody>
                {rdfRows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid #EDEBE9" }}>
                    <td style={tdLeft}>
                      <div
                        role="link"
                        tabIndex={0}
                        onClick={() => {
                          if (!r.rdId) return;
                          void navigation?.openForm({
                            entityName: REQUIREMENT_DETAILS_ENTITY,
                            entityId: r.rdId,
                          });
                        }}
                        onKeyDown={(e) => {
                          if (!r.rdId) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void navigation?.openForm({
                              entityName: REQUIREMENT_DETAILS_ENTITY,
                              entityId: r.rdId,
                            });
                          }
                        }}
                        title="Open requirement detail"
                        style={{
                          fontWeight: 600,
                          color: r.rdId ? "#0078D4" : "#605E5C",
                          cursor: r.rdId ? "pointer" : "default",
                          textDecoration: "none",
                        }}
                        onMouseEnter={(e) => {
                          if (r.rdId)
                            (e.currentTarget as HTMLDivElement).style.textDecoration = "underline";
                        }}
                        onMouseLeave={(e) =>
                          ((e.currentTarget as HTMLDivElement).style.textDecoration = "none")
                        }
                      >
                        {r.rdLabel}
                      </div>
                    </td>
                    <td style={tdNum}>
                      {editMode ? (
                        <MoneyInput
                          value={r.validated}
                          onChange={(n) => updateRdfMoney(r.id, "validated", n)}
                        />
                      ) : (
                        fmtMoney(r.validated)
                      )}
                    </td>
                    <td style={tdNum}>
                      {editMode ? (
                        <MoneyInput
                          value={r.funded}
                          onChange={(n) => updateRdfMoney(r.id, "funded", n)}
                        />
                      ) : (
                        fmtMoney(r.funded)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={stickyFootTd}>Total</td>
                  <td style={stickyFootTdNum}>{fmtMoney(totals.validated)}</td>
                  <td
                    style={{
                      ...stickyFootTdNum,
                      color: overAllocated ? "#A4262C" : "#323130",
                    }}
                  >
                    {fmtMoney(totals.funded)}
                  </td>
                </tr>
              </tfoot>
            </table>
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
const tdLeft: React.CSSProperties = { padding: "8px 12px", verticalAlign: "middle" };
const tdNum: React.CSSProperties = {
  ...tdLeft,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

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
