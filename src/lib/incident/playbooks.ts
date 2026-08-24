import { approvalGateText } from "./prompt";
import type {
  Diagnosis,
  ExtractedFields,
  Proposal,
  ScriptStep,
  StageId,
} from "./types";

export type Playbook = {
  id: string;
  title: string;
  extracted: ExtractedFields;
  confirm: string;
  diagnosis: Diagnosis;
  proposal: Proposal;
  investigate: ScriptStep[];
  execute: ScriptStep[];
};

const D = 640;

function stage(id: StageId, extra?: string): ScriptStep {
  const names: Record<StageId, string> = {
    1: "Stage 1 – Alert Reception",
    2: "Stage 2 – Investigate",
    3: "Stage 3 – Diagnose",
    4: "Stage 4 – Propose",
    5: "Stage 5 – Waiting for Approval",
  };
  return {
    delayMs: 280,
    kind: "stage",
    stage: id,
    title: names[id],
    body: extra,
    patch: { stage: id },
  };
}

function agent(title: string, body: string, stageId: StageId, delayMs = D): ScriptStep {
  return { delayMs, kind: "agent", stage: stageId, title, body };
}

function tool(
  tool: string,
  title: string,
  result: string,
  bucket: ScriptStep["bucket"],
  stageId: StageId = 2,
): ScriptStep[] {
  return [
    {
      delayMs: 420,
      kind: "tool-call",
      stage: stageId,
      tool,
      title: `mcp.${tool}`,
      body: title,
      status: "running",
    },
    {
      delayMs: 780,
      kind: "tool-result",
      stage: stageId,
      tool,
      bucket,
      title: `${tool} · ok`,
      body: result,
      status: "ok",
    },
  ];
}

function sub(
  name: string,
  brief: string,
  result: string,
  bucket: ScriptStep["bucket"],
): ScriptStep[] {
  return [
    {
      delayMs: 360,
      kind: "subagent",
      stage: 2,
      subagent: name,
      title: `Spawn ${name}`,
      body: brief,
      status: "running",
    },
    {
      delayMs: 920,
      kind: "subagent",
      stage: 2,
      subagent: name,
      bucket,
      title: `${name} · complete`,
      body: result,
      status: "ok",
    },
  ];
}

function sandbox(cmd: string, result: string, stageId: StageId = 2): ScriptStep[] {
  return [
    {
      delayMs: 400,
      kind: "sandbox",
      stage: stageId,
      title: "sandbox.exec",
      body: cmd,
      status: "running",
    },
    {
      delayMs: 860,
      kind: "sandbox",
      stage: stageId,
      bucket: "sandbox",
      title: "sandbox · ok",
      body: result,
      status: "ok",
    },
  ];
}

function gateStep(diagnosis: Diagnosis, proposal: Proposal): ScriptStep {
  const proposedAction = proposal.steps.join(" ");
  return {
    delayMs: 400,
    kind: "gate",
    stage: 5,
    title: "Stage 5 – Waiting for Approval",
    body: approvalGateText({
      rootCause: diagnosis.rootCause,
      proposedAction,
      risk: proposal.risk,
      rollback: proposal.rollback,
    }),
    patch: { stage: 5, status: "waiting" },
  };
}

const checkoutDiagnosis: Diagnosis = {
  rootCause:
    "Deploy 4c21 cut PaymentAdapter timeout from 5s to 500ms. Payment p99 is ~812ms, so checkout calls time out and surface as errors.",
  confidence: "High",
  evidence: [
    "checkout.error_rate us-east-1: 0.3% → 8.7% starting 12 minutes ago",
    "Deploy 4c21 landed 14 minutes ago on checkout-service",
    "DiffInspector: timeoutMs 5000 → 500 in PaymentAdapter",
    "payment.latency_p99 remains 812ms; 8.4% of samples exceed 500ms",
    "Logs: PaymentAdapter timeout after 500ms, trace-correlated with 4c21",
  ],
  reasoning:
    "The error spike begins two minutes after 4c21. No payment-side deploy. The only checkout change in 4c21 that matches the failure mode is the timeout reduction. Sandbox correlation of timeout errors vs payment latency distribution confirms ~8% of calls cannot complete in 500ms.",
};

const checkoutProposal: Proposal = {
  steps: [
    "1. Rollback checkout-service to the revision immediately before deploy 4c21 (restore timeoutMs=5000).",
    "2. Hold the 4c21 artifact; do not re-promote until PaymentAdapter timeout is reviewed against payment p99.",
    "3. Watch checkout.error_rate in us-east-1 for 10 minutes (target < 0.5%).",
  ],
  impact:
    "Brief blip on in-flight checkout requests during the rollback (~30s). Timeout returns to 5s, which matches current payment latency.",
  risk: "Low",
  rollback: "Re-apply deploy 4c21 if rollback itself misbehaves; feature flag PAYMENT_TIMEOUT_MS can pin 5000 without a full rollback.",
  recoverEta: "3–6 minutes after approval",
};

const paymentDiagnosis: Diagnosis = {
  rootCause:
    "redis-cluster-2 is under memory pressure (evictions, CPU 91%). Payment workers lose the session store and return 502s. No payment deploy in the window.",
  confidence: "High",
  evidence: [
    "payment.5xx started 14:22 UTC, currently 40% of requests",
    "No payment-service deploy in the last 6 hours",
    "Logs: upstream connection reset to redis-cluster-2",
    "MetricsQuerier: redis-cluster-2 memory 97%, evictions 12k/min, CPU 91%",
    "Ticket INC-4412 opened 14:18 UTC — redis memory pressure",
  ],
  reasoning:
    "502s coincide with redis-cluster-2 saturation, not with a payment code change. Connection resets in payment logs name that cluster. INC-4412 predates the alert by four minutes.",
};

const paymentProposal: Proposal = {
  steps: [
    "1. Fail over payment session store from redis-cluster-2 to redis-cluster-1 (healthy).",
    "2. Scale redis-cluster-2 memory class +1 and flush hot keys after failover.",
    "3. Drain 502s; confirm payment success rate ≥ 99.5% for 10 minutes.",
  ],
  impact:
    "In-flight sessions on cluster-2 will re-auth (~2 minutes of extra logins). No schema change.",
  risk: "Medium",
  rollback: "Fail back to redis-cluster-2 if cluster-1 saturates; keep cluster-2 in standby until memory is confirmed.",
  recoverEta: "8–12 minutes after approval",
};

const recsDiagnosis: Diagnosis = {
  rootCause:
    "A config change dropped recommendation cache TTL from 1h to 30s. Cache miss rate jumped 12% → 78%, origin stampeded, CPU hit 97% and p99 moved to 4.2s.",
  confidence: "High",
  evidence: [
    "recommendation.cpu 97%, p99 4.2s",
    "cache_miss_rate 0.12 → 0.78 over 30 minutes",
    "Config deploy recs-cache TTL 1h → 30s thirty minutes ago",
    "DiffInspector: CACHE_TTL=30 (was 3600)",
    "RPS to origin ~6× baseline; no traffic anomaly at the edge",
  ],
  reasoning:
    "CPU and latency track the cache-miss curve, not inbound RPS. The only change in the window is the TTL drop. A 30s TTL on a hot catalog produces a thundering herd that matches the CPU shape.",
};

const recsProposal: Proposal = {
  steps: [
    "1. Revert CACHE_TTL on recommendation-service from 30s to 3600s.",
    "2. Add +2 replicas as a cushion until miss rate falls below 20%.",
    "3. Confirm p99 < 400ms and CPU < 60% for 15 minutes, then return the extra replicas.",
  ],
  impact:
    "Cache will refill over a few minutes. Extra replicas add cost until scale-in. No user-facing downtime expected.",
  risk: "Low",
  rollback: "Re-apply CACHE_TTL=30 and scale-in immediately if the revert causes stale-recommendation incidents.",
  recoverEta: "5–10 minutes after approval",
};

const authDiagnosis: Diagnosis = {
  rootCause:
    "auth-lib 2.4.1 (deployed 45 minutes ago) is flagged for CVE-2026-8841, an RCE in the token parser. No exploitation observed in logs yet.",
  confidence: "High",
  evidence: [
    "auth-lib 2.4.1 deployed 45 minutes ago to auth-service",
    "CVE-2026-8841: remote code execution in token parser, CVSS 9.8",
    "Logs: no anomalous token shapes or RCE-like payloads in 45 minutes",
    "Traces: auth latency and error rate unchanged",
    "Vendor advisory: downgrade to 2.3.9 or apply 2.4.2 (not yet released)",
  ],
  reasoning:
    "The vulnerability presence is certain (version match). Active exploitation is not evidenced. This is a preventative SEV-1: the blast radius of an auth RCE justifies an emergency rollback before a patch exists.",
};

