import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  shorthands,
  tokens,
  Spinner,
  Text,
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Textarea,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
} from "@fluentui/react-components";

// Inline SVG icons — @fluentui/react-icons v2 pulls in @griffel which needs
// react/jsx-runtime (React 17+), and this project is pinned to React 16.14 to
// match the platform-library version in the manifest.
const IconCheck: React.FC = () => (
  <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx={10} cy={10} r={9} fill="currentColor" />
    <path
      d="M6 10.5l2.5 2.5L14 7"
      fill="none"
      stroke="#fff"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const IconCurrent: React.FC = () => (
  <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx={10} cy={10} r={9} fill="none" stroke="currentColor" strokeWidth={2} />
    <circle cx={10} cy={10} r={4} fill="currentColor" />
  </svg>
);
const IconFuture: React.FC = () => (
  <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx={10} cy={10} r={9} fill="none" stroke="currentColor" strokeWidth={2} />
  </svg>
);

type WebApi = ComponentFramework.WebApi;
type UserSettings = ComponentFramework.UserSettings;

export interface RealignmentApprovalProcessProps {
  webAPI: WebApi;
  userSettings: UserSettings;
  entityId: string;
  entityName: string;
  isDisabled: boolean;
  width: number;
}

const REALIGNMENT_ENTITY = "book_realignments";
const STATE_APPROVED = "book_newstateapproved";
const BE_DECISION = "book_bedecision";
const DENIAL_REASON = "book_denialreason";
const SAME_FUND_SAG = "book_samefundandsag";
const DEBIT_PRIO_VALUE = "_book_debitedprioritization_value";
const CREDIT_PRIO_VALUE = "_book_creditedprioritization_value";
const PAYER_CONCURRENCE = "book_payerconcurrence";
const PAYEE_CONCURRENCE = "book_payeeconcurrence";
const FORMATTED = "@OData.Community.Display.V1.FormattedValue";

const PRIO_ENTITY = "book_prioritization";
const PRIO_STATE_VALUE = "_book_state_value";
const STATE_ENTITY = "book_state";
const STATE_BU_VALUE = "_owningbusinessunit_value";
const USER_ENTITY = "systemuser";
const USER_BU_VALUE = "_businessunitid_value";

// book_newstateapproved / book_bedecision option-set values. These mirror
// Plugins/Constants/OptionSetValues.cs::RealignmentBEDecisionValues, which flags
// that the numeric values (0/1) should be confirmed in the target env. If the
// option set is ever recreated with 100000000-based values, change these two.
const APPROVED_VALUE = 0;
const DENIED_VALUE = 1;

// Role gate — mirrors RealignmentValidator.EnforceApprovalRoles. UX only; the
// plugin remains the authoritative check.
const STATE_ROLES = [
  "Book - State Approver",
  "Book - State Administrator",
  "Book - Checkbook Administrator",
];
const BE_ROLES = ["Book - Budget Executor", "Book - Checkbook Administrator"];
const CHECKBOOK_ADMIN = "Book - Checkbook Administrator";

type Stage = "state" | "npm" | "be" | "done";

interface RealignmentRecord {
  stateApproved: boolean;
  stateDenied: boolean;
  beApproved: boolean;
  beDenied: boolean;
  sameFundSag: boolean;
  hasPriors: boolean;
  denialReason: string | null;
  payerConcurrence: string | null;
  payeeConcurrence: string | null;
  // Owning BU of the debiting state, compared to the caller's BU to gate the
  // State approval (mirrors StateScopeHelper.IsUserInStateBU on the plugin
  // side). Null when there is no debiting Prioritization (RF-to-RF) or it has
  // no state.
  debitStateBUId: string | null;
}

const useStyles = makeStyles({
  root: {
    ...shorthands.padding("12px", "16px"),
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
  },
  chevronRow: {
    display: "flex",
    alignItems: "stretch",
    minHeight: "40px",
    ...shorthands.gap("2px"),
  },
  chevron: {
    display: "flex",
    alignItems: "center",
    ...shorthands.gap("8px"),
    ...shorthands.padding("6px", "24px", "6px", "20px"),
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground3,
    clipPath:
      "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)",
    flexGrow: 1,
    minWidth: "160px",
  },
  chevronFirst: {
    clipPath:
      "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)",
  },
  chevronPast: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    color: tokens.colorPaletteGreenForeground2,
  },
  chevronCurrent: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    outlineStyle: "solid",
    outlineWidth: "2px",
    outlineColor: tokens.colorBrandStroke1,
  },
  chevronFuture: {
    color: tokens.colorNeutralForeground3,
  },
  actionsRow: {
    display: "flex",
    ...shorthands.gap("8px"),
    marginTop: "12px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  helper: {
    color: tokens.colorNeutralForeground3,
    marginLeft: "auto",
  },
  reasonBlock: {
    display: "flex",
    flexDirection: "column",
    ...shorthands.gap("8px"),
    width: "100%",
  },
});

