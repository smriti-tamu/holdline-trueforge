import { cn } from "@/lib/utils";

export function HoldlineMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="6" className="fill-elevated" />
      <rect x="15" y="5" width="2" height="9" className="fill-fg" />
      <rect x="8" y="15" width="16" height="2" className="fill-accent" />
      <rect x="15" y="18" width="2" height="9" className="fill-fg" />
    </svg>
  );
}
