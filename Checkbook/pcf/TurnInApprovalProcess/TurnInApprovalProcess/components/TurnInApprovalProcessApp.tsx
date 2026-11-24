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

export interface TurnInApprovalProcessProps {
  webAPI: WebApi;
  userSettings: UserSettings;
  entityId: string;
  entityName: string;
  isDisabled: boolean;
  width: number;
}

const TURNIN_ENTITY = "book_turnin";
const STATE_APPROVED = "book_stateapproved";
const BE_APPROVED = "book_beapproved";
const REQUIRES_BE = "book_requiresbeapproval";
// Fired on window by the TurnInBuilder control after it saves the Turn-In Items.
const ITEMS_SAVED_EVENT = "book:turnin-items-saved";

// Role gate — mirrors TurnInValidator.EnforceApprovalRoles. This is UX
// only; the plugin remains the authoritative check.
const STATE_ROLES = [
  "Book - State Approver",
  "Book - State Administrator",
  "Book - Checkbook Administrator",
];
const BE_ROLES = ["Book - Budget Executor", "Book - Checkbook Administrator"];
// FY27 Requirement Funding Turn-Ins: NPM creates, Resource Integrator / CSOR approves in
// one step (carried on book_beapproved) — no State or Budget Execution step.
const RF_ROLES = ["Book - Resource Integrator", "Book - CSOR", "Book - Checkbook Administrator"];
const FISCAL_YEAR = "book_fiscalyear";
const FIRST_RF_ROUTE_FY = 2027;
// FY27+: every Turn-In goes State -> BE (the BE step is always shown, even when
// book_requiresbeapproval is false). A BE Deny is final: status = Denied, State approval is
// cleared (the signal TurnInDeactivator keys on) and the record is deactivated and kept for
// record keeping — the user must create a new Turn-In.
const FIRST_ALWAYS_BE_FY = 2027;
const TURNIN_STATUS = "book_turninstatus";
const TURNIN_STATUS_DENIED = 2;
const ORIGIN = "book_origin";
const ORIGIN_SWEEP = 1;
const TURNIN_ITEM_ENTITY = "book_turninitems";
const STATECODE_ACTIVE = 0;

type Stage = "state" | "be" | "done";

interface TurnInRecord {
  stateApproved: boolean;
  beApproved: boolean;
  requiresBEApproval: boolean;
  /** FY27+: the BE step is mandatory for every Turn-In, independent of requiresBEApproval. */
  beAlways: boolean;
  /** book_turninstatus = Denied — final; the Turn-In is kept for record keeping only. */
  denied: boolean;
  /** FY27+ Requirement Funding Turn-In: single RI / CSOR approval. */
  rfRoute: boolean;
  /**
   * Has at least one active line with a Prioritization or Requirement Funding. Sweep
   * Turn-Ins are approved with zero lines (AFP-only path), so they always count as built.
   */
  built: boolean;
}

