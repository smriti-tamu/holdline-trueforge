import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { IncidentSession } from "@/lib/incident/types";

export function Composer({
  session,
  onSend,
}: {
  session: IncidentSession;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  const locked = session.status === "executing";
  const placeholder =
    session.status === "waiting"
      ? "Type approve, yes, go — or ask a question"
      : session.status === "parked"
        ? "Add new evidence or a note"
        : session.status === "closed"
          ? "Incident closed"
          : session.status === "rejected"
            ? "Held. Type approve to run the plan, or leave a note"
            : "Message the responder";

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim() || locked) return;
        onSend(value);
        setValue("");
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={locked || session.status === "closed"}
        aria-label="Message the incident responder"
      />
      <Button type="submit" disabled={locked || session.status === "closed" || !value.trim()}>
        Send
      </Button>
    </form>
  );
}
