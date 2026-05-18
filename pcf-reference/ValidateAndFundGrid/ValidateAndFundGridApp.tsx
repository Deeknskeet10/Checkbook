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

export interface ValidateAndFundGridProps {
  dataset: ComponentFramework.PropertyTypes.DataSet;
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  parentRequirementFundingId?: string;
  parentRequirementFundingName?: string;
}

interface Row {
  id: string;
  stateName: string;
  statePriority: number | null;
  requested: number;
  validated: number;
  funded: number;
  unfundedDisplay: number;
}

interface RFContext {
  tdp: number;
  withholding: number;
  withholdingReason: string | null;
}

const fmtMoney = (n: number | null | undefined): string =>
  n == null
    ? "$0.00"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const parseMoney = (s: string): number => {
  if (s == null) return 0;
  const cleaned = String(s).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

const getLookupName = (v: any): string => {
  if (!v) return "";
  if (Array.isArray(v)) return v[0]?.name || "";
  return v.name || "";
};

export const ValidateAndFundGridApp: React.FC<ValidateAndFundGridProps> = (props) => {
  const { dataset, webAPI, parentRequirementFundingId, parentRequirementFundingName } = props;

  const initialRows: Row[] = React.useMemo(() => {
    return dataset.sortedRecordIds
      .map((id) => dataset.records[id])
      .map((r) => {
        const requested = (r.getValue("requestedAmount") as number | null) ?? 0;
        const validated = (r.getValue("validatedAmount") as number | null) ?? 0;
        const funded = (r.getValue("fundedAmount") as number | null) ?? 0;
        const unfunded = (r.getValue("unfundedAmount") as number | null);
        return {
          id: r.getRecordId(),
          stateName: getLookupName(r.getValue("state")),
          statePriority: (r.getValue("statePriority") as number | null) ?? null,
          requested,
          validated,
          funded,
          unfundedDisplay: unfunded != null ? unfunded : Math.max(requested - funded, 0),
        };
      })
      .sort((a, b) => {
        if (a.statePriority !== b.statePriority) {
          const pa = a.statePriority ?? Number.MAX_SAFE_INTEGER;
          const pb = b.statePriority ?? Number.MAX_SAFE_INTEGER;
          return pa - pb;
        }
        return a.stateName.localeCompare(b.stateName);
      });
  }, [dataset.sortedRecordIds.join("|")]);

  const [rows, setRows] = React.useState<Row[]>(initialRows);
  const [editMode, setEditMode] = React.useState<boolean>(false);
  const [saving, setSaving] = React.useState<boolean>(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);
  const [rfCtx, setRfCtx] = React.useState<RFContext | null>(null);

  React.useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  // Load the parent Requirement Funding header (TDP, Withholding)
  React.useEffect(() => {
    if (!parentRequirementFundingId) return;
    const id = parentRequirementFundingId.replace(/[{}]/g, "");
    webAPI
      .retrieveRecord(
        "book_requirementfunding",
        id,
        "?$select=book_newtdp,book_newwithholding,book_withholdingreason,book_tdp,book_withholding"
      )
      .then((rec: any) => {
        const tdp = rec.book_newtdp ?? rec.book_tdp ?? 0;
        const wh = rec.book_newwithholding ?? rec.book_withholding ?? 0;
        setRfCtx({
          tdp: Number(tdp) || 0,
          withholding: Number(wh) || 0,
          withholdingReason: rec.book_withholdingreason || null,
        });
      })
      .catch(() => {
        // Header is decorative — okay to render without it
        setRfCtx({ tdp: 0, withholding: 0, withholdingReason: null });
      });
  }, [parentRequirementFundingId, webAPI]);

  // Live totals across the in-memory rows (reflect un-saved edits)
  const totals = React.useMemo(() => {
    let req = 0, val = 0, fund = 0;
    for (const r of rows) {
      req += r.requested || 0;
      val += r.validated || 0;
      fund += r.funded || 0;
    }
    return {
      requested: req,
      validated: val,
      funded: fund,
      unfunded: Math.max(req - fund, 0),
    };
  }, [rows]);

  const available = rfCtx ? rfCtx.tdp - rfCtx.withholding : 0;
  const overAllocated = available > 0 && totals.funded > available;

  const updateRow = (id: string, field: "validated" | "funded", raw: string): void => {
    const next = parseMoney(raw);
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, [field]: next, unfundedDisplay: Math.max((r.requested || 0) - (field === "funded" ? next : r.funded), 0) }
          : r
      )
    );
  };

  const onSave = async (): Promise<void> => {
    setErr(null);
    setOk(null);
    setSaving(true);
    try {
      // Patch every prioritization that changed
      await Promise.all(
        rows.map((r) =>
          webAPI.updateRecord("book_prioritization", r.id, {
            book_newvalidatedamount: r.validated,
            book_newfundedamounttdp: r.funded,
          })
        )
      );

      // Roll up totals to the parent Requirement Funding
      if (parentRequirementFundingId) {
        const rfId = parentRequirementFundingId.replace(/[{}]/g, "");
        await webAPI.updateRecord("book_requirementfunding", rfId, {
          book_newvalidatedamount: totals.validated,
          book_newfundedamount: totals.funded,
          book_newunfundedamount: totals.unfunded,
        });
      }

      setOk("Validation & funding saved.");
      setEditMode(false);
      dataset.refresh();
    } catch (e: any) {
      setErr(e?.message || "Save failed. Please try again or contact support.");
    } finally {
      setSaving(false);
    }
  };

  const onCancel = (): void => {
    setRows(initialRows);
    setEditMode(false);
    setErr(null);
    setOk(null);
  };

  const headerStat = (label: string, value: string, tone: "neutral" | "good" | "warn" | "bad" = "neutral"): React.ReactElement => {
    const palette = {
      neutral: { bg: "#FFFFFF", border: "#EDEBE9", color: "#323130" },
      good:    { bg: "#DFF6DD", border: "#107C10", color: "#0E5A0E" },
      warn:    { bg: "#FFF4CE", border: "#797673", color: "#5D5A58" },
      bad:     { bg: "#FDE7E9", border: "#A4262C", color: "#A4262C" },
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
        <div style={{ fontSize: 11, opacity: 0.75, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      </div>
    );
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-validate-fund"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>
            Validate &amp; Fund{parentRequirementFundingName ? `: ${parentRequirementFundingName}` : ""}
          </span>
          <Badge appearance="outline" color="informative" size="medium">
            {rows.length} {rows.length === 1 ? "prioritization" : "prioritizations"}
          </Badge>
          <span style={{ flex: 1 }} />
          {!editMode && (
            <Button appearance="primary" onClick={() => setEditMode(true)} disabled={saving || rows.length === 0}>
              Edit
            </Button>
          )}
          {editMode && (
            <>
              <Button onClick={onCancel} disabled={saving}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={onSave} disabled={saving}>
                {saving ? <Spinner size="extra-tiny" /> : "Save"}
              </Button>
            </>
          )}
        </div>

        {/* Availability strip */}
        {rfCtx && (
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {headerStat("TDP", fmtMoney(rfCtx.tdp))}
            {headerStat("Withholding", fmtMoney(rfCtx.withholding))}
            {headerStat("Available TDP", fmtMoney(available), available <= 0 ? "warn" : "good")}
            {headerStat("Currently Funded", fmtMoney(totals.funded), overAllocated ? "bad" : "neutral")}
          </div>
        )}

        {overAllocated && (
          <MessageBar intent="error" style={{ marginBottom: 10 }}>
            <MessageBarBody>
              <strong>Over-allocated:</strong> Funded total ({fmtMoney(totals.funded)}) exceeds Available TDP ({fmtMoney(available)}) by{" "}
              {fmtMoney(totals.funded - available)}.
            </MessageBarBody>
          </MessageBar>
        )}

        {err && (
          <MessageBar intent="error" style={{ marginBottom: 10 }}>
            <MessageBarBody>{err}</MessageBarBody>
          </MessageBar>
        )}
        {ok && (
          <MessageBar intent="success" style={{ marginBottom: 10 }}>
            <MessageBarBody>{ok}</MessageBarBody>
          </MessageBar>
        )}

        {/* Table */}
        {rows.length === 0 ? (
          <div style={{ color: "#605E5C", padding: "16px 0", borderTop: "1px solid #EDEBE9" }}>
            No prioritizations under this requirement funding yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid #EDEBE9", borderRadius: 4 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F3F2F1", color: "#323130" }}>
                  <th style={thStyle}>State</th>
                  <th style={thStyleNum}>Requested</th>
                  <th style={thStyleNum}>Validated</th>
                  <th style={thStyleNum}>Funded (TDP)</th>
                  <th style={thStyleNum}>Unfunded</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid #EDEBE9" }}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{r.stateName || "—"}</div>
                      {r.statePriority != null && (
                        <div style={{ color: "#605E5C", fontSize: 11 }}>Priority #{r.statePriority}</div>
                      )}
                    </td>
                    <td style={tdStyleNum}>{fmtMoney(r.requested)}</td>
                    <td style={tdStyleNum}>
                      {editMode ? (
                        <Input
                          appearance="outline"
                          value={String(r.validated)}
                          onChange={(_e, d) => updateRow(r.id, "validated", d.value)}
                          input={{ style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
                        />
                      ) : (
                        fmtMoney(r.validated)
                      )}
                    </td>
                    <td style={tdStyleNum}>
                      {editMode ? (
                        <Input
                          appearance="outline"
                          value={String(r.funded)}
                          onChange={(_e, d) => updateRow(r.id, "funded", d.value)}
                          input={{ style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
                        />
                      ) : (
                        fmtMoney(r.funded)
                      )}
                    </td>
                    <td style={{ ...tdStyleNum, color: r.unfundedDisplay > 0 ? "#A4262C" : "#107C10" }}>
                      {fmtMoney(r.unfundedDisplay)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#FAF9F8", fontWeight: 700, borderTop: "2px solid #EDEBE9" }}>
                  <td style={tdStyle}>Total</td>
                  <td style={tdStyleNum}>{fmtMoney(totals.requested)}</td>
                  <td style={tdStyleNum}>{fmtMoney(totals.validated)}</td>
                  <td style={{ ...tdStyleNum, color: overAllocated ? "#A4262C" : "#323130" }}>{fmtMoney(totals.funded)}</td>
                  <td style={{ ...tdStyleNum, color: totals.unfunded > 0 ? "#A4262C" : "#107C10" }}>
                    {fmtMoney(totals.unfunded)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {rfCtx?.withholdingReason && (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "#FAF9F8", border: "1px solid #EDEBE9", borderRadius: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#605E5C", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Withholding Reason
            </div>
            <div style={{ fontSize: 12, color: "#323130" }}>{rfCtx.withholdingReason}</div>
          </div>
        )}
      </div>
    </FluentProvider>
  );
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontWeight: 600,
  fontSize: 12,
  borderBottom: "1px solid #EDEBE9",
};
const thStyleNum: React.CSSProperties = { ...thStyle, textAlign: "right" };
const tdStyle: React.CSSProperties = { padding: "8px 12px", verticalAlign: "middle" };
const tdStyleNum: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };
