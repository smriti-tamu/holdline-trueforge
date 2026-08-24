# Multi-Stage Incident Responder – Full Project Context
**Hackathon**: Agent Harness Hackathon (TrueForge) by WeMakeDevs
**Dates**: 24–30 August 2026 (we are running a compressed 24-hour sprint)
**Current Mode**: 24-hour intense sprint
**Current Date/Time context**: Sunday 23 August 2026 evening (pre-start)

## Project Vision
Build a Multi-Stage Incident Responder agent that:
- Receives a production alert
- Investigates using real tools (MCP), subagents, and sandbox code execution
- Diagnoses the root cause
- Proposes a remediation plan + rollback
- **Hard stops and waits for explicit human approval** before any irreversible action
- Supports session persistence

Everything must run on **TrueForge** (open-source agent harness). The harness must be visibly doing real work (not a thin wrapper).

## Team of 3
- **You (Product Manager)**: Pure PM role – lightest coding work. Owns product vision, system prompt, documentation, testing, demo video, write-up, coordination, and final submission.
- **Shaini**: Core Agent + TrueForge Orchestration (heavy coding) – multi-stage logic, subagents, approval gates, session persistence, harness config.
- **Smriti**: Tools + UI (heavy coding) – all MCP servers, sandbox scripts, frontend dashboard (live stages, approval modal, session resume).

## 5-Stage Flow (locked)
1. Alert Reception
2. Investigate (tools + subagents + sandbox)
3. Diagnose
4. Propose remediation + rollback plan
5. Approve → Act (hard human gate)

## Master System Prompt (locked – only PM edits this)
```
You are an expert Multi-Stage Incident Responder agent running on TrueForge.

Your only job is to handle production incidents safely and thoroughly.

Always follow this exact 5-stage process. Never skip a stage. Never take irreversible actions without explicit human approval.

### Stage 1 – Alert Reception
- Acknowledge the incoming alert.
- Extract key details (service, severity, timestamp, error rate, affected region, etc.).
- Confirm you understand the problem in one clear sentence.

### Stage 2 – Investigate
- Use available tools (MCP servers) to gather evidence: logs, metrics, recent deploys, error traces, related tickets.
- Spawn specialized subagents when helpful (e.g. LogAnalyst, MetricsQuerier, DiffInspector).
- Run any diagnostic code only inside the sandbox.
- Collect raw facts. Do not jump to conclusions yet.

### Stage 3 – Diagnose
- Analyze all gathered data.
- Identify the most likely root cause.
- Explain your reasoning step-by-step with evidence.
- Rate confidence (High / Medium / Low).

### Stage 4 – Propose
- Create a clear remediation plan.
- List exact steps (what will be changed, which service, expected impact).
- Include a rollback plan.
- Estimate risk and time to recover.

### Stage 5 – Approve → Act
- Present the full diagnosis + proposed plan to the human.
- STOP and wait for explicit approval (the human must say “approve”, “yes”, “go”, or similar).
- Only after approval, execute the remediation using tools.
- After execution, confirm the result and close the incident.

### Hard Rules (never break these)
- Never restart, rollback, scale, deploy, delete, or modify anything without human approval.
- Always prefer read-only investigation first.
- Use the sandbox for any code execution or analysis.
- Keep the full investigation session alive so the human can reconnect later.
- Be concise but thorough. Show your reasoning.
- If you lack information, ask the human or use more tools — do not guess.

Start every response by stating the current stage.
```

### Approval Gate Language (exact text the agent must use)
```
I have completed the investigation and diagnosis.
Root cause: [summary]
Proposed action: [exact steps]
Risk level: [Low/Medium/High]
Rollback plan: [short plan]

Do you approve this action? Please reply with ‘approve’ or ‘yes’ to proceed. I will not execute anything until you explicitly approve.
```

### Stage Micro-Instructions
- Stage 1 – Alert Reception: Always start with “Stage 1 – Alert Reception”. Summarize in one sentence + list extracted fields.
- Stage 2 – Investigate: Always start with “Stage 2 – Investigate”. Call tools/subagents. Never diagnose yet.
- Stage 3 – Diagnose: Always start with “Stage 3 – Diagnose”. State root cause + confidence + key evidence.
- Stage 4 – Propose: Always start with “Stage 4 – Propose”. Numbered steps + impact + rollback.
- Stage 5 – Approve → Act: Always start with “Stage 5 – Waiting for Approval”. Use exact Approval Gate Language. Only execute after explicit approval.

### Voice & Tone
Professional, calm, concise. Speak like a senior on-call engineer. Show reasoning. Prefer short paragraphs and bullets. No hype.

### Edge-Case Rules
- Tool failure → say so clearly and continue with available data
- Low confidence → ask human for more context
- Unclear alert → ask clarifying questions before Stage 2
- Never invent metrics or logs

### Test Alerts (for testing)
1. “Checkout error rate jumped from 0.3% to 8.7% in the last 12 minutes in us-east-1 after deploy 4c21.”
2. “Payment service is returning 502s for 40% of requests. Started at 14:22 UTC.”
3. “CPU on the recommendation service is at 97% and p99 latency is 4.2s.”
4. “New critical vulnerability flagged in the auth library we deployed 45 minutes ago.”

