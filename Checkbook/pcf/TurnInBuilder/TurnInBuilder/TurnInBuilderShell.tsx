import * as React from "react";
import {
  FluentProvider,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Spinner,
  Text,
} from "@fluentui/react-components";
import {
  WebApi,
  TURNIN,
  TURNIN_ITEM,
  ITEMS_SAVED_EVENT,
  STATECODE_ACTIVE,
  EntryMode,
  num,
  cleanId,
  useStyles,
} from "./shared";
import { checkbookTheme } from "./designSystem";
import { StateTurnIn } from "./StateTurnIn";
import { RfTurnIn } from "./RfTurnIn";

export interface TurnInBuilderProps {
  webAPI: WebApi;
  recordId?: string;
  userId?: string;
}

// Role groups that pick the default entry type. RF-level Turn-Ins are created by NPMs and
// approved by a Resource Integrator or CSOR (docs/TurnIn-FY27-Redesign.md §2).
const STATE_ROLES = [
  "Book - State PM",
  "Book - State Approver",
  "Book - State Administrator",
  "Book - FC Reviewer",
];
const RF_ROLES = ["Book - NPM", "Book - Resource Integrator", "Book - CSOR"];
const CHECKBOOK_ADMIN = "Book - Checkbook Administrator";
const SYSTEM_ADMIN = "System Administrator";
const NPM_ROLE = "Book - NPM";
// Roles that may not pick the RF-level ("TARC Requirement (NPM)") Turn-In type.
const NO_RF_OPTION_ROLES = [
  "Book - State PM",
  "Book - State Approver",
  "Book - State Administrator",
];
const ORIGIN_SWEEP = 1;
const FIRST_ITEM_BASED_FY = 2027;

interface Header {
  active: boolean;
  fy: number | null;
  sweep: boolean;
  fundCenterId: string;
}

/**
 * FY27 Turn-In entry. A saved Turn-In keeps its saved type; a new one defaults from the
 * user's roles: State roles -> Prioritization, NPM / Resource Integrator / CSOR -> RF-level. A State user never gets the RF option — States turn in through a
 * Prioritization (TurnInValidator enforces the same). Dual-role, no-role and Checkbook
 * Administrator users get a toggle, hidden once lines are saved (the type is then locked to them).
 */
