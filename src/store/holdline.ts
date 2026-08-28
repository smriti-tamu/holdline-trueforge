import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { appendHuman, approveSession, beginInvestigation, createSession, failInvestigation, finishInvestigation, recordToolResult, rejectSession, replyToHuman } from "@/lib/incident/engine";
import { runLiveIncidentInvestigation } from "@/lib/mcp-connection";
import { DEFAULT_HOLDLINE_CONNECTION, type HoldlineConnectionConfig } from "@/lib/holdline-connection";
import { isApprovePhrase, isRejectPhrase } from "@/lib/utils";
import type { IncidentSession, TimelineEvent } from "@/lib/incident/types";

const MAX_SESSIONS = 16;
const HOLDLINE_PERSIST_VERSION = 2;

type HoldlineStore = {
  sessions: IncidentSession[];
  activeId: string | null;
  hydrated: boolean;
  connection: HoldlineConnectionConfig;
  setHydrated: () => void;
  startIncident: (alert: string) => Promise<void>;
  resume: (id: string) => void;
  leaveDesk: () => void;
  tickActive: () => void;
  fastForwardActive: () => void;
  approve: (via?: string) => void;
  reject: () => void;
  sendHuman: (text: string) => void;
  updateConnection: (patch: Partial<HoldlineConnectionConfig>) => void;
  resetConnection: () => void;
};

export function statusTone(status: IncidentSession["status"]) {
  if (status === "waiting") return "warn" as const;
  if (status === "parked") return "warn" as const;
  if (status === "closed") return "ok" as const;
  if (status === "rejected") return "danger" as const;
  if (status === "failed") return "danger" as const;
  return "fg" as const;
}

export function statusLabel(status: IncidentSession["status"]) {
  if (status === "running") return "Investigating";
  if (status === "waiting") return "Awaiting approval";
  if (status === "executing") return "Acting";
  if (status === "parked") return "Parked for evidence";
  if (status === "closed") return "Closed";
  if (status === "failed") return "Investigation failed";
  if (status === "rejected") return "Held";
  return "Held";
}

function swap(sessions: IncidentSession[], next: IncidentSession) {
  return [next, ...sessions.filter((session) => session.id !== next.id)].slice(0, MAX_SESSIONS);
}

function findSession(state: HoldlineStore, id: string) {
  return state.sessions.find((session) => session.id === id) ?? null;
}

function activeOf(state: Pick<HoldlineStore, "sessions" | "activeId">) {
  return state.sessions.find((session) => session.id === state.activeId) ?? null;
}

function migrateSession(session: Partial<IncidentSession> & { status?: string }): IncidentSession {
  const initialStatus = session.status ?? "waiting";
  const status = initialStatus === "running" || initialStatus === "executing" ? "parked" : (initialStatus as IncidentSession["status"]);
  const legacy = initialStatus === "running" || initialStatus === "executing";
  const events = Array.isArray(session.events) ? [...session.events] : [];

  const migrated: IncidentSession = {
    id: typeof session.id === "string" ? session.id : crypto.randomUUID(),
    createdAt: typeof session.createdAt === "number" ? session.createdAt : Date.now(),
    updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : Date.now(),
    alert: typeof session.alert === "string" ? session.alert : "",
    title: typeof session.title === "string" ? session.title : "Holdline incident",
    stage: typeof session.stage === "number" ? (session.stage as IncidentSession["stage"]) : 1,
    status,
    writeLock: session.writeLock === "released" ? "released" : "engaged",
    extracted:
      session.extracted && typeof session.extracted === "object"
        ? (session.extracted as IncidentSession["extracted"])
        : { service: "production", severity: "SEV-2", region: "unknown", timestamp: "unspecified", extra: {} },
    investigation: session.investigation,
    diagnosis: session.diagnosis,
    proposal: session.proposal,
    events,
    approvedAt: session.approvedAt,
    approvedVia: session.approvedVia,
    errorMessage: session.errorMessage,
  };

  if (legacy) {
    migrated.status = "parked";
    migrated.writeLock = "engaged";
    migrated.events.push({
      id: crypto.randomUUID(),
      ts: Date.now(),
      kind: "system",
      stage: migrated.stage,
      title: "Legacy scripted session reset",
      body: "This older scripted session was paused and must be restarted as a live investigation. The write lock remains engaged until the live investigation is rerun.",
      status: "blocked",
    } satisfies TimelineEvent);
  }

  return migrated;
}

