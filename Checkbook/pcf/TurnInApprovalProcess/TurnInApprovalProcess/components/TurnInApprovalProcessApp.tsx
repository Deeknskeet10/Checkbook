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

// Role gate — mirrors TurnInValidator.EnforceApprovalRoles. This is UX
// only; the plugin remains the authoritative check.
const STATE_ROLES = [
  "Book - State Approver",
  "Book - State Administrator",
  "Book - Checkbook Administrator",
];
const BE_ROLES = ["Book - Budget Executor", "Book - Checkbook Administrator"];

type Stage = "state" | "be" | "done";

interface TurnInRecord {
  stateApproved: boolean;
  beApproved: boolean;
  requiresBEApproval: boolean;
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
  if (!rec.stateApproved) return "state";
  if (rec.requiresBEApproval && !rec.beApproved) return "be";
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
      const rec = await webAPI.retrieveRecord(
        entityName || TURNIN_ENTITY,
        cleanId,
        `?$select=${STATE_APPROVED},${BE_APPROVED},${REQUIRES_BE}`
      );
      setRecord({
        stateApproved: !!rec[STATE_APPROVED],
        beApproved: !!rec[BE_APPROVED],
        requiresBEApproval: !!rec[REQUIRES_BE],
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
      // Direct role assignments — includes team-derived roles inherited through
      // the systemuser/team join Dataverse exposes on this navigation property.
      const resp = await webAPI.retrieveMultipleRecords(
        "role",
        `?$select=name&$filter=systemuserroles_association/any(o:o/systemuserid eq ${userId})`
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

  const canApproveState = React.useMemo(
    () => STATE_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );
  const canApproveBE = React.useMemo(
    () => BE_ROLES.some((r) => userRoles.has(r)),
    [userRoles]
  );

  const setFlag = async (field: string, value: boolean) => {
    if (!cleanId) return;
    setBusy(true);
    setError(null);
    try {
      await webAPI.updateRecord(entityName || TURNIN_ENTITY, cleanId, {
        [field]: value,
      });
      await reload();
    } catch (e: any) {
      // The plugin's InvalidPluginExecutionException message shows up as
      // e.message here — surface it so the user knows what went wrong.
      setError(e?.message ?? "Update failed.");
    } finally {
      setBusy(false);
    }
  };

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

  const current = stageOf(record);
  const showBE = record.requiresBEApproval;

  // Stage list — index used to decide past/current/future styling.
  const stages: { key: Stage; label: string }[] = [
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
                disabled={busy || isDisabled || !canApproveState}
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

          {current === "be" && (
            <>
              <Button
                appearance="primary"
                disabled={busy || isDisabled || !canApproveBE}
                onClick={() => void setFlag(BE_APPROVED, true)}
              >
                Approve — Budget Execution
              </Button>
              <Button
                appearance="secondary"
                disabled={busy || isDisabled || !canApproveState}
                onClick={() => void setFlag(STATE_APPROVED, false)}
              >
                Deny (return to State)
              </Button>
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