/**
 * Resolves the debiting state's owning business unit by hopping the realignment's
 * debit Prioritization → book_state → owning BU. Returns null when any hop is
 * missing (e.g. an RF-to-RF realignment with no debit Prio).
 */
async function resolveDebitStateBU(
  webAPI: WebApi,
  prioId: string | null
): Promise<string | null> {
  if (!prioId) return null;
  try {
    const prio = await webAPI.retrieveRecord(
      PRIO_ENTITY,
      prioId.replace(/[{}]/g, ""),
      `?$select=${PRIO_STATE_VALUE}`
    );
    const stateId = prio[PRIO_STATE_VALUE] as string | null;
    if (!stateId) return null;
    const state = await webAPI.retrieveRecord(
      STATE_ENTITY,
      stateId.replace(/[{}]/g, ""),
      `?$select=${STATE_BU_VALUE}`
    );
    return (state[STATE_BU_VALUE] as string | null) ?? null;
  } catch {
    return null;
  }
}

interface Shape {
  hasStateStage: boolean;
  hasBEStage: boolean;
  stages: { key: Stage; label: string }[];
}

/**
 * Picks the chevron set for the realignment's shape — the same three paths the
 * retired BPF encoded:
 *   • Prior→Prior, same Fund/SAG  → State Approval (terminal)
 *   • Prior→Prior, cross Fund/SAG → State Approval → NPM Concurrence → BE Approval
 *   • RF→RF (no priors)           → NPM Concurrence → BE Approval
 * NPM Concurrence is a display/soft stage: it has no dedicated field and only
 * clears when a Budget Executor approves.
 */
function shapeOf(rec: RealignmentRecord): Shape {
  if (rec.hasPriors && rec.sameFundSag) {
    return {
      hasStateStage: true,
      hasBEStage: false,
      stages: [
        { key: "state", label: "State Approval" },
        { key: "done", label: "Approved" },
      ],
    };
  }
  if (rec.hasPriors) {
    return {
      hasStateStage: true,
      hasBEStage: true,
      stages: [
        { key: "state", label: "State Approval" },
        { key: "npm", label: "NPM Concurrence" },
        { key: "be", label: "BE Approval" },
        { key: "done", label: "Approved" },
      ],
    };
  }
  return {
    hasStateStage: false,
    hasBEStage: true,
    stages: [
      { key: "npm", label: "NPM Concurrence" },
      { key: "be", label: "BE Approval" },
      { key: "done", label: "Approved" },
    ],
  };
}

export const RealignmentApprovalProcessApp: React.FC<
  RealignmentApprovalProcessProps