const useStyles = makeStyles({
  provider: {
    width: "100%",
    boxSizing: "border-box",
  },
  root: {
    width: "100%",
    boxSizing: "border-box",
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
    clipPath: "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)",
    flexGrow: 1,
    minWidth: "160px",
  },
  chevronFirst: {
    clipPath: "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)",
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
});

function stageOf(rec: TurnInRecord): Stage {
  if (rec.rfRoute) return rec.beApproved ? "done" : "be";
  if (!rec.stateApproved) return "state";
  if ((rec.requiresBEApproval || rec.beAlways) && !rec.beApproved) return "be";
  return "done";
}

export const TurnInApprovalProcessApp: React.FC<TurnInApprovalProcessProps> = ({
  webAPI,
  userSettings,
  entityId,
  entityName,
  isDisabled,
}) => {
  const styles = useStyles();
  const [record, setRecord] = React.useState<TurnInRecord | null>(null);
  const [userRoles, setUserRoles] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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
      const [rec, lines] = await Promise.all([
        webAPI.retrieveRecord(
          entityName || TURNIN_ENTITY,
          cleanId,
          `?$select=${STATE_APPROVED},${BE_APPROVED},${REQUIRES_BE},${FISCAL_YEAR},${ORIGIN},${TURNIN_STATUS}`
        ),
        webAPI.retrieveMultipleRecords(
          TURNIN_ITEM_ENTITY,
          `?$select=_book_turnin_value&$filter=_book_turnin_value eq ${cleanId}` +
            ` and statecode eq ${STATECODE_ACTIVE}` +
            " and (_book_prioritization_value ne null or _book_requirementfunding_value ne null)&$top=1"
        ),
      ]);
      const fyRaw: unknown = rec[FISCAL_YEAR];
      const fy = typeof fyRaw === "number" ? fyRaw : 0;
      setRecord({
        stateApproved: !!rec[STATE_APPROVED],
        beApproved: !!rec[BE_APPROVED],
        requiresBEApproval: !!rec[REQUIRES_BE],
        beAlways: fy >= FIRST_ALWAYS_BE_FY,
        denied: rec[TURNIN_STATUS] === TURNIN_STATUS_DENIED,
        rfRoute: !!rec[REQUIRES_BE] && fy >= FIRST_RF_ROUTE_FY,
        built: rec[ORIGIN] === ORIGIN_SWEEP || lines.entities.length > 0,
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load Turn-In record.");
    } finally {
      setLoading(false);
    }
  }, [cleanId, entityName, webAPI]);

  const loadRoles = React.useCallback(async () => {
    const userId = (userSettings.userId || "").replace(/[{}]/g, "");
    if (!userId) return;
    try {
      // Mirror UserRoleHelper on the plugin side: fetch direct role assignments
      // AND roles inherited via team membership. The systemuserroles_association
      // navigation returns only direct assignments; team-derived roles come in
      // through teamroles_association → teammembership_association.
      const filter =
        `systemuserroles_association/any(o:o/systemuserid eq ${userId})` +
        ` or teamroles_association/any(t:t/teammembership_association/any(m:m/systemuserid eq ${userId}))`;
      const resp = await webAPI.retrieveMultipleRecords(
        "role",
        `?$select=name&$filter=${filter}`
      );
      const names = new Set<string>();
      for (const r of resp.entities) {
        if (r.name) names.add(r.name as string);
      }
      setUserRoles(names);
    } catch {
      // Best-effort — if role fetch fails, buttons render disabled and the
      // plugin still enforces authoritatively. Don't surface a scary error.
      setUserRoles(new Set());
    }
  }, [userSettings.userId, webAPI]);

  React.useEffect(() => {
    void reload();
    void loadRoles();
  }, [reload, loadRoles]);

  // The TurnInBuilder (a separate control on the same form) fires this after saving
  // items — whether BE Approval is needed depends on them, so re-read the record.
  React.useEffect(() => {
    const onSaved = (): void => void reload();
    window.addEventListener(ITEMS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(ITEMS_SAVED_EVENT, onSaved);
  }, [reload]);

  const canApproveState = React.useMemo(
    () => STATE_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );
  const canApproveBE = React.useMemo(
    () => BE_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );
  const canApproveRf = React.useMemo(
    () => RF_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );

  const update = async (payload: Record<string, unknown>) => {
    if (!cleanId) return;
    setBusy(true);
    setError(null);
    try {
      await webAPI.updateRecord(entityName || TURNIN_ENTITY, cleanId, payload);
      await reload();
    } catch (e: any) {
      // The plugin's InvalidPluginExecutionException message shows up as
      // e.message here — surface it so the user knows what went wrong.
      setError(e?.message ?? "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const setFlag = (field: string, value: boolean) => update({ [field]: value });

  // FY27+ BE Deny: final. Status -> Denied and State approval cleared in one save;
  // TurnInDeactivator keys on the State flag flipping true -> false and deactivates the record.
  const denyTurnIn = () =>
    update({ [STATE_APPROVED]: false, [TURNIN_STATUS]: TURNIN_STATUS_DENIED });

  if (loading) {
    return (
      <FluentProvider theme={webLightTheme} className={styles.provider}>
        <div className={styles.root}>
          <Spinner size="tiny" label="Loading Turn-In status..." />
        </div>
      </FluentProvider>
    );
  }

  if (!record) {
    return (
      <FluentProvider theme={webLightTheme} className={styles.provider}>
        <div className={styles.root}>
          <Text>Save the Turn-In first to see the approval process.</Text>
        </div>
      </FluentProvider>
    );
  }

  // Denied is terminal: no stage chevrons or actions, just the outcome. The record is kept
  // (inactive) for record keeping; a new Turn-In must be created instead.
  if (record.denied) {
    return (
      <FluentProvider theme={webLightTheme} className={styles.provider}>
        <div className={styles.root}>
          <div className={styles.chevronRow}>
            <div className={[styles.chevron, styles.chevronFirst, styles.chevronCurrent].join(" ")}>
              <Text>Denied</Text>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <MessageBar intent="error">
              <MessageBarBody>
                This Turn-In was denied and is kept for record keeping. Create a new Turn-In to
                resubmit.
              </MessageBarBody>
            </MessageBar>
          </div>
        </div>
      </FluentProvider>
    );
  }

  const current = stageOf(record);
  // FY27+: the BE step is always visible. Pre-FY27 it only appears when BE is required.
  const showBE = record.requiresBEApproval || record.beAlways;
  // Nothing to approve yet: no Prioritization or Requirement Funding lines are saved.
  const notBuilt = !record.built && current !== "done";
  const blocked = busy || isDisabled || notBuilt;

  // Stage list — index used to decide past/current/future styling.
  const stages: { key: Stage; label: string }[] = record.rfRoute
    ? [
        { key: "be", label: "RI / CSOR Approval" },
        { key: "done", label: "Approved" },
      ]
    : [
        { key: "state", label: "State Approval" },
        ...(showBE ? [{ key: "be" as Stage, label: "BE Approval" }] : []),
        { key: "done", label: "Approved" },
      ];
  const currentIdx = stages.findIndex((s) => s.key === current);

  const iconFor = (idx: number) => {
    if (idx < currentIdx) return <IconCheck />;
    if (idx === currentIdx) return <IconCurrent />;
    return <IconFuture />;
  };

  return (
    <FluentProvider theme={webLightTheme} className={styles.provider}>
      <div className={styles.root}>
        <div className={styles.chevronRow}>
          {stages.map((s, i) => (
            <div
              key={s.key}
              className={[
                styles.chevron,
                i === 0 ? styles.chevronFirst : "",
                i < currentIdx ? styles.chevronPast : "",
                i === currentIdx ? styles.chevronCurrent : "",
                i > currentIdx ? styles.chevronFuture : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {iconFor(i)}
              <Text>{s.label}</Text>
            </div>
          ))}
        </div>

        <div className={styles.actionsRow}>
          {current === "state" && (
            <>
              <Button
                appearance="primary"
                disabled={blocked || !canApproveState}
                onClick={() => void setFlag(STATE_APPROVED, true)}
              >
                Approve — State
              </Button>
              {!canApproveState && (
                <Text className={styles.helper}>
                  Only State Approvers, State Administrators, or Checkbook
                  Administrators can approve.
                </Text>
              )}
            </>
          )}

          {current === "be" && record.rfRoute && (
            <>
              <Button
                appearance="primary"
                disabled={blocked || !canApproveRf}
                onClick={() => void setFlag(BE_APPROVED, true)}
              >
                Approve — RI / CSOR
              </Button>
              {!canApproveRf && (
                <Text className={styles.helper}>
                  Only Resource Integrators, CSORs, or Checkbook Administrators can
                  approve a Requirement Funding Turn-In.
                </Text>
              )}
            </>
          )}

          {current === "be" && !record.rfRoute && (
            <>
              <Button
                appearance="primary"
                disabled={blocked || !canApproveBE}
                onClick={() => void setFlag(BE_APPROVED, true)}
              >
                Approve — Budget Execution
              </Button>
              {record.beAlways ? (
                // FY27+: only BE can Deny. Final — the Turn-In is kept as Denied and a new one
                // must be created.
                <Button
                  appearance="secondary"
                  disabled={busy || isDisabled || !canApproveBE}
                  onClick={() => void denyTurnIn()}
                >
                  Deny
                </Button>
              ) : (
                <Button
                  appearance="secondary"
                  disabled={busy || isDisabled || !canApproveState}
                  onClick={() => void setFlag(STATE_APPROVED, false)}
                >
                  Deny (return to State)
                </Button>
              )}
              {!canApproveBE && (
                <Text className={styles.helper}>
                  Only Budget Executors or Checkbook Administrators can
                  approve BE.
                </Text>
              )}
            </>
          )}

          {current === "done" && (
            <Text>This Turn-In is fully approved.</Text>
          )}
        </div>

        {notBuilt && (
          <div style={{ marginTop: 8 }}>
            <MessageBar intent="info">
              <MessageBarBody>Please complete building the Turn-In before approving.</MessageBarBody>
            </MessageBar>
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