const authProposal: Proposal = {
  steps: [
    "1. Emergency rollback of auth-service to auth-lib 2.3.9.",
    "2. Rotate signing keys and expire sessions older than the 2.4.1 deploy.",
    "3. Block 2.4.1 in the artifact registry until 2.4.2 is reviewed.",
  ],
  impact:
    "Auth blip of ~60s during rollback. Key rotation forces re-login for sessions issued in the last 45 minutes.",
  risk: "Medium",
  rollback:
    "Re-deploy auth-lib 2.4.1 only after a patched 2.4.2 is verified, or if 2.3.9 itself fails health checks.",
  recoverEta: "10–15 minutes after approval",
};

function checkoutPlaybook(): Playbook {
  const extracted: ExtractedFields = {
    service: "checkout",
    severity: "SEV-1",
    region: "us-east-1",
    timestamp: "last 12 minutes",
    extra: {
      "error rate": "0.3% → 8.7%",
      deploy: "4c21",
    },
  };
  return {
    id: "checkout",
    title: "Checkout error-rate spike",
    extracted,
    confirm:
      "Checkout in us-east-1 is failing ~8.7% of requests after deploy 4c21.",
    diagnosis: checkoutDiagnosis,
    proposal: checkoutProposal,
    investigate: [
      stage(1),
      agent(
        "Alert acknowledged",
        "Service: checkout\nSeverity: SEV-1\nRegion: us-east-1\nWindow: last 12 minutes\nError rate: 0.3% → 8.7%\nDeploy: 4c21\n\nCheckout in us-east-1 is failing ~8.7% of requests after deploy 4c21.",
        1,
        520,
      ),
      { ...stage(2), patch: { stage: 2 } },
      agent(
        "Read-only investigation",
        "Gathering metrics, logs, deploys, and traces. No write tools. Spawning LogAnalyst, MetricsQuerier, and DiffInspector.",
        2,
        480,
      ),
      ...tool(
        "metrics.query",
        "checkout.error_rate{region=us-east-1} 15m",
        "checkout.error_rate{region=us-east-1}\n  12:03  0.003\n  12:07  0.004\n  12:09  0.031\n  12:11  0.079\n  12:15  0.087   ← now\ncheckout.p99_ms{region=us-east-1}  320 → 2100\npayment.latency_p99                812ms (unchanged)",
        "metrics",
      ),
      ...sub(
        "MetricsQuerier",
        "Break down error rate by endpoint and compare payment latency.",
        "Spike is isolated to POST /checkout.\n8.4% of payment calls take >500ms; p50 payment is 210ms.\nNo matching spike in payment 5xx.",
        "metrics",
      ),
      ...tool(
        "deploys.list",
        "checkout-service last 2h",
        "4c21  12:01 UTC  checkout-service  j.kim\n  title: tighten PaymentAdapter timeout\n  previous: 9e10 (stable 6d)\nNo other checkout deploys in 24h.",
        "deploys",
      ),
      ...sub(
        "DiffInspector",
        "Inspect deploy 4c21 diff for timeout, retry, and payment client changes.",
        "PaymentAdapter.ts\n- timeoutMs: 5000\n+ timeoutMs: 500\n\nNo retry/backoff change. No endpoint routing change.",
        "deploys",
      ),
      ...tool(
        "logs.query",
        "service=checkout level=ERROR last 15m",
        "12:09:14Z  ERROR  PaymentAdapter timeout after 500ms  trace=8af2c1  deploy=4c21\n12:09:14Z  ERROR  PaymentAdapter timeout after 500ms  trace=91bb04  deploy=4c21\n12:09:15Z  ERROR  PaymentAdapter timeout after 500ms  trace=c30de2  deploy=4c21\n… 1,842 matching lines. First timeout at 12:09:02Z.",
        "logs",
      ),
      ...sub(
        "LogAnalyst",
        "Cluster timeout errors against deploy id and trace parents.",
        "100% of sampled timeout errors carry deploy=4c21.\nParent spans are payment-svc /charge, status=200, duration 540–1400ms.\nNo inventory or tax errors in the window.",
        "logs",
      ),
      ...tool(
        "traces.get",
        "trace=8af2c1 checkout → payment",
        "checkout /checkout     502ms  error=timeout\n  └ payment /charge      812ms  status=200\nAdapter aborted at 500ms; payment succeeded after the client gave up.",
        "traces",
      ),
      ...sandbox(
        "python correlate.py --deploy 4c21 --metric checkout.error_rate --timeout 500",
        "deploy_4c21_ts     = 12:01:08Z\nfirst_timeout      = 12:09:02Z\nshare_gt_500ms     = 8.41%\naligned_error_rate  = 0.087\nconclusion: timeout threshold sits inside the payment latency tail.",
      ),
      agent(
        "Investigation complete",
        "Facts only. Deploy 4c21, timeout 500ms, payment p99 812ms, error rate 8.7%. Moving to diagnosis.",
        2,
        500,
      ),
      {
        ...stage(3),
        body: `Most likely root cause: ${checkoutDiagnosis.rootCause}\nConfidence: High\n\n${checkoutDiagnosis.reasoning}`,
        patch: { stage: 3, diagnosis: checkoutDiagnosis },
      },
      {
        ...stage(4),
        body: checkoutProposal.steps.join("\n") +
          `\n\nImpact: ${checkoutProposal.impact}\nRisk: ${checkoutProposal.risk}\nTime to recover: ${checkoutProposal.recoverEta}\nRollback: ${checkoutProposal.rollback}`,
        patch: { stage: 4, proposal: checkoutProposal },
      },
      { ...stage(5), patch: { stage: 5 } },
      gateStep(checkoutDiagnosis, checkoutProposal),
    ],
    execute: [
      {
        delayMs: 320,
        kind: "system",
        stage: 5,
        title: "Write lock released",
        body: "Human approval recorded. Irreversible tools are now permitted for this session only.",
        patch: { writeLock: "released", status: "executing" },
      },
      {
        delayMs: 600,
        kind: "execution",
        stage: 5,
        tool: "remediation.rollback",
        title: "mcp.remediation.rollback",
        body: "target=checkout-service to=9e10 reason=approved-incident",
        status: "running",
      },
      {
        delayMs: 1100,
        kind: "execution",
        stage: 5,
        tool: "remediation.rollback",
        bucket: "deploys",
        title: "rollback · ok",
        body: "checkout-service rolled back 4c21 → 9e10.\ntimeoutMs is 5000.\nrollout healthy 12/12 pods.",
        status: "ok",
      },
      ...sandbox(
        "python verify.py --service checkout --region us-east-1 --slo error_rate<0.005",
        "error_rate  0.087 → 0.004  (4m)\np99_ms      2100 → 340\nSLO hold: pass",
        5,
      ),
      {
        delayMs: 500,
        kind: "close",
        stage: 5,
        title: "Incident closed",
        body: "Checkout error rate is back under 0.5% in us-east-1. 4c21 remains blocked pending timeout review.",
        patch: { status: "closed" },
      },
    ],
  };
}

