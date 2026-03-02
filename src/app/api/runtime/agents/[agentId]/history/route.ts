import { NextResponse } from "next/server";

import { deriveRuntimeFreshness, probeOpenClawLocalState } from "@/lib/controlplane/degraded-read";
import { serializeRuntimeInitFailure } from "@/lib/controlplane/runtime-init-errors";
import { bootstrapDomainRuntime } from "@/lib/controlplane/runtime-route-bootstrap";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const BACKFILL_BATCH_LIMIT = 500;
const MAX_BACKFILL_BATCHES_PER_REQUEST = 2;

const resolveLimit = (raw: string | null): number => {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  if (parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
};

const resolveBeforeOutboxId = (raw: string | null, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), fallback);
};

export async function GET(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const bootstrap = await bootstrapDomainRuntime();
  if (bootstrap.kind === "mode-disabled") {
    return NextResponse.json({ enabled: false, error: "domain_api_mode_disabled" }, { status: 404 });
  }

  const { agentId } = await context.params;
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return NextResponse.json({ error: "agentId is required." }, { status: 400 });
  }

  if (bootstrap.kind === "runtime-init-failed") {
    return NextResponse.json(
      {
        enabled: true,
        ...serializeRuntimeInitFailure(bootstrap.failure),
      },
      { status: 503 }
    );
  }
  const controlPlane = bootstrap.runtime;
  const startError = bootstrap.kind === "start-failed" ? bootstrap.message : null;

  const url = new URL(request.url);
  const limit = resolveLimit(url.searchParams.get("limit"));
  const snapshot = controlPlane.snapshot();
  const beforeOutboxId = resolveBeforeOutboxId(
    url.searchParams.get("beforeOutboxId"),
    snapshot.outboxHead + 1
  );
  const probe = snapshot.status === "connected" ? null : await probeOpenClawLocalState();
  let results = controlPlane.eventsBeforeForAgent(normalizedAgentId, beforeOutboxId, limit + 1);
  let backfillIncomplete = false;
  if (results.length <= limit) {
    for (let attempt = 0; attempt < MAX_BACKFILL_BATCHES_PER_REQUEST; attempt += 1) {
      const backfill = controlPlane.backfillAgentHistoryIndex(beforeOutboxId, BACKFILL_BATCH_LIMIT);
      if (backfill.scannedRows === 0) {
        backfillIncomplete = false;
        break;
      }
      backfillIncomplete = !backfill.exhausted;
      results = controlPlane.eventsBeforeForAgent(normalizedAgentId, beforeOutboxId, limit + 1);
      if (results.length > limit || backfill.exhausted) {
        break;
      }
    }
  }
  const hasMore = results.length > limit || backfillIncomplete;
  const entries = results.length > limit ? results.slice(results.length - limit) : results;
  const nextBeforeOutboxId = hasMore
    ? backfillIncomplete
      ? beforeOutboxId
      : entries.length > 0
        ? entries[0].id
        : null
    : null;

  return NextResponse.json({
    enabled: true,
    agentId: normalizedAgentId,
    ...(startError ? { error: startError } : {}),
    entries,
    hasMore,
    nextBeforeOutboxId,
    freshness: deriveRuntimeFreshness(snapshot, probe),
    ...(probe ? { probe } : {}),
  });
}