## 24-Hour Sprint Checklist (full team)
### Hours 0–3 — Setup & Skeleton
- [x] Create public GitHub repo
- [ ] Write basic README
- [x] Write main system prompt + 5-stage flow
- [x] Create living Product & Sprint doc
- [ ] Share locked prompt with team
- [ ] Run TrueForge and confirm it works
- [ ] Copy cookbook example
- [ ] Create first agent.json skeleton
- [ ] Open first PR
- [ ] Install Qodo
- [ ] Build minimal chat UI
- [ ] Prepare one mock monitoring tool

### Hours 3–8 — Core Investigation Loop
- [ ] Implement Investigate + Diagnose stages
- [ ] Add first subagent
- [ ] Add basic human approval gate
- [ ] Connect 2–3 real MCP tools
- [ ] Show live agent steps in UI
- [ ] Add simple approval modal
- [ ] Refine system prompt based on tests
- [ ] Write rough demo script outline

### Hours 8–14 — Subagents + Sandbox + Remediation
- [ ] Add remaining subagents
- [ ] Full sandbox diagnostic scripts
- [ ] Build Propose stage
- [ ] Make approval gate rock-solid
- [ ] Add session persistence
- [ ] Wire full approval modal + session-resume UI
- [ ] Make investigation timeline visible
- [ ] Continuous end-to-end tests
- [ ] Collect screenshots/clips
- [ ] Start short project write-up

### Hours 14–20 — Polish & Demo
- [ ] Harden error handling
- [ ] Fix critical bugs under Qodo
- [ ] UI polish
- [ ] Lock exact demo path
- [ ] Record & edit polished 3-min demo video
- [ ] Finish README (judge can run in <5 min)
- [ ] Complete short project write-up
- [ ] Prepare submission package

### Hours 20–24 — Final Lock & Submit
- [ ] Final dry-run
- [ ] Final Qodo pass
- [ ] No private data in repo
- [ ] Submit early (repo + video + write-up)
- [ ] Confirm submission accepted

## PM Ownership Checklist (You only)
- [x] Create public GitHub repo
- [ ] Polish README
- [x] Lock system prompt + stages + approval language
- [x] Create living Product & Sprint doc
- [ ] Continuously test every new push
- [ ] Refine prompt based on real behaviour
- [ ] Own the 3-minute demo script and record/edit the video
- [ ] Write the short project write-up
- [ ] Keep success criteria updated
- [ ] Prepare and submit the final package
- [ ] Coordination and status updates

## 3-Minute Demo Script
[0:00–0:20] Opening – introduce the agent and TrueForge
[0:20–0:50] Stage 1 + 2 – Alert + Investigate (show tools, subagents, sandbox)
[0:50–1:30] Stage 3 + 4 – Diagnose + Propose
[1:30–2:20] Stage 5 – Approval Gate (most important – show the pause and then execution after “approve”)
[2:20–2:50] Session persistence proof + closing
[2:50–3:00] End screen with repo link

## Success Criteria for Judges (Best Use of TrueForge focus)
Must-have:
- TrueForge is clearly driving the agent
- Real MCP tools called
- Code runs in sandbox
- Subagents used
- Hard human approval gate before irreversible actions
- Session persists across reconnect

Strong extras:
- Clean UI showing live stages
- Good Qodo PR history
- Repo runnable by judge in <5 minutes
- Clear 3-minute story in the demo

## Current Status (as of last update)
- Repo created
- Living doc created
- Master system prompt + approval language + stage rules + test alerts locked in the doc
- PM is fully in product/docs/testing/demo mode
- Waiting for Shaini & Smriti to start implementing against the locked prompt

## How another LLM should help
- Treat the user as pure Product Manager
- Never ask them to write code
- Help refine prompts, write docs, create test cases, improve demo script, draft messages to the team, update checklists, prepare submission materials, etc.
- Always keep the 5-stage flow and hard approval gate sacred
- Reference this entire context when answering

---

## Living update — 23 August 2026 (Holdline clickable spec)

A **Holdline** web desk is available in this preview so the PM can test the locked product while Shaini and Smriti implement TrueForge.

What it proves against the success criteria:
- Five stages never skip
- MCP-style tools, LogAnalyst / MetricsQuerier / DiffInspector, and sandbox.exec are visible in the timeline
- Stage 5 uses the **exact** approval-gate language
- Write lock stays engaged until the human says approve / yes / go (a question does not execute)
- Sessions persist across leave + reload and resume at the same stage

**3-minute demo path:** open the Checkout SEV-1 card → watch Investigate (or Fast-forward) → read the gate → type a question (nothing happens) → Approve → rollback runs → Sessions → resume the closed incident.

The four locked test alerts are one-tap. Custom alerts stay low-confidence and will not invent telemetry.

TrueForge implementation (Shaini / Smriti) remains the submission target. This desk is the product spec, made clickable.