function paymentPlaybook(): Playbook {
  const extracted: ExtractedFields = {
    service: "payment",
    severity: "SEV-1",
    region: "global",
    timestamp: "14:22 UTC",
    extra: { "502 rate": "40%" },
  };
  return {
    id: "payment",
    title: "Payment 502s",
    extracted,
    confirm: "Payment is returning 502s on 40% of requests since 14:22 UTC.",
    diagnosis: paymentDiagnosis,
    proposal: paymentProposal,
    investigate: [
      stage(1),
      agent(
        "Alert acknowledged",
        "Service: payment\nSeverity: SEV-1\nRegion: global\nStart: 14:22 UTC\n502 rate: 40%\n\nPayment is returning 502s on 40% of requests since 14:22 UTC.",
        1,
      ),
      stage(2),
      agent(
        "Read-only investigation",
        "Checking deploys first. If none, look at dependencies. Spawning MetricsQuerier and LogAnalyst.",
        2,
        480,
      ),
      ...tool(
        "deploys.list",
        "payment-service last 6h",
        "No payment-service deploys in the last 6 hours.\nLast prod ship: 2d ago (healthy).",
        "deploys",
      ),
      ...tool(
        "metrics.query",
        "payment.http_5xx, redis-cluster-2 memory 30m",
        "payment.http_5xx        14:22 → 0.40\nredis-cluster-2.mem      0.97\nredis-cluster-2.evict    12,400 / min\nredis-cluster-2.cpu      0.91\nredis-cluster-1.mem      0.41  (healthy)",
        "metrics",
      ),
      ...sub(
        "MetricsQuerier",
        "Correlate 502s with redis-cluster-2 saturation and cluster-1 headroom.",
        "502 curve overlays redis evictions with <30s lag.\ncluster-1 has 59% memory headroom and can take the session store.",
        "metrics",
      ),
      ...tool(
        "logs.query",
        "service=payment status=502 last 20m",
        "14:22:07Z  ERROR  session store: connection reset  host=redis-cluster-2:6379\n14:22:07Z  ERROR  session store: connection reset  host=redis-cluster-2:6379\n14:22:08Z  WARN   retry exhausted, returning 502",
        "logs",
      ),
      ...sub(
        "LogAnalyst",
        "Extract upstream targets from 502 traces.",
        "98% of 502s name redis-cluster-2.\nNo card-processor timeouts. No TLS errors.",
        "logs",
      ),
      ...tool(
        "tickets.search",
        "redis memory pressure since 14:00 UTC",
        "INC-4412  14:18 UTC  infra  redis-cluster-2 memory pressure\nstatus: investigating  owner: sre-oncall",
        "tickets",
      ),
      ...sandbox(
        "python redis_pressure.py --cluster redis-cluster-2 --since 14:00",
        "keyspace_hotkeys  14  (session:*)\neviction_policy    allkeys-lru\nmaxmemory          12gb (97% used)\npredicted_oom      14:31 UTC if rate holds",
      ),
      agent(
        "Investigation complete",
        "No payment deploy. redis-cluster-2 is the dependency on fire. Moving to diagnosis.",
        2,
        500,
      ),
      {
        ...stage(3),
        body: `Most likely root cause: ${paymentDiagnosis.rootCause}\nConfidence: High\n\n${paymentDiagnosis.reasoning}`,
        patch: { stage: 3, diagnosis: paymentDiagnosis },
      },
      {
        ...stage(4),
        body:
          paymentProposal.steps.join("\n") +
          `\n\nImpact: ${paymentProposal.impact}\nRisk: ${paymentProposal.risk}\nTime to recover: ${paymentProposal.recoverEta}\nRollback: ${paymentProposal.rollback}`,
        patch: { stage: 4, proposal: paymentProposal },
      },
      stage(5),
      gateStep(paymentDiagnosis, paymentProposal),
    ],
    execute: [
      {
        delayMs: 320,
        kind: "system",
        stage: 5,
        title: "Write lock released",
        body: "Human approval recorded. Irreversible tools are now permitted for this session only.",
        patch: { writeLock: "released", status: "executing" },
      },
      {
        delayMs: 700,
        kind: "execution",
        stage: 5,
        tool: "remediation.failover",
        title: "mcp.remediation.failover",
        body: "payment session-store redis-cluster-2 → redis-cluster-1",
        status: "running",
      },
      {
        delayMs: 1200,
        kind: "execution",
        stage: 5,
        tool: "remediation.failover",
        title: "failover · ok",
        body: "DNS cutover complete. 502 rate 0.40 → 0.06 and falling.",
        status: "ok",
      },
      ...sandbox(
        "python verify.py --service payment --slo success>0.995",
        "success_rate  0.60 → 0.997\nredis-cluster-1.mem  0.62\nSLO hold: pass",
        5,
      ),
      {
        delayMs: 500,
        kind: "close",
        stage: 5,
        title: "Incident closed",
        body: "Payment 502s recovered after session-store failover. cluster-2 remains isolated pending memory upgrade.",
        patch: { status: "closed" },
      },
    ],
  };
}

