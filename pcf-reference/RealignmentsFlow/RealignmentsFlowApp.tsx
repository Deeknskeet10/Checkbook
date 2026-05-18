import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  Badge,
  Button,
  Spinner,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";

export interface RealignmentsFlowProps {
  webAPI: ComponentFramework.WebApi;
  navigation: ComponentFramework.Navigation;
  recordId?: string;
  amountInput: number | null;
}

interface SideDetail {
  prioritization: { id: string; name: string } | null;
  mdep: { id: string; name: string } | null;
  fundingLine: { id: string; name: string } | null;
  requirementFunding: { id: string; name: string } | null;
}

interface RealignmentDetail {
  id: string;
  amount: number | null;
  fund: { id: string; name: string } | null;
  status: string | null;
  type: string | null;
  fiscalYear: string | null;
  payerConcurrence: string | null;
  payeeConcurrence: string | null;
  sameFundAndSag: boolean;
  remarks: string | null;
  debit: SideDetail;
  credit: SideDetail;
}

const fmtMoney = (n: number | null): string =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function readLookup(rec: any, lookupAttr: string): { id: string; name: string } | null {
  const id = rec[`_${lookupAttr}_value`];
  const name = rec[`_${lookupAttr}_value@OData.Community.Display.V1.FormattedValue`];
  return id ? { id, name: name || "(unnamed)" } : null;
}

function buildDetail(rec: any): RealignmentDetail {
  return {
    id: rec.book_realignmentsid,
    amount: (rec.book_newamount as number | null) ?? (rec.book_amount as number | null) ?? null,
    fund: readLookup(rec, "book_fund"),
    status: rec["book_realignmentstatus@OData.Community.Display.V1.FormattedValue"] ?? null,
    type: rec.book_realignmenttype ?? null,
    fiscalYear: rec["book_fiscalyear@OData.Community.Display.V1.FormattedValue"] ?? null,
    payerConcurrence: rec["book_payerconcurrence@OData.Community.Display.V1.FormattedValue"] ?? null,
    payeeConcurrence: rec["book_payeeconcurrence@OData.Community.Display.V1.FormattedValue"] ?? null,
    sameFundAndSag: !!rec.book_samefundandsag,
    remarks: rec.book_remarks ?? null,
    debit: {
      prioritization: readLookup(rec, "book_debitedprioritization"),
      mdep: readLookup(rec, "book_debitedmdep"),
      fundingLine: readLookup(rec, "book_newdebitedloa"),
      requirementFunding: readLookup(rec, "book_newdebitedrequirement"),
    },
    credit: {
      prioritization: readLookup(rec, "book_creditedprioritization"),
      mdep: readLookup(rec, "book_creditedmdep"),
      fundingLine: readLookup(rec, "book_newcreditedloa"),
      requirementFunding: readLookup(rec, "book_newcreditedrequirement"),
    },
  };
}

const SELECT = [
  "book_realignmentsid",
  "book_amount",
  "book_newamount",
  "book_realignmenttype",
  "book_remarks",
  "book_samefundandsag",
  "_book_fund_value",
  "_book_debitedprioritization_value",
  "_book_creditedprioritization_value",
  "_book_debitedmdep_value",
  "_book_creditedmdep_value",
  "_book_newdebitedloa_value",
  "_book_newcreditedloa_value",
  "_book_newdebitedrequirement_value",
  "_book_newcreditedrequirement_value",
  "book_realignmentstatus",
  "book_fiscalyear",
  "book_payerconcurrence",
  "book_payeeconcurrence",
].join(",");

function FlowCard({
  title,
  side,
  amount,
  color,
}: {
  title: string;
  side: SideDetail;
  amount: number | null;
  color: string;
}): React.ReactElement {
  const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 12 }}>
      <span style={{ color: "#605E5C", minWidth: 96 }}>{label}</span>
      <span style={{ color: value ? "#323130" : "#A19F9D", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value || "—"}
      </span>
    </div>
  );
  return (
    <div
      style={{
        flex: 1,
        minWidth: 220,
        border: `1px solid ${color}33`,
        borderTop: `3px solid ${color}`,
        borderRadius: 4,
        padding: "10px 12px",
        background: "#FAF9F8",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color }}>{title}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 16, fontWeight: 600, color: "#323130", fontVariantNumeric: "tabular-nums" }}>
          {fmtMoney(amount)}
        </span>
      </div>
      <Row label="Prioritization" value={side.prioritization?.name} />
      <Row label="MDEP" value={side.mdep?.name} />
      <Row label="Requirement Funding" value={side.requirementFunding?.name} />
      <Row label="LOA" value={side.fundingLine?.name} />
    </div>
  );
}

