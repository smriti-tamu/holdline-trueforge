import { uid } from "@/lib/utils";
import { getPlaybook, type Playbook } from "./playbooks";
import type { IncidentSession, ScriptStep, TimelineEvent } from "./types";

const cache = new Map<string, Playbook>();

export function playbookFor(session: IncidentSession): Playbook {
  const key = `${session.playbookId}::${session.alert}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pb = getPlaybook(session.alert);
  cache.set(key, pb);
  return pb;
}

export function createSession(alert: string): IncidentSession {
  const pb = getPlaybook(alert.trim());
  cache.set(`${pb.id}::${alert.trim()}`, pb);
  const now = Date.now();
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    alert: alert.trim(),
    playbookId: pb.id,
    title: pb.title,
    stage: 1,
    status: "running",
    writeLock: "engaged",
    extracted: pb.extracted,
    events: [],
    playhead: 0,
    execHead: 0,
  };
}

function applyStep(session: IncidentSession, step: ScriptStep): IncidentSession {
  const event: TimelineEvent = {
    id: uid(),
    ts: Date.now(),
    kind: step.kind,
    stage: step.stage ?? session.stage,
    title: step.title,
    body: step.body,
    tool: step.tool,
    subagent: step.subagent,
    bucket: step.bucket,
    status: step.status,
  };
  const next: IncidentSession = {
    ...session,
    events: [...session.events, event],
    updatedAt: Date.now(),
    stage: step.patch?.stage ?? session.stage,
    status: step.patch?.status ?? session.status,
    writeLock: step.patch?.writeLock ?? session.writeLock,
    diagnosis: step.patch?.diagnosis ?? session.diagnosis,
    proposal: step.patch?.proposal ?? session.proposal,
    extracted: step.patch?.extracted ?? session.extracted,
  };
  return next;
}

export function currentDelay(session: IncidentSession): number {
  const pb = playbookFor(session);
  if (session.status === "running") {
    const step = pb.investigate[session.playhead];
    return step?.delayMs ?? 0;
  }
  if (session.status === "executing") {
    const step = pb.execute[session.execHead];
    return step?.delayMs ?? 0;
  }
  return 0;
}

export function tick(session: IncidentSession): IncidentSession {
  const pb = playbookFor(session);
  if (session.status === "running") {
    const step = pb.investigate[session.playhead];
    if (!step) {
      return { ...session, status: "waiting", stage: 5, updatedAt: Date.now() };
    }
    const next = applyStep(session, step);
    return { ...next, playhead: session.playhead + 1 };
  }
  if (session.status === "executing") {
    if (session.writeLock !== "released") {
      return {
        ...session,
        events: [
          ...session.events,
          {
            id: uid(),
            ts: Date.now(),
            kind: "system",
            stage: 5,
            title: "Write lock blocked the action",
            body: "Harness refused to run a mutating tool without explicit human approval.",
            status: "blocked",
          },
        ],
        updatedAt: Date.now(),
        status: "waiting",
      };
    }
    const step = pb.execute[session.execHead];
    if (!step) {
      return { ...session, status: "closed", updatedAt: Date.now() };
    }
    const next = applyStep(session, step);
    return { ...next, execHead: session.execHead + 1 };
  }
  return session;
}

export function fastForward(session: IncidentSession): IncidentSession {
  let cur = session;
  let guard = 0;
  while (cur.status === "running" && guard < 80) {
    cur = tick(cur);
    guard += 1;
  }
  return cur;
}

export function approveSession(session: IncidentSession, via: string): IncidentSession {
  if (session.status !== "waiting" && session.status !== "rejected") return session;
  const event: TimelineEvent = {
    id: uid(),
    ts: Date.now(),
    kind: "approval",
    stage: 5,
    title: `Approved (${via})`,
    body: "Human approved the proposed action. Harness will execute the remediation plan.",
    status: "ok",
  };
  return {
    ...session,
    status: "executing",
    writeLock: "released",
    approvedAt: Date.now(),
    approvedVia: via,
    events: [...session.events, event],
    updatedAt: Date.now(),
  };
}

export function rejectSession(session: IncidentSession): IncidentSession {
  if (session.status !== "waiting" && session.status !== "running") return session;
  const event: TimelineEvent = {
    id: uid(),
    ts: Date.now(),
    kind: "system",
    stage: 5,
    title: "Held by human",
    body: "No production change will run. Write lock remains engaged. Session stays available.",
    status: "blocked",
  };
  return {
    ...session,
    status: "rejected",
    writeLock: "engaged",
    events: [...session.events, event],
    updatedAt: Date.now(),
  };
}

export function appendHuman(session: IncidentSession, text: string): IncidentSession {
  const event: TimelineEvent = {
    id: uid(),
    ts: Date.now(),
    kind: "human",
    stage: session.stage,
    title: "On-call",
    body: text,
  };
  return {
    ...session,
    events: [...session.events, event],
    updatedAt: Date.now(),
  };
}

export function replyToHuman(session: IncidentSession, text: string): IncidentSession {
  const waiting = session.status === "waiting";
  const body = waiting
    ? `Stage 5 – Waiting for Approval\n\nI heard you, but I will not execute until you reply with “approve”, “yes”, or “go”.\n\nWrite lock: engaged.\n${text ? `On your note: I can clarify, but the proposed action is unchanged.` : ""}`
    : session.status === "running"
      ? `Stage ${session.stage} – ${session.stage === 2 ? "Investigate" : session.stage === 1 ? "Alert Reception" : "in progress"}\n\nStill gathering evidence. I will not diagnose early and I will not touch production.`
      : session.status === "executing"
        ? "Stage 5 – Approve → Act\n\nExecution is in progress. I will confirm when it finishes."
        : session.status === "closed"
          ? "This incident is closed. Resume it only if you need the record, or open a new alert."
          : "Stage 5 – Held.\n\nWrite lock is still engaged. Reply approve if you want the proposed plan to run.";

  const event: TimelineEvent = {
    id: uid(),
    ts: Date.now(),
    kind: "agent",
    stage: session.stage,
    title: "Agent",
    body: body.trim(),
  };
  return {
    ...session,
    events: [...session.events, event],
    updatedAt: Date.now(),
  };
}