export const TurnInBuilderApp: React.FC<TurnInBuilderProps> = ({
  webAPI,
  recordId,
  userId,
}) => {
  const styles = useStyles();
  const id = cleanId(recordId);
  const [loading, setLoading] = React.useState(true);
  const [header, setHeader] = React.useState<Header | null>(null);
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
                ` or teamroles_association/any(t:t/teammembership_association/any(m:m/systemuserid eq ${uid}))`,
            )
          : Promise.resolve({
              entities: [] as ComponentFramework.WebApi.Entity[],
              nextLink: "",
            });
        const [rec, items, roleRes] = await Promise.all([
          webAPI.retrieveRecord(
            TURNIN,
            id,
            "?$select=statecode,book_fiscalyear,book_origin,_book_fundcenter_value,book_stateapproved,book_beapproved",
          ),
          webAPI.retrieveMultipleRecords(
            TURNIN_ITEM,
            `?$select=_book_prioritization_value&$filter=_book_turnin_value eq ${id} and statecode eq ${STATECODE_ACTIVE}`,
          ),
          roleQuery,
        ]);
        if (cancelled) return;
        setHeader({
          // TurnInLineLock (server) freezes the lines once a Turn-In is approved, processed or
          // denied — editing them would not reverse funds already moved. Mirror it here.
          active:
            num(rec.statecode) === STATECODE_ACTIVE &&
            rec.book_stateapproved !== true &&
            rec.book_beapproved !== true,
          fy: rec.book_fiscalyear == null ? null : num(rec.book_fiscalyear),
          sweep: num(rec.book_origin) === ORIGIN_SWEEP,
          fundCenterId: cleanId(rec._book_fundcenter_value),
        });
        setSavedMode(
          items.entities.length === 0
            ? null
            : items.entities.some((e) => !!e._book_prioritization_value)
              ? "state"
              : "rf",
        );
        setRoles(new Set(roleRes.entities.map((r) => r.name as string)));
      } catch {
        /* fall through: header stays null and a message renders */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webAPI, id, userId, reloadKey]);

  const wrap = (child: React.ReactNode): React.ReactElement => (
    <FluentProvider theme={checkbookTheme} style={{ width: "100%" }}>
      <div className={styles.root}>{child}</div>
    </FluentProvider>
  );
  // Waiting for record data: the single grey-panel style (Design Documentation §8 Feedback),
  // as on the Turn-In Approval Process.
  const info = (text: string): React.ReactElement => (
    <FluentProvider theme={checkbookTheme} style={{ width: "100%" }}>
      <div className={styles.awaiting}>
        <Text>{text}</Text>
      </div>
    </FluentProvider>
  );

  if (!id)
    return info(
      "Save the Turn-In first (Name, Fiscal Year and Fund Center), then build its lines here.",
    );
  if (loading) return wrap(<Spinner size="tiny" label="Loading Turn-In…" />);
  if (!header)
    return wrap(
      <MessageBar intent="error">
        <MessageBarBody>Could not load the Turn-In.</MessageBarBody>
      </MessageBar>,
    );
  if (header.sweep)
    return info(
      "This is a Sweep Turn-In created by Generate Distributions. It has no lines to build.",
    );
  if (header.fy == null)
    return info(
      "Set the Fiscal Year and save, then build the Turn-In lines here.",
    );
  if (header.fy < FIRST_ITEM_BASED_FY)
    return info("FY26 Turn-Ins use the Turn-In Items grid below.");

  const isState = STATE_ROLES.some((r) => roles.has(r));
  const isRf = RF_ROLES.some((r) => roles.has(r));
  const isAdmin = roles.has(CHECKBOOK_ADMIN);
  const canChoose = isAdmin || (isRf && isState) || (!isRf && !isState);
  const roleMode: EntryMode = isRf && !isState ? "rf" : "state";
  // A State user (no RF role, not admin) is always on the Prioritization path.
  // Once lines are saved the type is locked to them (savedMode); before that the toggle decides.
  const locked = savedMode !== null;
  const mode: EntryMode =
    isState && !isRf && !isAdmin ? "state" : (savedMode ?? chosen ?? roleMode);

  // Option restrictions. Checkbook / System Administrators are never restricted. An NPM can't pick
  // the Prioritization (State) type; State Admin / Approver / PM can't pick the TARC Requirement (NPM)
  // type. A user holding both an NPM and a State role stays unrestricted (the two rules conflict).
  const unrestricted = isAdmin || roles.has(SYSTEM_ADMIN);
  const isNpm = roles.has(NPM_ROLE);
  const isRestrictedState = NO_RF_OPTION_ROLES.some((r) => roles.has(r));
  const disablePrioOption = !unrestricted && isNpm && !isRestrictedState;
  const disableRfOption = !unrestricted && isRestrictedState && !isNpm;
  const showSelector = canChoose || disablePrioOption || disableRfOption;

  return (
    // Column layout so the type selector sits above the builder rather than beside it.
    <div style={{ display: "flex", flexDirection: "column", width: "100%" }}>
      {showSelector && !locked && (
        <FluentProvider theme={checkbookTheme} style={{ width: "100%" }}>
          <div className={styles.root} style={{ paddingBottom: 0 }}>
            <div
              className={styles.typeBar}
              role="group"
              aria-labelledby="turnin-type-label"
            >
              <Text id="turnin-type-label" className={styles.fieldLabel}>
                Turn-In Type
              </Text>
              <RadioGroup
                layout="horizontal"
                className={styles.radioGroup}
                aria-labelledby="turnin-type-label"
                value={mode}
                onChange={(_, d) => setChosen(d.value as EntryMode)}
              >
                <Radio
                  value="state"
                  label="Prioritization (State)"
                  disabled={disablePrioOption}
                  className={styles.radio}
                  indicator={{ className: styles.radioRing }}
                />
                <Radio
                  value="rf"
                  label="TARC Requirement (NPM)"
                  disabled={disableRfOption}
                  className={styles.radio}
                  indicator={{ className: styles.radioRing }}
                />
              </RadioGroup>
            </div>
          </div>
        </FluentProvider>
      )}
      {mode === "rf" ? (
        <RfTurnIn
          key="rf"
          webAPI={webAPI}
          recordId={id}
          isActive={header.active}
          fiscalYear={header.fy}
        />
      ) : (
        <StateTurnIn
          key="state"
          webAPI={webAPI}
          recordId={id}
          isActive={header.active}
          fiscalYear={header.fy}
          fundCenterId={header.fundCenterId}
        />
      )}
    </div>
  );
};
