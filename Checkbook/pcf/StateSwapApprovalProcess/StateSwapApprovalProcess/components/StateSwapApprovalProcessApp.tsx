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

export interface StateSwapApprovalProcessProps {
  webAPI: WebApi;
  userSettings: UserSettings;
  entityId: string;
  entityName: string;
  isDisabled: boolean;
  width: number;
}

const SWAP_ENTITY = "book_stateswap";
const STATE_A_APPROVED = "book_stateaapproved";
const STATE_B_APPROVED = "book_statebapproved";
const BE_APPROVED = "book_beapproved";
const DENIED = "book_denied";
const DENIAL_REASON = "book_denialreason";
const IS_BALANCED = "book_isbalanced";
const STATE_A_VALUE = "_book_statea_value";
const STATE_B_VALUE = "_book_stateb_value";
const STATE_ENTITY = "book_state";
const STATE_BU_VALUE = "_owningbusinessunit_value";
const USER_ENTITY = "systemuser";
const USER_BU_VALUE = "_businessunitid_value";

// Role gate — mirrors SwapValidator.EnforceApprovalRoles. UX only; the
// plugin remains the authoritative check. Not scoped to a specific state's
// BU here — see the Slice-3 note about future state-scoping hardening.
const STATE_ROLES = [
  "Book - State Approver",
  "Book - State Administrator",
  "Book - Checkbook Administrator",
];
const BE_ROLES = ["Book - Budget Executor", "Book - Checkbook Administrator"];
const DENY_ROLES = [
  "Book - State Approver",
  "Book - State Administrator",
  "Book - Budget Executor",
  "Book - Checkbook Administrator",
];

type Stage = "stateA" | "stateB" | "be" | "done";

