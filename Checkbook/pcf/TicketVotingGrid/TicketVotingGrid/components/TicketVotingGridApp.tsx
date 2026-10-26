import * as React from "react";
import {
  FluentProvider,
  webLightTheme,
  makeStyles,
  shorthands,
  tokens,
  Badge,
  Button,
  Combobox,
  Link,
  MessageBar,
  MessageBarBody,
  Option,
  Spinner,
  Text,
  Tooltip,
} from "@fluentui/react-components";

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type WebApi = ComponentFramework.WebApi;
type Navigation = ComponentFramework.Navigation;
type UserSettings = ComponentFramework.UserSettings;

const TICKET_ENTITY = "book_ticket";
const ENDORSEMENT_ENTITY = "book_ticketendorsement";
const CAST_VOTE_API = "book_CastVote";

/** Property-set aliases declared in ControlManifest.Input.xml. */
const ALIAS = {
  name: "name",
  ticketType: "ticketType",
  ticketStatus: "ticketStatus",
  score: "score",
  owner: "owner",
} as const;

export interface TicketRow {
  id: string;
  name: string;
  ticketTypeValue: number | null;
  ticketTypeLabel: string | null;
  statusLabel: string | null;
  score: number;
  ownerName: string | null;
}

export interface TicketVotingGridProps {
  dataset?: DataSet;
  webAPI: WebApi;
  navigation: Navigation;
  userSettings: UserSettings;
  isDisabled: boolean;
  width: number;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    ...shorthands.gap("12px"),
    ...shorthands.padding("12px"),
    fontFamily: tokens.fontFamilyBase,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    ...shorthands.gap("12px"),
    flexWrap: "wrap",
  },
  title: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    marginRight: "auto",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    ...shorthands.gap("8px"),
  },
  row: {
    display: "flex",
    alignItems: "center",
    ...shorthands.gap("12px"),
    ...shorthands.padding("10px", "14px"),
    ...shorthands.borderRadius(tokens.borderRadiusMedium),
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
  },
  voteBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: "44px",
    ...shorthands.gap("2px"),
  },
  arrow: {
    minWidth: "28px",
    height: "24px",
    ...shorthands.padding(0),
    fontSize: "16px",
    lineHeight: "16px",
  },
  arrowActiveUp: {
    color: tokens.colorPaletteGreenForeground1,
  },
  arrowActiveDown: {
    color: tokens.colorPaletteRedForeground1,
  },
  score: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    ...shorthands.gap("4px"),
    minWidth: 0,
    flexGrow: 1,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    ...shorthands.gap("8px"),
    flexWrap: "wrap",
  },
  metaText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  empty: {
    ...shorthands.padding("24px"),
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

/** The model-driven host exposes the global Xrm object; PCF's context.webAPI
 *  has no execute() for Custom APIs, so we call book_CastVote through it. */
interface XrmExecuteResponse {
  json: () => Promise<{ NewScore: number; UserVote: number }>;
}
interface XrmLike {
  WebApi: { online: { execute: (req: unknown) => Promise<XrmExecuteResponse> } };
}
function getXrm(): XrmLike | null {
  const w = window as unknown as { Xrm?: XrmLike };
  return w.Xrm ?? null;
}

/** Strips the {braces} Dataverse wraps around a GUID. */
function bareGuid(id: string): string {
  return id.replace(/[{}]/g, "").toLowerCase();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const TicketVotingGridApp: React.FC<TicketVotingGridProps> = (props) => {
  const { dataset, webAPI, navigation, userSettings, isDisabled } = props;
  const styles = useStyles();

  const [typeFilter, setTypeFilter] = React.useState<number | "all">("all");
  // Per-ticket overlay of score + this user's current vote, applied over the
  // dataset's (possibly stale) values as the user clicks.
  const [overrides, setOverrides] = React.useState<
    Record<string, { score: number; myVote: number }>
  >({});
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  const baseRows: TicketRow[] = React.useMemo(() => {
    if (!dataset || dataset.loading) return [];
    return dataset.sortedRecordIds.map((id) => {
      const r = dataset.records[id];
      const typeRaw = r.getValue(ALIAS.ticketType);
      return {
        id,
        name: (r.getValue(ALIAS.name) as string | null) ?? "(untitled)",
        ticketTypeValue: typeRaw == null ? null : num(typeRaw),
        ticketTypeLabel: r.getFormattedValue(ALIAS.ticketType) ?? null,
        statusLabel: r.getFormattedValue(ALIAS.ticketStatus) ?? null,
        score: num(r.getValue(ALIAS.score)),
        ownerName: r.getFormattedValue(ALIAS.owner) ?? null,
      };
    });
  }, [dataset?.loading, dataset?.sortedRecordIds, dataset?.records]);

  // Seed the overlay with the caller's existing endorsements so their prior
  // votes render highlighted on load.
  React.useEffect(() => {
    let cancelled = false;
    if (baseRows.length === 0) {
      setOverrides({});
      return;
    }
    const userId = bareGuid(userSettings.userId);
    void (async () => {
      try {
        const resp = await webAPI.retrieveMultipleRecords(
          ENDORSEMENT_ENTITY,
          `?$select=book_value,_book_ticket_value&$filter=_book_endorser_value eq ${userId}`
        );
        if (cancelled) return;
        const mine = new Map<string, number>();
        for (const e of resp.entities) {
          const tid = bareGuid(String(e._book_ticket_value ?? ""));
          if (tid) mine.set(tid, num(e.book_value));
        }
        const next: Record<string, { score: number; myVote: number }> = {};
        for (const b of baseRows) {
          next[b.id] = { score: b.score, myVote: mine.get(bareGuid(b.id)) ?? 0 };
        }
        setOverrides(next);
      } catch (e) {
        if (!cancelled)
          setError(`Could not load your votes: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseRows, userSettings.userId, webAPI]);

  const typeOptions = React.useMemo(() => {
    const seen = new Map<number, string>();
    for (const b of baseRows) {
      if (b.ticketTypeValue != null && !seen.has(b.ticketTypeValue)) {
        seen.set(b.ticketTypeValue, b.ticketTypeLabel ?? String(b.ticketTypeValue));
      }
    }
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [baseRows]);

  const rows = React.useMemo(() => {
    return baseRows
      .filter((b) => typeFilter === "all" || b.ticketTypeValue === typeFilter)
      .map((b) => {
        const o = overrides[b.id];
        return { ...b, score: o?.score ?? b.score, myVote: o?.myVote ?? 0 };
      });
  }, [baseRows, overrides, typeFilter]);

  const castVote = React.useCallback(
    async (ticketId: string, direction: 1 | -1) => {
      const xrm = getXrm();
      if (!xrm) {
        setError("Voting is only available inside the model-driven app.");
        return;
      }
      setError(null);
      setBusyIds((prev) => new Set(prev).add(ticketId));
      try {
        const request = {
          TicketId: bareGuid(ticketId),
          Direction: direction,
          getMetadata: () => ({
            boundParameter: null,
            parameterTypes: {
              TicketId: { typeName: "Edm.String", structuralProperty: 1 },
              Direction: { typeName: "Edm.Int32", structuralProperty: 1 },
            },
            operationType: 0, // 0 = Action
            operationName: CAST_VOTE_API,
          }),
        };
        const resp = await xrm.WebApi.online.execute(request);
        const body = await resp.json();
        setOverrides((prev) => ({
          ...prev,
          [ticketId]: { score: num(body.NewScore), myVote: num(body.UserVote) },
        }));
      } catch (e) {
        setError(`Vote failed: ${(e as Error).message}`);
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(ticketId);
          return next;
        });
      }
    },
    []
  );

  const openTicket = React.useCallback(
    (ticketId: string) => {
      void navigation.openForm({
        entityName: TICKET_ENTITY,
        entityId: bareGuid(ticketId),
        openInNewWindow: false,
      });
    },
    [navigation]
  );

  return (
    <FluentProvider theme={webLightTheme}>
      <div className={styles.root} style={{ width: props.width || undefined }}>
        <div className={styles.toolbar}>
          <Text className={styles.title}>Ticket Board</Text>
          <Combobox
            aria-label="Filter by ticket type"
            placeholder="All types"
            value={
              typeFilter === "all"
                ? "All types"
                : typeOptions.find((o) => o.value === typeFilter)?.label ?? ""
            }
            selectedOptions={[typeFilter === "all" ? "all" : String(typeFilter)]}
            onOptionSelect={(_, data) => {
              const v = data.optionValue;
              setTypeFilter(v === "all" || v == null ? "all" : Number(v));
            }}
          >
            <Option value="all">All types</Option>
            {typeOptions.map((o) => (
              <Option key={o.value} value={String(o.value)}>
                {o.label}
              </Option>
            ))}
          </Combobox>
        </div>

        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}

        {dataset?.loading ? (
          <Spinner label="Loading tickets…" />
        ) : rows.length === 0 ? (
          <div className={styles.empty}>No tickets to show.</div>
        ) : (
          <div className={styles.list}>
            {rows.map((row) => {
              const busy = busyIds.has(row.id);
              return (
                <div key={row.id} className={styles.row}>
                  <div className={styles.voteBox}>
                    <Tooltip content="Upvote" relationship="label">
                      <Button
                        appearance="subtle"
                        className={`${styles.arrow} ${
                          row.myVote === 1 ? styles.arrowActiveUp : ""
                        }`}
                        disabled={isDisabled || busy}
                        onClick={() => void castVote(row.id, 1)}
                      >
                        ▲
                      </Button>
                    </Tooltip>
                    <span className={styles.score}>
                      {busy ? <Spinner size="tiny" /> : row.score}
                    </span>
                    <Tooltip content="Downvote" relationship="label">
                      <Button
                        appearance="subtle"
                        className={`${styles.arrow} ${
                          row.myVote === -1 ? styles.arrowActiveDown : ""
                        }`}
                        disabled={isDisabled || busy}
                        onClick={() => void castVote(row.id, -1)}
                      >
                        ▼
                      </Button>
                    </Tooltip>
                  </div>

                  <div className={styles.body}>
                    <Link as="button" onClick={() => openTicket(row.id)}>
                      {row.name}
                    </Link>
                    <div className={styles.meta}>
                      {row.ticketTypeLabel && (
                        <Badge appearance="tint" color="brand">
                          {row.ticketTypeLabel}
                        </Badge>
                      )}
                      {row.statusLabel && (
                        <Badge appearance="outline">{row.statusLabel}</Badge>
                      )}
                      {row.ownerName && (
                        <span className={styles.metaText}>by {row.ownerName}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FluentProvider>
  );
};
