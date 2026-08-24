import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HarnessRunner } from "@/components/holdline/harness-runner";
import { HomeDesk } from "@/components/holdline/home-desk";
import { IncidentDesk } from "@/components/holdline/incident-desk";
import { selectActive, useHoldline } from "@/store/holdline";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const hydrated = useHoldline((s) => s.hydrated);
  const setHydrated = useHoldline((s) => s.setHydrated);
  const sessions = useHoldline((s) => s.sessions);
  const active = useHoldline(selectActive);
  const startIncident = useHoldline((s) => s.startIncident);
  const resume = useHoldline((s) => s.resume);
  const leaveDesk = useHoldline((s) => s.leaveDesk);
  const approve = useHoldline((s) => s.approve);
  const reject = useHoldline((s) => s.reject);
  const sendHuman = useHoldline((s) => s.sendHuman);
  const fastForwardActive = useHoldline((s) => s.fastForwardActive);

  useEffect(() => {
    const result = useHoldline.persist.rehydrate();
    void Promise.resolve(result).then(() => setHydrated());
  }, [setHydrated]);

  if (!hydrated) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-sm text-muted">
        Restoring sessions…
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <HarnessRunner />
      {active ? (
        <IncidentDesk
          session={active}
          onLeave={leaveDesk}
          onApprove={() => approve("approve")}
          onReject={reject}
          onSend={sendHuman}
          onFastForward={fastForwardActive}
        />
      ) : (
        <HomeDesk sessions={sessions} onStart={startIncident} onResume={resume} />
      )}
    </main>
  );
}