export function migrateHoldlinePersisted(state: unknown) {
  const source = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  const persistedConnection =
    source.connection && typeof source.connection === "object" ? (source.connection as Partial<HoldlineConnectionConfig>) : {};
  const sessions = Array.isArray(source.sessions)
    ? source.sessions.map((item) => migrateSession(item as Partial<IncidentSession>))
    : [];
  const activeId = typeof source.activeId === "string" && sessions.some((session) => session.id === source.activeId)
    ? source.activeId
    : null;

  return {
    sessions,
    activeId,
    connection: {
      ...DEFAULT_HOLDLINE_CONNECTION,
      ...persistedConnection,
    },
  };
}

export const useHoldline = create<HoldlineStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeId: null,
      hydrated: false,
      connection: DEFAULT_HOLDLINE_CONNECTION,

      setHydrated: () => set({ hydrated: true }),

      startIncident: async (alert) => {
        const trimmed = alert.trim();
        if (!trimmed) return;

        const session = createSession(trimmed);

        set((state) => ({
          sessions: swap(state.sessions, session),
          activeId: session.id,
        }));

        const investigating = beginInvestigation(session);

        set((state) => ({
          sessions: swap(state.sessions, investigating),
        }));

        try {
          const result = await runLiveIncidentInvestigation({
            data: { alertId: trimmed },
          });

          const current = findSession(get(), session.id);
          if (!current) return;

          if (!result.ok) {
            const failed = failInvestigation(
              current,
              result.errorMessage ?? "The local MCP bridge did not return an investigation result.",
            );
            set((state) => ({ sessions: swap(state.sessions, failed) }));
            return;
          }

          let completed = current;
          for (const toolResult of result.tools) {
            completed = recordToolResult(completed, toolResult);
          }
          completed = finishInvestigation(completed);

          set((state) => ({
            sessions: swap(state.sessions, completed),
          }));
        } catch (error) {
          const current = findSession(get(), session.id);
          if (!current) return;

          const failed = failInvestigation(
            current,
            error instanceof Error ? error.message : String(error),
          );

          set((state) => ({
            sessions: swap(state.sessions, failed),
          }));
        }
      },

      resume: (id) => set({ activeId: id }),

      leaveDesk: () => set({ activeId: null }),

      tickActive: () => {
        // The old scripted timer is intentionally disabled.
      },

      fastForwardActive: () => {
        // Live MCP evidence must not be skipped or fabricated.
      },

      approve: (via = "approve") => {
        const current = activeOf(get());
        if (!current) return;

        const next = approveSession(current, via);
        set((state) => ({
          sessions: swap(state.sessions, next),
        }));
      },

      reject: () => {
        const current = activeOf(get());
        if (!current) return;

        const next = rejectSession(current);
        set((state) => ({
          sessions: swap(state.sessions, next),
        }));
      },

      sendHuman: (text) => {
        const current = activeOf(get());
        const trimmed = text.trim();
        if (!current || !trimmed) return;

        let next = appendHuman(current, trimmed);

        if (
          (next.status === "waiting" || next.status === "rejected") &&
          isApprovePhrase(trimmed)
        ) {
          next = approveSession(next, trimmed.split(/\s+/)[0] ?? "approve");
        } else if (next.status === "waiting" && isRejectPhrase(trimmed)) {
          next = rejectSession(next);
        } else {
          next = replyToHuman(next, trimmed);
        }

        set((state) => ({
          sessions: swap(state.sessions, next),
        }));
      },

      updateConnection: (patch) => {
        set((state) => ({
          connection: {
            ...state.connection,
            ...patch,
          },
        }));
      },

      resetConnection: () => set({ connection: DEFAULT_HOLDLINE_CONNECTION }),
    }),
    {
      name: "holdline-sessions-v1",
      version: HOLDLINE_PERSIST_VERSION,
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return localStorage;
      }),
      partialize: (state) => ({
        sessions: state.sessions,
        activeId: state.activeId,
        connection: state.connection,
      }),
      migrate: (persisted, version) => {
        const base = (persisted && typeof persisted === "object" ? persisted : {}) as Record<string, unknown>;
        if (version === 0) {
          const migrated = migrateHoldlinePersisted(persisted);
          return {
            ...base,
            sessions: migrated.sessions,
            activeId: migrated.activeId,
            connection: migrated.connection,
          };
        }

        const migrated = migrateHoldlinePersisted(persisted);
        return {
          ...base,
          sessions: migrated.sessions,
          activeId: migrated.activeId,
          connection: migrated.connection,
        };
      },
      skipHydration: true,
    },
  ),
);

export function selectActive(state: HoldlineStore) {
  return state.sessions.find((session) => session.id === state.activeId) ?? null;
}