interface SwapRecord {
  stateAApproved: boolean;
  stateBApproved: boolean;
  beApproved: boolean;
  denied: boolean;
  denialReason: string | null;
  isBalanced: boolean;
  // BU of each state's owning business unit. Compared to the caller's BU to
  // gate per-state approval (mirrors StateScopeHelper.IsUserInStateBU on the
  // plugin side). Null when the swap doesn't have that state set yet.
  stateABUId: string | null;
  stateBBUId: string | null;
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

async function resolveStateBU(
  webAPI: WebApi,
  stateId: string
): Promise<string | null> {
  try {
    const s = await webAPI.retrieveRecord(
      STATE_ENTITY,
      stateId.replace(/[{}]/g, ""),
      `?$select=${STATE_BU_VALUE}`
    );
    return (s[STATE_BU_VALUE] as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Current stage is the first uncompleted stage in [stateA, stateB, be].
 * Chevrons before it are green (past), the current one is highlighted, later
 * ones are gray. Because either state can approve first, a stateB-first flow
 * shows chevron B as past while chevron A is current — which reads as "State
 * A is still outstanding," matching intent.
 */
function stageOf(rec: SwapRecord): Stage {
  if (!rec.stateAApproved) return "stateA";
  if (!rec.stateBApproved) return "stateB";
  if (!rec.beApproved) return "be";
  return "done";
}

export const StateSwapApprovalProcessApp: React.FC<StateSwapApprovalProcessProps> = ({
  webAPI,
  userSettings,
  entityId,
  entityName,
  isDisabled,
}) => {
  const styles = useStyles();
  const [record, setRecord] = React.useState<SwapRecord | null>(null);
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
        entityName || SWAP_ENTITY,
        cleanId,
        `?$select=${STATE_A_APPROVED},${STATE_B_APPROVED},${BE_APPROVED},${DENIED},${DENIAL_REASON},${IS_BALANCED},${STATE_A_VALUE},${STATE_B_VALUE}`
      );

      // Resolve each state's owning BU in parallel — needed for the per-state
      // approval gate. States might be missing on a freshly-drafted swap.
      const stateAId = rec[STATE_A_VALUE] as string | null;
      const stateBId = rec[STATE_B_VALUE] as string | null;
      const [stateABU, stateBBU] = await Promise.all([
        stateAId ? resolveStateBU(webAPI, stateAId) : Promise.resolve(null),
        stateBId ? resolveStateBU(webAPI, stateBId) : Promise.resolve(null),
      ]);

      setRecord({
        stateAApproved: !!rec[STATE_A_APPROVED],
        stateBApproved: !!rec[STATE_B_APPROVED],
        beApproved: !!rec[BE_APPROVED],
        denied: !!rec[DENIED],
        denialReason: (rec[DENIAL_REASON] as string | null) ?? null,
        isBalanced: !!rec[IS_BALANCED],
        stateABUId: stateABU,
        stateBBUId: stateBBU,
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load State Swap record.");
    } finally {
      setLoading(false);
    }
  }, [cleanId, entityName, webAPI]);

  const loadRoles = React.useCallback(async () => {
    const userId = (userSettings.userId || "").replace(/[{}]/g, "");
    if (!userId) return;
    try {
      // Fetch roles + the caller's business unit in parallel — the BU is what
      // gates per-state approval alongside the role check. Role query mirrors
      // UserRoleHelper: direct assignments (systemuserroles_association) OR
      // team-derived roles (teamroles_association → teammembership_association).
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
    () => userRoles.has("Book - Checkbook Administrator"),
    [userRoles]
  );
  const hasStateRole = React.useMemo(
    () => STATE_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );
  const sameBU = React.useCallback(
    (stateBUId: string | null) => {
      if (isCheckbookAdmin) return true;
      if (!stateBUId || !userBUId) return false;
      return stateBUId.replace(/[{}]/g, "").toLowerCase()
        === userBUId.replace(/[{}]/g, "").toLowerCase();
    },
    [isCheckbookAdmin, userBUId]
  );
  const canApproveStateA = React.useMemo(
    () => hasStateRole && sameBU(record?.stateABUId ?? null),
    [hasStateRole, sameBU, record?.stateABUId]
  );
  const canApproveStateB = React.useMemo(
    () => hasStateRole && sameBU(record?.stateBBUId ?? null),
    [hasStateRole, sameBU, record?.stateBBUId]
  );
  const canApproveBE = React.useMemo(
    () => BE_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );
  const canDeny = React.useMemo(
    () => DENY_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );

  const updateFields = async (patch: Record<string, unknown>) => {
    if (!cleanId) return;
    setBusy(true);
    setError(null);
    try {
      await webAPI.updateRecord(entityName || SWAP_ENTITY, cleanId, patch);
      await reload();
    } catch (e: any) {
      // Plugin InvalidPluginExecutionException messages show up here.
      setError(e?.message ?? "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const doDeny = async () => {
    await updateFields({
      [DENIED]: true,
      [DENIAL_REASON]: denyReason || null,
    });
    setDenyReason("");
    setDenyOpen(false);
  };

  const doAcknowledgeDenial = async () => {
    // Explicit "return to editing" action — clears the flag without waiting
    // for another field change. SwapDenialPlugin Case B would also clear this
    // on any next save.
    await updateFields({ [DENIED]: false });
  };

  if (loading) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className={styles.root}>
          <Spinner size="tiny" label="Loading State Swap status..." />
        </div>
      </FluentProvider>
    );
  }

  if (!record) {
    return (
      <FluentProvider theme={webLightTheme}>
        <div className={styles.root}>
          <Text>Save the State Swap first to see the approval process.</Text>
        </div>
      </FluentProvider>
    );
  }

  const current = stageOf(record);
  const stages: { key: Stage; label: string }[] = [
    { key: "stateA", label: "State A Approval" },
    { key: "stateB", label: "State B Approval" },
    { key: "be", label: "BE Approval" },
    { key: "done", label: "Approved" },
  ];
  // "Past" here means the flag is set, regardless of position — so a stateB-
  // first flow shows chevron B as green while A is current. Kept explicit
  // rather than using a currentIdx-based comparison.
  const flagFor = (key: Stage): boolean => {
    if (key === "stateA") return record.stateAApproved;
    if (key === "stateB") return record.stateBApproved;
    if (key === "be") return record.beApproved;
    return record.stateAApproved && record.stateBApproved && record.beApproved;
  };

  const chevronClass = (key: Stage, i: number): string => {
    const classes = [styles.chevron];
    if (i === 0) classes.push(styles.chevronFirst);
    if (key === current) classes.push(styles.chevronCurrent);
    else if (flagFor(key)) classes.push(styles.chevronPast);
    else classes.push(styles.chevronFuture);
    return classes.filter(Boolean).join(" ");
  };

  const iconFor = (key: Stage): React.ReactElement => {
    if (key === current) return <IconCurrent />;
    if (flagFor(key)) return <IconCheck />;
    return <IconFuture />;
  };

  const showApproveButtons = !record.denied && current !== "done";
  // book_isbalanced is now "ready to approve" — both states contribute >0 AND
  // every item has both Debit + Credit Prio set. The name is legacy; the
  // semantic changed when the equal-totals rule was retired (states may trade
  // unevenly, e.g. 2-for-1).
  const balancedRequiredMsg =
    !record.isBalanced && current !== "done"
      ? "State Swap is not ready to approve. Every Swap Item must have both a Debit and a Credit Prioritization, and both states must contribute."
      : null;

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root}>
        <div className={styles.chevronRow}>
          {stages.map((s, i) => (
            <div key={s.key} className={chevronClass(s.key, i)}>
              {iconFor(s.key)}
              <Text>{s.label}</Text>
            </div>
          ))}
        </div>

        {record.denied && (
          <div style={{ marginTop: 12 }}>
            <MessageBar intent="warning">
              <MessageBarBody>
                <MessageBarTitle>Swap denied</MessageBarTitle>
                {record.denialReason ??
                  "No reason recorded. Revise and resubmit."}
              </MessageBarBody>
            </MessageBar>
            <div style={{ marginTop: 8 }}>
              <Button
                appearance="secondary"
                disabled={busy || isDisabled}
                onClick={() => void doAcknowledgeDenial()}
              >
                Return to editing
              </Button>
            </div>
          </div>
        )}

        {showApproveButtons && (
          <div className={styles.actionsRow}>
            {current === "stateA" && (
              <Button
                appearance="primary"
                disabled={
                  busy || isDisabled || !canApproveStateA || !record.isBalanced
                }
                onClick={() =>
                  void updateFields({ [STATE_A_APPROVED]: true })
                }
              >
                Approve — State A
              </Button>
            )}
            {current === "stateB" && (
              <Button
                appearance="primary"
                disabled={
                  busy || isDisabled || !canApproveStateB || !record.isBalanced
                }
                onClick={() =>
                  void updateFields({ [STATE_B_APPROVED]: true })
                }
              >
                Approve — State B
              </Button>
            )}
            {current === "be" && (
              <Button
                appearance="primary"
                disabled={
                  busy || isDisabled || !canApproveBE || !record.isBalanced
                }
                onClick={() => void updateFields({ [BE_APPROVED]: true })}
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
                  <DialogTitle>Deny State Swap</DialogTitle>
                  <DialogContent>
                    <div className={styles.reasonBlock}>
                      <Text>
                        Denial resets both state approvals so the drafter can
                        revise. The reason is preserved on the record until the
                        swap is re-approved.
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

            {balancedRequiredMsg && (
              <Text className={styles.helper}>{balancedRequiredMsg}</Text>
            )}
            {current === "stateA" && !canApproveStateA && (
              <Text className={styles.helper}>
                {!hasStateRole
                  ? "Only State Approvers, State Administrators, or Checkbook Administrators can approve."
                  : "Only users in State A's business unit can approve State A."}
              </Text>
            )}
            {current === "stateB" && !canApproveStateB && (
              <Text className={styles.helper}>
                {!hasStateRole
                  ? "Only State Approvers, State Administrators, or Checkbook Administrators can approve."
                  : "Only users in State B's business unit can approve State B."}
              </Text>
            )}
            {current === "be" && !canApproveBE && (
              <Text className={styles.helper}>
                Only Budget Executors or Checkbook Administrators can approve
                BE.
              </Text>
            )}
          </div>
        )}

        {!record.denied && current === "done" && (
          <div className={styles.actionsRow}>
            <Text>This State Swap is fully approved.</Text>
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
