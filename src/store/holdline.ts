import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  appendHuman,
  approveSession,
  createSession,
  fastForward,
  rejectSession,
  replyToHuman,
  tick,
} from "@/lib/incident/engine";
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
  startIncident: (alert: string) => void;
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
  return [next, ...sessions.filter((s) => s.id !== next.id)].slice(0, MAX_SESSIONS);
}

function activeOf(state: { sessions: IncidentSession[]; activeId: string | null }) {
  return state.sessions.find((s) => s.id === state.activeId) ?? null;
}

export const useHoldline = create<HoldlineStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeId: null,
      hydrated: false,
      connection: DEFAULT_HOLDLINE_CONNECTION,
      setHydrated: () => set({ hydrated: true }),
      startIncident: (alert) => {
        const trimmed = alert.trim();
        if (!trimmed) return;
        const session = createSession(trimmed);
        set((state) => ({
          sessions: swap(state.sessions, session),
          activeId: session.id,
        }));
      },
      resume: (id) => set({ activeId: id }),
      leaveDesk: () => set({ activeId: null }),
      tickActive: () => {
        const cur = activeOf(get());
        if (!cur) return;
        if (cur.status !== "running" && cur.status !== "executing") return;
        const next = tick(cur);
        set((state) => ({ sessions: swap(state.sessions, next) }));
      },
      fastForwardActive: () => {
        const cur = activeOf(get());
        if (!cur || cur.status !== "running") return;
        const next = fastForward(cur);
        set((state) => ({ sessions: swap(state.sessions, next) }));
      },
      approve: (via = "approve") => {
        const cur = activeOf(get());
        if (!cur) return;
        const next = approveSession(cur, via);
        set((state) => ({ sessions: swap(state.sessions, next) }));
      },
      reject: () => {
        const cur = activeOf(get());
        if (!cur) return;
        const next = rejectSession(cur);
        set((state) => ({ sessions: swap(state.sessions, next) }));
      },
      sendHuman: (text) => {
        const cur = activeOf(get());
        if (!cur) return;
        const trimmed = text.trim();
        if (!trimmed) return;
        let next = appendHuman(cur, trimmed);
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
        set((state) => ({ sessions: swap(state.sessions, next) }));
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
  return state.sessions.find((s) => s.id === state.activeId) ?? null;
}