function recsPlaybook(): Playbook {
  const extracted: ExtractedFields = {
    service: "recommendation",
    severity: "SEV-2",
    region: "global",
    timestamp: "now",
    extra: { CPU: "97%", p99: "4.2s" },
  };
  return {
    id: "recs",
    title: "Recommendation CPU / latency",
    extracted,
    confirm:
      "Recommendation service is CPU-bound at 97% with p99 latency of 4.2s.",
    diagnosis: recsDiagnosis,
    proposal: recsProposal,
    investigate: [
      stage(1),
      agent(
        "Alert acknowledged",
        "Service: recommendation\nSeverity: SEV-2\nCPU: 97%\np99: 4.2s\n\nRecommendation service is CPU-bound at 97% with p99 latency of 4.2s.",
        1,
      ),
      stage(2),
      ...tool(
        "metrics.query",
        "recommendation.cpu, p99, cache_miss_rate 45m",
        "cpu             0.97\np99_s           4.2\ncache_miss      0.12 → 0.78\nedge_rps        +4% (not the cause)\norigin_rps      ×6",
        "metrics",
      ),
      ...sub(
        "MetricsQuerier",
        "Is this traffic or cache?",
        "Edge RPS nearly flat. Origin RPS and CPU track cache_miss. This is a cache stampede, not a demand spike.",
        "metrics",
      ),
      ...tool(
        "deploys.list",
        "recommendation-service + config last 1h",
        "30m ago  recs-cache config  CACHE_TTL=30  (was 3600)\nno binary deploy",
        "deploys",
      ),
      ...sub(
        "DiffInspector",
        "Inspect recs-cache config change.",
        "CACHE_TTL=30\n# was 3600\ncomment: 'faster catalog freshness'\nno jitter / no stampede lock added",
        "deploys",
      ),
      ...tool(
        "logs.query",
        "service=recommendation cache miss last 20m",
        "cache miss on popular:home, popular:foryou, similar:*\norigin handler occupying 20+ worker threads",
        "logs",
      ),
      ...sandbox(
        "python cache_stampede.py --ttl 30 --hotkeys 200 --qps 2400",
        "predicted_miss_rate  0.76  (observed 0.78)\npredicted_cpu        0.94  (observed 0.97)\nmodel agrees with TTL as the lever",
      ),
      agent(
        "Investigation complete",
        "TTL change, miss-rate, CPU, and origin RPS line up. Moving to diagnosis.",
        2,
      ),
      {
        ...stage(3),
        body: `Most likely root cause: ${recsDiagnosis.rootCause}\nConfidence: High\n\n${recsDiagnosis.reasoning}`,
        patch: { stage: 3, diagnosis: recsDiagnosis },
      },
      {
        ...stage(4),
        body:
          recsProposal.steps.join("\n") +
          `\n\nImpact: ${recsProposal.impact}\nRisk: ${recsProposal.risk}\nTime to recover: ${recsProposal.recoverEta}\nRollback: ${recsProposal.rollback}`,
        patch: { stage: 4, proposal: recsProposal },
      },
      stage(5),
      gateStep(recsDiagnosis, recsProposal),
    ],
    execute: [
      {
        delayMs: 320,
        kind: "system",
        stage: 5,
        title: "Write lock released",
        body: "Human approval recorded. Irreversible tools are now permitted for this session only.",
        patch: { writeLock: "released", status: "executing" },
      },
      {
        delayMs: 700,
        kind: "execution",
        stage: 5,
        tool: "remediation.config",
        title: "mcp.remediation.config",
        body: "recommendation-service CACHE_TTL=3600; replicas += 2",
        status: "running",
      },
      {
        delayMs: 1000,
        kind: "execution",
        stage: 5,
        title: "config · ok",
        body: "TTL restored. Two replicas warming. miss_rate 0.78 → 0.21.",
        status: "ok",
      },
      {
        delayMs: 500,
        kind: "close",
        stage: 5,
        title: "Incident closed",
        body: "p99 4.2s → 360ms. CPU 97% → 48%. Extra replicas will scale in after 15 minutes of SLO hold.",
        patch: { status: "closed" },
      },
    ],
  };
}

