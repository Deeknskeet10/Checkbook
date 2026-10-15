import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Spinner,
  Text,
} from "@fluentui/react-components";
import {
  WebApi,
  REALIGNMENT,
  ITEMS_SAVED_EVENT,
  ENTRY_MODE_STATE,
  ENTRY_MODE_OPR,
  EntryMode,
  num,
  cleanId,
  useStyles,
} from "./shared";
import { StateBuilder } from "./RealignmentBuilderApp";
import { OprBuilder } from "./OprBuilder";

export interface RealignmentBuilderProps {
  webAPI: WebApi;
  recordId?: string;
  userId?: string;
}

// Role groups that pick the default entry mode (names as in book_realignmentFormProgression.js).
const STATE_ROLES = ["Book - State PM", "Book - State Approver", "Book - State Administrator", "Book - FC Reviewer"];
const OPR_ROLES = ["Book - Budget Executor", "Book - NPM", "Book - Resource Integrator"];
const CHECKBOOK_ADMIN = "Book - Checkbook Administrator";

/**
 * Picks the entry path. A saved realignment keeps its saved mode; a new one defaults from
 * the user's roles (State roles -> State, Budget Executor / NPM -> OPR). Users holding both
 * groups, neither, or Checkbook Administrator get a toggle.
 */
export const RealignmentBuilderApp: React.FC<RealignmentBuilderProps> = ({ webAPI, recordId, userId }) => {
  const styles = useStyles();
  const id = cleanId(recordId);
  const [loading, setLoading] = React.useState(true);
  const [savedMode, setSavedMode] = React.useState<EntryMode | null>(null);
  const [roles, setRoles] = React.useState<Set<string>>(new Set());
  const [chosen, setChosen] = React.useState<EntryMode | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const onSaved = (): void => setReloadKey((k) => k + 1);
    window.addEventListener(ITEMS_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(ITEMS_SAVED_EVENT, onSaved);
  }, []);

  React.useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const uid = cleanId(userId);
        // Role query mirrors UserRoleHelper: direct OR team-derived roles.
        const roleQuery = uid
          ? webAPI.retrieveMultipleRecords(
              "role",
              "?$select=name&$filter=" +
                `systemuserroles_association/any(o:o/systemuserid eq ${uid})` +
                ` or teamroles_association/any(t:t/teammembership_association/any(m:m/systemuserid eq ${uid}))`
            )
          : Promise.resolve({ entities: [] as ComponentFramework.WebApi.Entity[], nextLink: "" });
        const [rec, roleRes] = await Promise.all([
          webAPI.retrieveRecord(REALIGNMENT, id, "?$select=book_realignmententrymode"),
          roleQuery,
        ]);
        if (cancelled) return;
        const m = rec.book_realignmententrymode;
        setSavedMode(m == null ? null : (num(m) as EntryMode));
        setRoles(new Set(roleRes.entities.map((r) => r.name as string)));
      } catch {
        /* fall back to a toggle with no saved mode */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, id, userId, reloadKey]);

  if (!id) {
    return (
      <FluentProvider theme={webLightTheme} style={{ width: "100%" }}>
        <div className={styles.root}>
          <MessageBar intent="info">
            <MessageBarBody>Save the Realignment record first, then build its items here.</MessageBarBody>
          </MessageBar>
        </div>
      </FluentProvider>
    );
  }
  if (loading) {
    return (
      <FluentProvider theme={webLightTheme} style={{ width: "100%" }}>
        <div className={styles.root}>
          <Spinner size="tiny" label="Loading..." />
        </div>
      </FluentProvider>
    );
  }

  const isState = STATE_ROLES.some((r) => roles.has(r));
  const isOpr = OPR_ROLES.some((r) => roles.has(r));
  const canChoose = roles.has(CHECKBOOK_ADMIN) || isState === isOpr;
  const roleMode: EntryMode = isOpr && !isState ? ENTRY_MODE_OPR : ENTRY_MODE_STATE;
  const mode: EntryMode = chosen ?? savedMode ?? roleMode;
  const switching = savedMode !== null && mode !== savedMode;

  return (
    <>
      {canChoose && (
        <FluentProvider theme={webLightTheme} style={{ width: "100%" }}>
          <div className={styles.root}>
            <div className={styles.balanceRow}>
              <Text className={styles.heading}>Realignment type</Text>
              <RadioGroup
                layout="horizontal"
                value={String(mode)}
                onChange={(_, d) => setChosen(num(d.value) as EntryMode)}
              >
                <Radio value={String(ENTRY_MODE_STATE)} label="State (Prioritization to Prioritization)" />
                <Radio value={String(ENTRY_MODE_OPR)} label="OPR (Requirement Funding to Requirement Funding)" />
              </RadioGroup>
            </div>
            {switching && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  This realignment was saved as {savedMode === ENTRY_MODE_OPR ? "OPR" : "State"}. Saving it as{" "}
                  {mode === ENTRY_MODE_OPR ? "OPR" : "State"} replaces those items.
                </MessageBarBody>
              </MessageBar>
            )}
          </div>
        </FluentProvider>
      )}
      {mode === ENTRY_MODE_OPR ? (
        <OprBuilder key="opr" webAPI={webAPI} recordId={id} />
      ) : (
        <StateBuilder key="state" webAPI={webAPI} recordId={id} />
      )}
    </>
  );
};
