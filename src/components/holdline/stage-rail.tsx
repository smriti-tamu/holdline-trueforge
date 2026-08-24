import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGE_LABELS, type IncidentSession, type StageId } from "@/lib/incident/types";

const STAGES: StageId[] = [1, 2, 3, 4, 5];

export function StageRail({ session }: { session: IncidentSession }) {
  return (
    <ol className="grid grid-cols-5 gap-1 sm:gap-2">
      {STAGES.map((id) => {
        const done = session.stage > id || session.status === "closed";
        const current = session.stage === id && session.status !== "closed";
        const waiting = current && session.status === "waiting" && id === 5;
        return (
          <li
            key={id}
            className={cn(
              "flex min-w-0 flex-col gap-1 rounded-md px-1.5 py-2 sm:px-2.5",
              current ? "bg-subtle" : "bg-transparent",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                  done && "bg-fg text-bg",
                  current && !done && "bg-fg/15 text-fg",
                  !current && !done && "bg-subtle text-faint",
                  waiting && "bg-warn/20 text-warn",
                )}
              >
                {done ? <Check className="size-3" strokeWidth={2.5} /> : id}
              </span>
              <span
                className={cn(
                  "hidden truncate text-[11px] tracking-wide uppercase sm:block",
                  current ? "text-fg" : "text-faint",
                )}
              >
                {STAGE_LABELS[id]}
              </span>
            </div>
            <span className="truncate text-[10px] text-faint sm:hidden">
              {id === 5 ? "Gate" : STAGE_LABELS[id].split(" ")[0]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