function authPlaybook(): Playbook {
  const extracted: ExtractedFields = {
    service: "auth",
    severity: "SEV-1",
    region: "global",
    timestamp: "45 minutes ago",
    extra: { library: "auth-lib 2.4.1", vuln: "CVE-2026-8841" },
  };
  return {
    id: "auth",
    title: "Auth library CVE",
    extracted,
    confirm:
      "A critical vulnerability was flagged in the auth library shipped 45 minutes ago. Checking for active exploitation before proposing a rollback.",
    diagnosis: authDiagnosis,
    proposal: authProposal,
    investigate: [
      stage(1),
      agent(
        "Alert acknowledged",
        "Service: auth\nSeverity: SEV-1\nLibrary: auth-lib (deployed 45m ago)\nIssue: critical vulnerability\n\nA critical vulnerability was flagged in the auth library shipped 45 minutes ago.",
        1,
      ),
      stage(2),
      ...tool(
        "deploys.list",
        "auth-service last 2h",
        "45m ago  auth-service  auth-lib 2.4.1  (was 2.3.9)\nrollout complete, health green",
        "deploys",
      ),
      ...tool(
        "tickets.search",
        "CVE auth-lib 2.4",
        "CVE-2026-8841  CVSS 9.8  RCE in token parser\naffected: auth-lib 2.4.0–2.4.1\nfixed: none released; vendor: downgrade to 2.3.9",
        "tickets",
      ),
      ...sub(
        "DiffInspector",
        "What changed in auth-lib 2.4.1 vs 2.3.9?",
        "token/parser.c  rewritten buffer handling\nchangelog: 'faster JWT parse'\nno additional authz checks",
        "deploys",
      ),
      ...tool(
        "logs.query",
        "auth-service anomalous tokens last 45m",
        "No malformed-token spikes.\nNo RCE-like payloads, outbound shells, or unexpected process spawns.\nError rate unchanged.",
        "logs",
      ),
      ...tool(
        "traces.get",
        "auth latency / error 45m",
        "p99 41ms (baseline 38ms). error_rate 0.12% (baseline 0.11%). Traffic normal.",
        "traces",
      ),
      ...sandbox(
        "python cve_scan.py --lib auth-lib --version 2.4.1 --cve CVE-2026-8841",
        "version_match     true\nexploit_in_logs   false\nexposure          public token endpoint\nrecommendation    emergency downgrade",
      ),
      agent(
        "Investigation complete",
        "Vulnerable version is in production. No evidence of exploitation yet. Moving to diagnosis.",
        2,
      ),
      {
        ...stage(3),
        body: `Most likely root cause: ${authDiagnosis.rootCause}\nConfidence: High on presence, Medium on exploit status.\n\n${authDiagnosis.reasoning}`,
        patch: { stage: 3, diagnosis: authDiagnosis },
      },
      {
        ...stage(4),
        body:
          authProposal.steps.join("\n") +
          `\n\nImpact: ${authProposal.impact}\nRisk: ${authProposal.risk}\nTime to recover: ${authProposal.recoverEta}\nRollback: ${authProposal.rollback}`,
        patch: { stage: 4, proposal: authProposal },
      },
      stage(5),
      gateStep(authDiagnosis, authProposal),
    ],
    execute: [
      {
        delayMs: 320,
        kind: "system",
        stage: 5,
        title: "Write lock released",
        body: "Human approval recorded. Irreversible tools are now permitted for this session only.",
        patch: { writeLock: "released", status: "executing" },
      },
      {
        delayMs: 800,
        kind: "execution",
        stage: 5,
        tool: "remediation.rollback",
        title: "mcp.remediation.rollback",
        body: "auth-service auth-lib 2.4.1 → 2.3.9; rotate signing keys",
        status: "running",
      },
      {
        delayMs: 1300,
        kind: "execution",
        stage: 5,
        title: "rollback · ok",
        body: "auth-lib 2.3.9 live. keys rotated. sessions issued after 2.4.1 deploy have been expired.",
        status: "ok",
      },
      {
        delayMs: 500,
        kind: "close",
        stage: 5,
        title: "Incident closed",
        body: "Vulnerable build is out of production. 2.4.1 is blocked in the registry. No exploitation found in the 45-minute window.",
        patch: { status: "closed" },
      },
    ],
  };
}