function Arrow(): React.ReactElement {
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" aria-hidden="true">
      <line x1={4} y1={28} x2={44} y2={28} stroke="#605E5C" strokeWidth={2} />
      <polyline
        points="38,18 48,28 38,38"
        fill="none"
        stroke="#605E5C"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const RealignmentsFlowApp: React.FC<RealignmentsFlowProps> = (props) => {
  const { webAPI, navigation, recordId, amountInput } = props;
  const [detail, setDetail] = React.useState<RealignmentDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!recordId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const rec = await webAPI.retrieveRecord("book_realignments", recordId, `?$select=${SELECT}`);
        setDetail(buildDetail(rec));
      } catch (e: any) {
        setErr(e?.message || "Failed to load realignment");
      } finally {
        setLoading(false);
      }
    })();
  }, [recordId, webAPI]);

  if (loading) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div style={{ padding: 12 }}>
          <Spinner size="tiny" label="Loading realignment..." />
        </div>
      </FluentProvider>
    );
  }

  if (err) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div style={{ padding: 12 }}>
          <MessageBar intent="error">
            <MessageBarBody>{err}</MessageBarBody>
          </MessageBar>
        </div>
      </FluentProvider>
    );
  }

  if (!detail) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div style={{ padding: 12, color: "#605E5C" }}>
          Save the realignment first to see the flow.
        </div>
      </FluentProvider>
    );
  }

  // Use the live amount from the bound field if it's been edited
  const liveAmount = amountInput != null && amountInput !== detail.amount ? amountInput : detail.amount;

  // Validation
  const issues: string[] = [];
  if (liveAmount == null || liveAmount <= 0) issues.push("Amount must be greater than zero");
  if (!detail.debit.prioritization) issues.push("Debit Prioritization is required");
  if (!detail.credit.prioritization) issues.push("Credit Prioritization is required");
  if (
    detail.debit.prioritization &&
    detail.credit.prioritization &&
    detail.debit.prioritization.id === detail.credit.prioritization.id &&
    detail.debit.mdep?.id === detail.credit.mdep?.id
  ) {
    issues.push("Debit and Credit refer to the same Prioritization + MDEP — pick different sides");
  }
  if (detail.payerConcurrence && detail.payerConcurrence.toLowerCase() !== "concur") {
    issues.push(`Payer concurrence: ${detail.payerConcurrence}`);
  }
  if (detail.payeeConcurrence && detail.payeeConcurrence.toLowerCase() !== "concur") {
    issues.push(`Payee concurrence: ${detail.payeeConcurrence}`);
  }

  const openSide = (lookup: { id: string; name: string } | null, entityName: string) => {
    if (!lookup) return;
    navigation.openForm({ entityName, entityId: lookup.id, openInNewWindow: true }).catch(() => {});
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div
        className="arsc-realignments-flow"
        style={{ padding: 12, fontFamily: "Segoe UI, sans-serif", fontSize: 13, background: "#FFFFFF" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Realignment Flow</span>
          {detail.status && (
            <Badge appearance="filled" color={issues.length > 0 ? "warning" : "informative"}>
              {detail.status}
            </Badge>
          )}
          {detail.fiscalYear && (
            <Badge appearance="outline" color="informative">
              FY {detail.fiscalYear}
            </Badge>
          )}
          {detail.type && <span style={{ color: "#605E5C", fontSize: 12 }}>· {detail.type}</span>}
          {detail.fund && <span style={{ color: "#605E5C", fontSize: 12 }}>· {detail.fund.name}</span>}
          {detail.sameFundAndSag && (
            <Badge appearance="tint" color="success">Same Fund + SAG</Badge>
          )}
        </div>

        {issues.length > 0 && (
          <MessageBar intent="warning" style={{ marginBottom: 12 }}>
            <MessageBarBody>
              <strong>Validation: </strong>
              <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                {issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            </MessageBarBody>
          </MessageBar>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FlowCard title="DEBIT (FROM)" side={detail.debit} amount={liveAmount} color="#A4262C" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <Arrow />
            <span style={{ fontSize: 11, color: "#605E5C", fontVariantNumeric: "tabular-nums" }}>
              {fmtMoney(liveAmount)}
            </span>
          </div>
          <FlowCard title="CREDIT (TO)" side={detail.credit} amount={liveAmount} color="#107C10" />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {detail.debit.prioritization && (
            <Button size="small" appearance="subtle" onClick={() => openSide(detail.debit.prioritization, "book_prioritization")}>
              Open debit prioritization →
            </Button>
          )}
          {detail.credit.prioritization && (
            <Button size="small" appearance="subtle" onClick={() => openSide(detail.credit.prioritization, "book_prioritization")}>
              Open credit prioritization →
            </Button>
          )}
        </div>

        {detail.remarks && (
          <div style={{ marginTop: 12, padding: 8, background: "#F3F2F1", borderRadius: 4, fontSize: 12, color: "#605E5C" }}>
            <strong>Remarks: </strong>{detail.remarks}
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
