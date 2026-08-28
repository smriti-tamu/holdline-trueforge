import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  appendHuman,
  approveSession,
  beginInvestigation,
  createSession,
  failInvestigation,
  finishInvestigation,
  recordToolResult,
  rejectSession,
  replyToHuman,
} from "@/lib/incident/engine";
import {
  runLiveIncidentInvestigation,
} from "@/lib/mcp-connection";
import {
  DEFAULT_HOLDLINE_CONNECTION,
  type HoldlineConnectionConfig,
} from "@/lib/holdline-connection";
import { isApprovePhrase, isRejectPhrase } from "@/lib/utils";
import type { IncidentSession } from "@/lib/incident/types";

const MAX_SESSIONS = 16;

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

function swap(sessions: IncidentSession[], next: IncidentSession) {
  return [next, ...sessions.filter((session) => session.id !== next.id)].slice(0, MAX_SESSIONS);
}

function findSession(state: HoldlineStore, id: string) {
  return state.sessions.find((session) => session.id === id) ?? null;
}

function activeOf(state: Pick<HoldlineStore, "sessions" | "activeId">) {
  return state.sessions.find((session) => session.id === state.activeId) ?? null;
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
          const connection = get().connection;
          const result = await runLiveIncidentInvestigation({
            data: {
              url: connection.mcpUrl,
              alertId: trimmed,
            },
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
      skipHydration: true,
    },
  ),
);

export function selectActive(state: HoldlineStore) {
  return state.sessions.find((session) => session.id === state.activeId) ?? null;
}