function genericPlaybook(alert: string): Playbook {
  const service =
    alert.match(/\b([a-z][a-z0-9_-]*(?:service|svc|api)?)\b/i)?.[1] ??
    "production";
  const region =
    alert.match(/\b(us-east-1|us-west-2|eu-west-1|ap-south-1)\b/i)?.[1] ??
    "unknown";
  const extracted: ExtractedFields = {
    service,
    severity: /crit|sev-?1|p0/i.test(alert) ? "SEV-1" : "SEV-2",
    region,
    timestamp: "unspecified",
    extra: {},
  };
  const diagnosis: Diagnosis = {
    rootCause:
      "Telemetry is incomplete for a single root cause. Leading hypothesis: a recent change coinciding with the alert window. No write action is justified until more evidence lands.",
    confidence: "Low",
    evidence: [
      "Alert text parsed; limited structured fields",
      "Metrics/logs queried for the named service",
      "No high-confidence deploy correlation",
    ],
    reasoning:
      "The harness will not invent metrics. With low confidence the safe proposal is a hold: keep the write lock engaged unless the human explicitly wants a guarded rollback.",
  };
  const proposal: Proposal = {
    steps: [
      "1. Do not change production automatically.",
      "2. Page the service owner and attach this investigation session.",
      "3. If a deploy is later confirmed in the window, return here and propose a targeted rollback.",
    ],
    impact: "None — this plan does not mutate production.",
    risk: "Low",
    rollback: "Not applicable; no production mutation is proposed.",
    recoverEta: "Waiting on human / more telemetry",
  };
  return {
    id: "generic",
    title: `${service} alert`,
    extracted,
    confirm: `I have the alert for ${service}, but several fields are missing. I will investigate with the tools I have and will not guess numbers I cannot see.`,
    diagnosis,
    proposal,
    investigate: [
      stage(1),
      agent(
        "Alert acknowledged",
        `Service: ${service}\nSeverity: ${extracted.severity}\nRegion: ${region}\n\n${alert}\n\nI have the alert for ${service}, but several fields are missing. I will investigate with the tools I have and will not guess numbers I cannot see.`,
        1,
      ),
      stage(2),
      ...tool(
        "metrics.query",
        `${service} error_rate, latency, cpu 30m`,
        `No high-resolution series for ${service} in the mock telemetry store.\nReturned: sparse heartbeat only. Tool limitation stated — not filled in.`,
        "metrics",
      ),
      ...tool(
        "logs.query",
        `service=${service} level=ERROR last 30m`,
        "Log backend returned 0 stored lines for this identifier in the sandbox catalog.\nContinuing with remaining tools.",
        "logs",
      ),
      ...tool(
        "deploys.list",
        `${service} last 2h`,
        "No matching deploy records in the catalog for this service name.",
        "deploys",
      ),
      ...sub(
        "LogAnalyst",
        "Re-check spelling / aliases.",
        "No alias match. Do not invent log lines.",
        "logs",
      ),
      ...sandbox(
        `python inventory.py --service '${service.replace(/'/g, "")}'`,
        "known_playbooks = checkout | payment | recommendation | auth\nthis alert did not match a catalogued scenario\nsafe_action      = hold for human",
      ),
      agent(
        "Investigation complete",
        "Available data is insufficient for a high-confidence root cause. Moving to diagnosis with Low confidence.",
        2,
      ),
      {
        ...stage(3),
        body: `Most likely root cause: ${diagnosis.rootCause}\nConfidence: Low\n\n${diagnosis.reasoning}`,
        patch: { stage: 3, diagnosis },
      },
      {
        ...stage(4),
        body:
          proposal.steps.join("\n") +
          `\n\nImpact: ${proposal.impact}\nRisk: ${proposal.risk}\nRollback: ${proposal.rollback}`,
        patch: { stage: 4, proposal },
      },
      stage(5),
      gateStep(diagnosis, proposal),
    ],
    execute: [
      {
        delayMs: 280,
        kind: "system",
        stage: 5,
        title: "Write lock stays conceptually released, no mutation",
        body: "Approval recorded. Proposed action does not call rollback, restart, scale, deploy, or delete.",
        patch: { writeLock: "released", status: "executing" },
      },
      {
        delayMs: 700,
        kind: "execution",
        stage: 5,
        title: "ticket.attach",
        body: "Investigation session attached to on-call. No production mutation performed.",
        status: "ok",
      },
      {
        delayMs: 400,
        kind: "close",
        stage: 5,
        title: "Incident parked",
        body: "Closed as 'needs more telemetry'. Session remains available to resume if new evidence arrives.",
        patch: { status: "closed" },
      },
    ],
  };
}

export function matchPlaybookId(alert: string) {
  const t = alert.toLowerCase();
  if (t.includes("checkout") && (t.includes("4c21") || t.includes("error rate"))) {
    return "checkout";
  }
  if (t.includes("payment") && t.includes("502")) return "payment";
  if (t.includes("recommendation") && (t.includes("cpu") || t.includes("latency"))) {
    return "recs";
  }
  if (t.includes("vulnerab") || (t.includes("auth") && t.includes("library"))) {
    return "auth";
  }
  return "generic";
}

export function getPlaybook(alert: string): Playbook {
  const id = matchPlaybookId(alert);
  if (id === "checkout") return checkoutPlaybook();
  if (id === "payment") return paymentPlaybook();
  if (id === "recs") return recsPlaybook();
  if (id === "auth") return authPlaybook();
  return genericPlaybook(alert);
}
