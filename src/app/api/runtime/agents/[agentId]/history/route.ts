import { NextResponse } from "next/server";

import { deriveRuntimeFreshness } from "@/lib/controlplane/degraded-read";
import { ControlPlaneGatewayError } from "@/lib/controlplane/openclaw-adapter";
import { serializeRuntimeInitFailure } from "@/lib/controlplane/runtime-init-errors";
import { bootstrapDomainRuntime } from "@/lib/controlplane/runtime-route-bootstrap";
import {
  countSemanticTurns,
  selectSemanticHistoryWindow,
  type SemanticHistoryMessage,
} from "@/lib/controlplane/semantic-history-window";
import {
  clampGatewayChatHistoryLimit,
  GATEWAY_CHAT_HISTORY_MAX_LIMIT,
} from "@/lib/gateway/chatHistoryLimits";

export const runtime = "nodejs";

type HistoryView = "raw" | "semantic";
type GatewayChatHistoryPayload = {
  messages?: unknown[];
};

const DEFAULT_RAW_LIMIT = 200;
const DEFAULT_TURN_LIMIT = 50;
const MAX_TURN_LIMIT = 400;
const DEFAULT_SCAN_LIMIT = 800;

const HISTORY_DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(
  (process.env.NEXT_PUBLIC_STUDIO_TRANSCRIPT_DEBUG ?? "").trim()
);

const logHistoryRouteMetric = (metric: string, meta: Record<string, unknown>) => {
  if (!HISTORY_DEBUG_ENABLED) return;
  console.debug(`[history-route] ${metric}`, meta);
};

const resolveBoundedPositiveInt = (params: {
  raw: string | null;
  fallback: number;
  max: number;
}): number => {
  if (!params.raw) return params.fallback;
  const parsed = Number(params.raw);
  if (!Number.isFinite(parsed)) return params.fallback;
  if (parsed <= 0) return params.fallback;
  return Math.min(Math.floor(parsed), params.max);
};

const resolveRawLimit = (raw: string | null): number =>
  clampGatewayChatHistoryLimit(
    resolveBoundedPositiveInt({
      raw,
      fallback: DEFAULT_RAW_LIMIT,
      max: Number.MAX_SAFE_INTEGER,
    })
  ) ?? DEFAULT_RAW_LIMIT;

const resolveTurnLimit = (raw: string | null): number =>
  resolveBoundedPositiveInt({
    raw,
    fallback: DEFAULT_TURN_LIMIT,
    max: MAX_TURN_LIMIT,
  });

const resolveScanLimit = (raw: string | null): number =>
  clampGatewayChatHistoryLimit(
    resolveBoundedPositiveInt({
      raw,
      fallback: DEFAULT_SCAN_LIMIT,
      max: Number.MAX_SAFE_INTEGER,
    })
  ) ?? DEFAULT_SCAN_LIMIT;

const resolveView = (raw: string | null): HistoryView => {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "raw") return "raw";
  if (normalized === "semantic") return "semantic";
  return "semantic";
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const mapGatewayError = (error: unknown): NextResponse => {
  if (error instanceof ControlPlaneGatewayError) {
    if (error.code.trim().toUpperCase() === "GATEWAY_UNAVAILABLE") {
      return NextResponse.json(
        {
          error: error.message,
          code: "GATEWAY_UNAVAILABLE",
          reason: "gateway_unavailable",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: 400 }
    );
  }

  const message = error instanceof Error ? error.message : "runtime_read_failed";
  return NextResponse.json({ error: message }, { status: 500 });
};

export async function GET(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const routeStartedAt = Date.now();
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
  const sessionKeyRaw = (url.searchParams.get("sessionKey") ?? "").trim();
  const sessionKey = sessionKeyRaw || `agent:${normalizedAgentId}:main`;
  const view = resolveView(url.searchParams.get("view"));
  const limit = resolveRawLimit(url.searchParams.get("limit"));
  const turnLimit = resolveTurnLimit(url.searchParams.get("turnLimit"));
  const scanLimit = resolveScanLimit(url.searchParams.get("scanLimit"));
  const snapshot = controlPlane.snapshot();

  const gatewayLimit = view === "semantic" ? scanLimit : limit;
  const gatewayCapped = gatewayLimit >= GATEWAY_CHAT_HISTORY_MAX_LIMIT;

  let messages: SemanticHistoryMessage[] = [];
  const gatewayStartedAt = Date.now();
  try {
    const history = await controlPlane.callGateway<GatewayChatHistoryPayload>("chat.history", {
      sessionKey,
      limit: gatewayLimit,
    });
    const rawMessages = Array.isArray(history?.messages) ? history.messages : [];
    messages = rawMessages
      .map((message) => asRecord(message))
      .filter((message): message is SemanticHistoryMessage => message !== null);
  } catch (error) {
    return mapGatewayError(error);
  }
  const gatewayDurationMs = Date.now() - gatewayStartedAt;

  const hasMoreBefore = messages.length >= gatewayLimit;
  let selectedMessages: SemanticHistoryMessage[] = [];
  let hasMore = false;
  let semanticTurnsIncluded = 0;
  let windowTruncated = false;

  if (view === "semantic") {
    const semanticWindow = selectSemanticHistoryWindow({
      messages,
      turnLimit,
      hasMoreBefore,
    });
    selectedMessages = semanticWindow.messages;
    hasMore = semanticWindow.windowTruncated;
    semanticTurnsIncluded = semanticWindow.semanticTurnsIncluded;
    windowTruncated = semanticWindow.windowTruncated;
  } else {
    selectedMessages = messages;
    hasMore = hasMoreBefore;
    semanticTurnsIncluded = countSemanticTurns(selectedMessages);
    windowTruncated = hasMore;
  }

  if (HISTORY_DEBUG_ENABLED) {
    const payloadBytes = (() => {
      try {
        return JSON.stringify(selectedMessages).length;
      } catch {
        return 0;
      }
    })();
    logHistoryRouteMetric("history_window", {
      agentId: normalizedAgentId,
      sessionKey,
      view,
      turnLimit,
      limit,
      scanLimit,
      gatewayLimit,
      gatewayCapped,
      gatewayMessageCount: messages.length,
      selectedMessageCount: selectedMessages.length,
      payloadBytes,
      hasMore,
      windowTruncated,
      semanticTurnsIncluded,
      gatewayDurationMs,
      routeDurationMs: Date.now() - routeStartedAt,
    });
  }

  return NextResponse.json({
    enabled: true,
    agentId: normalizedAgentId,
    ...(startError ? { error: startError } : {}),
    view,
    messages: selectedMessages,
    hasMore,
    semanticTurnsIncluded,
    windowTruncated,
    gatewayLimit,
    gatewayCapped,
    freshness: deriveRuntimeFreshness(snapshot, null),
  });
}