> = ({ webAPI, userSettings, entityId, entityName, isDisabled }) => {
  const styles = useStyles();
  const [record, setRecord] = React.useState<RealignmentRecord | null>(null);
  const [userRoles, setUserRoles] = React.useState<Set<string>>(new Set());
  const [userBUId, setUserBUId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [denyReason, setDenyReason] = React.useState("");
  const [denyOpen, setDenyOpen] = React.useState(false);
  const cleanId = React.useMemo(
    () => (entityId || "").replace(/[{}]/g, ""),
    [entityId]
  );

  const reload = React.useCallback(async () => {
    if (!cleanId) {
      setLoading(false);
      return;
    }
    try {
      const rec = await webAPI.retrieveRecord(
        entityName || REALIGNMENT_ENTITY,
        cleanId,
        `?$select=${STATE_APPROVED},${BE_DECISION},${DENIAL_REASON},${SAME_FUND_SAG},${PAYER_CONCURRENCE},${PAYEE_CONCURRENCE},${DEBIT_PRIO_VALUE},${CREDIT_PRIO_VALUE}`
      );

      const stateVal = rec[STATE_APPROVED] as number | null;
      const beVal = rec[BE_DECISION] as number | null;
      const debitPrioId = rec[DEBIT_PRIO_VALUE] as string | null;
      const creditPrioId = rec[CREDIT_PRIO_VALUE] as string | null;
      const hasPriors = !!debitPrioId && !!creditPrioId;

      const debitStateBU = await resolveDebitStateBU(webAPI, debitPrioId);

      setRecord({
        stateApproved: stateVal === APPROVED_VALUE,
        stateDenied: stateVal === DENIED_VALUE,
        beApproved: beVal === APPROVED_VALUE,
        beDenied: beVal === DENIED_VALUE,
        sameFundSag: !!rec[SAME_FUND_SAG],
        hasPriors,
        denialReason: (rec[DENIAL_REASON] as string | null) ?? null,
        payerConcurrence: (rec[`${PAYER_CONCURRENCE}${FORMATTED}`] as string | null) ?? null,
        payeeConcurrence: (rec[`${PAYEE_CONCURRENCE}${FORMATTED}`] as string | null) ?? null,
        debitStateBUId: debitStateBU,
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load Realignment record.");
    } finally {
      setLoading(false);
    }
  }, [cleanId, entityName, webAPI]);

  const loadRoles = React.useCallback(async () => {
    const userId = (userSettings.userId || "").replace(/[{}]/g, "");
    if (!userId) return;
    try {
      // Role query mirrors UserRoleHelper: direct assignments
      // (systemuserroles_association) OR team-derived roles
      // (teamroles_association → teammembership_association). Fetch the caller's
      // BU in parallel — it gates the State approval alongside the role check.
      const roleFilter =
        `systemuserroles_association/any(o:o/systemuserid eq ${userId})` +
        ` or teamroles_association/any(t:t/teammembership_association/any(m:m/systemuserid eq ${userId}))`;
      const [rolesResp, user] = await Promise.all([
        webAPI.retrieveMultipleRecords(
          "role",
          `?$select=name&$filter=${roleFilter}`
        ),
        webAPI.retrieveRecord(USER_ENTITY, userId, `?$select=${USER_BU_VALUE}`),
      ]);
      const names = new Set<string>();
      for (const r of rolesResp.entities) {
        if (r.name) names.add(r.name as string);
      }
      setUserRoles(names);
      setUserBUId((user[USER_BU_VALUE] as string | null) ?? null);
    } catch {
      setUserRoles(new Set());
      setUserBUId(null);
    }
  }, [userSettings.userId, webAPI]);

  React.useEffect(() => {
    void reload();
    void loadRoles();
  }, [reload, loadRoles]);

  const isCheckbookAdmin = React.useMemo(
    () => userRoles.has(CHECKBOOK_ADMIN),
    [userRoles]
  );
  const hasStateRole = React.useMemo(
    () => STATE_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );
  const hasBERole = React.useMemo(
    () => BE_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );
  const sameBU = React.useCallback(
    (stateBUId: string | null) => {
      if (isCheckbookAdmin) return true;
      if (!stateBUId || !userBUId) return false;
      return (
        stateBUId.replace(/[{}]/g, "").toLowerCase() ===
        userBUId.replace(/[{}]/g, "").toLowerCase()
      );
    },
    [isCheckbookAdmin, userBUId]
  );

  const updateFields = async (patch: Record<string, unknown>) => {
    if (!cleanId) return;
    setBusy(true);
    setError(null);
    try {
      await webAPI.updateRecord(entityName || REALIGNMENT_ENTITY, cleanId, patch);
      await reload();
    } catch (e: any) {
      // Plugin InvalidPluginExecutionException messages show up here.
      setError(e?.message ?? "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className={styles.root}>
          <Spinner size="tiny" label="Loading Realignment status..." />
        </div>
      </FluentProvider>
    );
  }

  if (!record) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className={styles.root}>
          <Text>Save the Realignment first to see the approval process.</Text>
        </div>
      </FluentProvider>
    );
  }

  const shape = shapeOf(record);
  const anyDenied = record.stateDenied || record.beDenied;

  // Ownership: at any active moment exactly one side may act — the State (until
  // it has approved, on shapes that have a State stage) else the Budget
  // Executor. This is what enforces "State cannot push past NPM; BE can."
  const awaitingState = shape.hasStateStage && !record.stateApproved && !anyDenied;
  const awaitingBE =
    shape.hasBEStage && !awaitingState && !record.beApproved && !anyDenied;
  const done = !awaitingState && !awaitingBE && !anyDenied;

  const current: Stage = awaitingState ? "state" : awaitingBE ? "npm" : "done";

  // "Complete" per chevron. NPM completes only when BE approves (BE moves the
  // record forward past it), so npm/be light up together.
  const flagFor = (key: Stage): boolean => {
    if (key === "state") return record.stateApproved;
    if (key === "npm") return record.beApproved;
    if (key === "be") return record.beApproved;
    // done
    return (
      (!shape.hasStateStage || record.stateApproved) &&
      (!shape.hasBEStage || record.beApproved)
    );
  };

  const chevronClass = (key: Stage, i: number): string => {
    const classes = [styles.chevron];
    if (i === 0) classes.push(styles.chevronFirst);
    if (!anyDenied && key === current) classes.push(styles.chevronCurrent);
    else if (flagFor(key)) classes.push(styles.chevronPast);
    else classes.push(styles.chevronFuture);
    return classes.filter(Boolean).join(" ");
  };

  const iconFor = (key: Stage): React.ReactElement => {
    if (!anyDenied && key === current) return <IconCurrent />;
    if (flagFor(key)) return <IconCheck />;
    return <IconFuture />;
  };

  const canApproveState = hasStateRole && sameBU(record.debitStateBUId);
  const canDeny =
    (awaitingState && (hasStateRole || isCheckbookAdmin)) ||
    (awaitingBE && hasBERole);

  const doDeny = async () => {
    // Deny writes the choice field owned by the active stage. On denial the
    // RealignmentProcessor deactivates the record, so this is terminal — there
    // is no "return to editing" (unlike State Swaps, whose denial resets flags).
    const field = awaitingState ? STATE_APPROVED : BE_DECISION;
    await updateFields({
      [field]: DENIED_VALUE,
      [DENIAL_REASON]: denyReason || null,
    });
    setDenyReason("");
    setDenyOpen(false);
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
        <div className={styles.chevronRow}>
          {shape.stages.map((s, i) => (
            <div key={s.key} className={chevronClass(s.key, i)}>
              {iconFor(s.key)}
              <Text>{s.label}</Text>
            </div>
          ))}
        </div>

        {anyDenied && (
          <div style={{ marginTop: 12 }}>
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>
                  Realignment denied
                  {record.stateDenied ? " at State Approval" : " at BE Approval"}
                </MessageBarTitle>
                {record.denialReason ??
                  "No reason recorded. Create a new Realignment to try again."}
              </MessageBarBody>
            </MessageBar>
          </div>
        )}

        {awaitingBE && (
          <div style={{ marginTop: 8 }}>
            <MessageBar intent="info">
              <MessageBarBody>
                <MessageBarTitle>NPM Concurrence</MessageBarTitle>
                Concurrence is not yet enforced (no dedicated NPM contacts). The
                record is parked here until a Budget Executor approves.
                {(record.payerConcurrence ?? record.payeeConcurrence) &&
                  ` Payer: ${record.payerConcurrence ?? "—"}; Payee: ${
                    record.payeeConcurrence ?? "—"
                  }.`}
              </MessageBarBody>
            </MessageBar>
          </div>
        )}

        {!anyDenied && !done && (
          <div className={styles.actionsRow}>
            {awaitingState && (
              <Button
                appearance="primary"
                disabled={busy || isDisabled || !canApproveState}
                onClick={() => void updateFields({ [STATE_APPROVED]: APPROVED_VALUE })}
              >
                Approve — State
              </Button>
            )}
            {awaitingBE && (
              <Button
                appearance="primary"
                disabled={busy || isDisabled || !hasBERole}
                onClick={() => void updateFields({ [BE_DECISION]: APPROVED_VALUE })}
              >
                Approve — Budget Execution
              </Button>
            )}

            <Dialog
              open={denyOpen}
              onOpenChange={(_, data) => setDenyOpen(data.open)}
            >
              <DialogTrigger disableButtonEnhancement>
                <Button
                  appearance="secondary"
                  disabled={busy || isDisabled || !canDeny}
                >
                  Deny
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Deny Realignment</DialogTitle>
                  <DialogContent>
                    <div className={styles.reasonBlock}>
                      <Text>
                        Denial closes this Realignment. The reason is recorded on
                        the record. Create a new Realignment to try again.
                      </Text>
                      <Textarea
                        value={denyReason}
                        onChange={(_, data) => setDenyReason(data.value)}
                        placeholder="Reason for denial (optional but recommended)"
                        rows={4}
                      />
                    </div>
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="secondary" disabled={busy}>
                        Cancel
                      </Button>
                    </DialogTrigger>
                    <Button
                      appearance="primary"
                      disabled={busy}
                      onClick={() => void doDeny()}
                    >
                      Confirm denial
                    </Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>

            {awaitingState && !canApproveState && (
              <Text className={styles.helper}>
                {!hasStateRole
                  ? "Only State Approvers, State Administrators, or Checkbook Administrators can approve the State stage."
                  : "Only users in the debiting state's business unit can approve the State stage."}
              </Text>
            )}
            {awaitingBE && !hasBERole && (
              <Text className={styles.helper}>
                Only Budget Executors or Checkbook Administrators can approve BE.
              </Text>
            )}
          </div>
        )}

        {done && (
          <div className={styles.actionsRow}>
            <Text>This Realignment is fully approved.</Text>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 8 }}>
            <MessageBar intent="error">
              <MessageBarBody>
                <MessageBarTitle>Update blocked</MessageBarTitle>
                {error}
              </MessageBarBody>
            </MessageBar>
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
