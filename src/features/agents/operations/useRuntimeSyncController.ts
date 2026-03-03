import { useCallback, useEffect, useRef } from "react";

import {
  executeAgentReconcileCommands,
  runAgentReconcileOperation,
} from "@/features/agents/operations/agentReconcileOperation";
import { resolveSummarySnapshotIntent } from "@/features/agents/operations/fleetLifecycleWorkflow";
import {
  executeHistorySyncCommands,
  runHistorySyncOperation,
} from "@/features/agents/operations/historySyncOperation";
import {
  RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT,
  RUNTIME_SYNC_MAX_HISTORY_LIMIT,
  resolveRuntimeSyncBootstrapHistoryAgentIds,
  resolveRuntimeSyncFocusedHistoryPollingIntent,
  resolveRuntimeSyncGapRecoveryIntent,
  resolveRuntimeSyncLoadMoreHistoryLimit,
  resolveRuntimeSyncReconcilePollingIntent,
  shouldRuntimeSyncContinueFocusedHistoryPolling,
} from "@/features/agents/operations/runtimeSyncControlWorkflow";
import {
  buildDomainHistoryRunStatePatch,
  type DomainHistoryActiveRun,
  buildSummarySnapshotPatches,
  type SummaryPreviewSnapshot,
  type SummaryStatusSnapshot,
} from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";
import { TRANSCRIPT_V2_ENABLED, logTranscriptDebugMetric } from "@/features/agents/state/transcript";
import type { ControlPlaneOutboxEntry } from "@/lib/controlplane/contracts";
import { randomUUID } from "@/lib/uuid";
import { fetchJson } from "@/lib/http";

type RuntimeSyncDispatchAction = {
  type: "updateAgent";
  agentId: string;
  patch: Partial<AgentState>;
};

type GatewayClientLike = {
  call: <T = unknown>(method: string, params: unknown) => Promise<T>;
  onGap?: (handler: (info: { expected: number; received: number }) => void) => () => void;
};

type UseRuntimeSyncControllerParams = {
  client: GatewayClientLike;
  status: "disconnected" | "connecting" | "connected";
  agents: AgentState[];
  focusedAgentId: string | null;
  focusedAgentRunning: boolean;
  dispatch: (action: RuntimeSyncDispatchAction) => void;
  clearRunTracking: (runId: string) => void;
  isDisconnectLikeError: (error: unknown) => boolean;
  useDomainApiReads: boolean;
  defaultHistoryLimit?: number;
  maxHistoryLimit?: number;
};

type RuntimeSyncController = {
  loadSummarySnapshot: () => Promise<void>;
  loadAgentHistory: (agentId: string, options?: { limit?: number }) => Promise<void>;
  loadMoreAgentHistory: (agentId: string) => void;
  reconcileRunningAgents: () => Promise<void>;
  clearHistoryInFlight: (sessionKey: string) => void;
};

type DomainAgentHistoryResponse = {
  entries?: unknown[];
  hasMore?: unknown;
  semanticTurnsIncluded?: unknown;
  windowTruncated?: unknown;
  activeRun?: unknown;
};

const DOMAIN_SEMANTIC_TURN_LIMIT = 50;
const DOMAIN_SEMANTIC_SCAN_LIMIT = 800;
const DOMAIN_CHAT_HISTORY_MAX_LIMIT = 1000;

type DomainChatHistoryEnvelope = {
  ok?: unknown;
  payload?: {
    sessionKey?: unknown;
    messages?: unknown;
  } | null;
  error?: unknown;
};

type DomainChatHistoryPayload = {
  sessionKey: string;
  messages: Record<string, unknown>[];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const resolveDomainHistoryActiveRun = (value: unknown): DomainHistoryActiveRun | null => {
  const record = asRecord(value);
  if (!record) return null;
  const statusRaw = record.status;
  const status =
    statusRaw === "running" || statusRaw === "idle" || statusRaw === "error"
      ? statusRaw
      : null;
  if (!status) return null;
  const runIdRaw = record.runId;
  const runId =
    typeof runIdRaw === "string" ? (runIdRaw.trim() || null) : runIdRaw === null ? null : null;
  const complete = record.complete === true;
  return { runId, status, complete };
};

export function useRuntimeSyncController(
  params: UseRuntimeSyncControllerParams
): RuntimeSyncController {
  const {
    client,
    status,
    agents,
    focusedAgentId,
    focusedAgentRunning,
    dispatch,
    clearRunTracking,
    isDisconnectLikeError,
    useDomainApiReads,
  } = params;
  const agentsRef = useRef(agents);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const reconcileRunInFlightRef = useRef<Set<string>>(new Set());

  const defaultHistoryLimit = params.defaultHistoryLimit ?? RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT;
  const maxHistoryLimit = params.maxHistoryLimit ?? RUNTIME_SYNC_MAX_HISTORY_LIMIT;

  const loadDomainChatHistory = useCallback(
    async (params: { sessionKey: string; limit?: number }): Promise<DomainChatHistoryPayload> => {
      const query = new URLSearchParams({ sessionKey: params.sessionKey.trim() });
      if (typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0) {
        const bounded = Math.min(Math.floor(params.limit), DOMAIN_CHAT_HISTORY_MAX_LIMIT);
        query.set("limit", String(bounded));
      }
      const response = await fetchJson<DomainChatHistoryEnvelope>(
        `/api/runtime/chat-history?${query.toString()}`,
        { cache: "no-store" }
      );
      if (response?.ok !== true) {
        const message =
          typeof response?.error === "string" ? response.error.trim() : "Domain chat history read failed.";
        throw new Error(message || "Domain chat history read failed.");
      }
      const payload =
        response.payload && typeof response.payload === "object"
          ? response.payload
          : {};
      const messages = Array.isArray(payload.messages)
        ? payload.messages.filter(
            (entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object")
          )
        : [];
      return {
        sessionKey:
          typeof payload.sessionKey === "string" && payload.sessionKey.trim()
            ? payload.sessionKey.trim()
            : params.sessionKey.trim(),
        messages,
      };
    },
    []
  );

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const clearHistoryInFlight = useCallback((sessionKey: string) => {
    const key = sessionKey.trim();
    if (!key) return;
    historyInFlightRef.current.delete(key);
  }, []);

  const loadSummarySnapshot = useCallback(async () => {
    if (useDomainApiReads) {
      try {
        await fetchJson<{ summary?: unknown; freshness?: unknown }>("/api/runtime/summary", {
          cache: "no-store",
        });
      } catch (error) {
        if (!isDisconnectLikeError(error)) {
          console.error("Failed to load domain runtime summary.", error);
        }
      }
      return;
    }
    const snapshotAgents = agentsRef.current;
    const summaryIntent = resolveSummarySnapshotIntent({
      agents: snapshotAgents,
      maxKeys: 64,
    });
    if (summaryIntent.kind === "skip") return;
    const activeAgents = snapshotAgents.filter((agent) => agent.sessionCreated);
    try {
      const [statusSummary, previewResult] = await Promise.all([
        client.call<SummaryStatusSnapshot>("status", {}),
        client.call<SummaryPreviewSnapshot>("sessions.preview", {
          keys: summaryIntent.keys,
          limit: summaryIntent.limit,
          maxChars: summaryIntent.maxChars,
        }),
      ]);
      for (const entry of buildSummarySnapshotPatches({
        agents: activeAgents,
        statusSummary,
        previewResult,
      })) {
        dispatch({
          type: "updateAgent",
          agentId: entry.agentId,
          patch: entry.patch,
        });
      }
    } catch (error) {
      if (!isDisconnectLikeError(error)) {
        console.error("Failed to load summary snapshot.", error);
      }
    }
  }, [client, dispatch, isDisconnectLikeError, useDomainApiReads]);

  const loadAgentHistoryViaDomainApi = useCallback(
    async (agentId: string, limit: number) => {
      const normalizedAgentId = agentId.trim();
      const encodedAgentId = encodeURIComponent(normalizedAgentId);
      if (!encodedAgentId) return;
      const boundedLimit = Math.min(Math.max(1, Math.floor(limit)), DOMAIN_CHAT_HISTORY_MAX_LIMIT);
      const fetchPage = async (params: {
        turnLimit?: number;
        scanLimit?: number;
      }): Promise<{
        entries: ControlPlaneOutboxEntry[];
        semanticTurnsIncluded: number | null;
        windowTruncated: boolean;
        activeRun: DomainHistoryActiveRun | null;
      }> => {
        const query = new URLSearchParams();
        query.set("limit", String(boundedLimit));
        query.set("view", "semantic");
        query.set("turnLimit", String(params.turnLimit ?? DOMAIN_SEMANTIC_TURN_LIMIT));
        query.set("scanLimit", String(params.scanLimit ?? DOMAIN_SEMANTIC_SCAN_LIMIT));
        const result = await fetchJson<DomainAgentHistoryResponse>(
          `/api/runtime/agents/${encodedAgentId}/history?${query.toString()}`,
          { cache: "no-store" }
        );
        const entries = Array.isArray(result.entries)
          ? (result.entries as ControlPlaneOutboxEntry[])
          : [];
        const semanticTurnsIncluded =
          typeof result.semanticTurnsIncluded === "number" &&
          Number.isFinite(result.semanticTurnsIncluded) &&
          result.semanticTurnsIncluded >= 0
            ? Math.floor(result.semanticTurnsIncluded)
            : null;
        const windowTruncated =
          result.windowTruncated === true ? true : result.hasMore === true;
        const activeRun = resolveDomainHistoryActiveRun(result.activeRun);
        return {
          entries,
          semanticTurnsIncluded,
          windowTruncated,
          activeRun,
        };
      };

      const loadedAt = Date.now();
      const firstPage = await fetchPage({
        turnLimit: DOMAIN_SEMANTIC_TURN_LIMIT,
        scanLimit: DOMAIN_SEMANTIC_SCAN_LIMIT,
      });
      logTranscriptDebugMetric("domain_history_semantic_window", {
        agentId: normalizedAgentId,
        turns: firstPage.semanticTurnsIncluded,
        entries: firstPage.entries.length,
        truncated: firstPage.windowTruncated,
      });
      const latestAgent =
        agentsRef.current.find((entry) => entry.agentId === normalizedAgentId) ?? null;
      if (
        latestAgent?.sessionCreated &&
        typeof latestAgent.sessionKey === "string" &&
        latestAgent.sessionKey.trim()
      ) {
        const commands = await runHistorySyncOperation({
          client: {
            call: async <T = unknown>(method: string, request: unknown) => {
              if (method !== "chat.history") {
                throw new Error(`Unsupported domain history method: ${method}`);
              }
              const body =
                request && typeof request === "object"
                  ? (request as { sessionKey?: unknown; limit?: unknown })
                  : {};
              const sessionKey =
                typeof body.sessionKey === "string" ? body.sessionKey.trim() : latestAgent.sessionKey.trim();
              const requestedLimit =
                typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
                  ? Math.floor(body.limit)
                  : undefined;
              return (await loadDomainChatHistory({
                sessionKey,
                limit: requestedLimit,
              })) as T;
            },
          },
          agentId: normalizedAgentId,
          requestedLimit: boundedLimit,
          getAgent: (targetAgentId) =>
            agentsRef.current.find((entry) => entry.agentId === targetAgentId) ?? null,
          inFlightSessionKeys: historyInFlightRef.current,
          requestId: randomUUID(),
          loadedAt,
          defaultLimit: defaultHistoryLimit,
          maxLimit: maxHistoryLimit,
          transcriptV2Enabled: TRANSCRIPT_V2_ENABLED,
          allowTranscriptRevisionSkew: true,
        });
        executeHistorySyncCommands({
          commands,
          dispatch,
          logMetric: (metric, meta) => logTranscriptDebugMetric(metric, meta),
          isDisconnectLikeError,
          logError: (message, error) => console.error(message, error),
        });
      }
      const domainRunStatePatch =
        firstPage.activeRun
          ? buildDomainHistoryRunStatePatch({
              activeRun: firstPage.activeRun,
              currentStatus: latestAgent?.status ?? "idle",
              currentRunId: latestAgent?.runId ?? null,
            })
          : null;
      dispatch({
        type: "updateAgent",
        agentId,
        patch: {
          historyLoadedAt: loadedAt,
          historyFetchLimit: boundedLimit,
          historyFetchedCount:
            typeof firstPage.semanticTurnsIncluded === "number"
              ? firstPage.semanticTurnsIncluded
              : firstPage.entries.length,
          historyMaybeTruncated: firstPage.windowTruncated,
          ...(domainRunStatePatch ?? {}),
        },
      });
    },
    [
      defaultHistoryLimit,
      dispatch,
      isDisconnectLikeError,
      loadDomainChatHistory,
      maxHistoryLimit,
    ]
  );

  const loadAgentHistory = useCallback(
    async (agentId: string, options?: { limit?: number }) => {
      if (useDomainApiReads) {
        const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
        const rawLimit =
          typeof options?.limit === "number" && Number.isFinite(options.limit)
            ? Math.floor(options.limit)
            : agent?.historyFetchLimit ?? defaultHistoryLimit;
        const limit = Math.min(Math.max(1, rawLimit), maxHistoryLimit);
        try {
          await loadAgentHistoryViaDomainApi(agentId, limit);
        } catch (error) {
          if (!isDisconnectLikeError(error)) {
            console.error("Failed to load domain runtime history.", error);
          }
        }
        return;
      }
      const commands = await runHistorySyncOperation({
        client,
        agentId,
        requestedLimit: options?.limit,
        getAgent: (targetAgentId) =>
          agentsRef.current.find((entry) => entry.agentId === targetAgentId) ?? null,
        inFlightSessionKeys: historyInFlightRef.current,
        requestId: randomUUID(),
        loadedAt: Date.now(),
        defaultLimit: defaultHistoryLimit,
        maxLimit: maxHistoryLimit,
        transcriptV2Enabled: TRANSCRIPT_V2_ENABLED,
      });
      executeHistorySyncCommands({
        commands,
        dispatch,
        logMetric: (metric, meta) => logTranscriptDebugMetric(metric, meta),
        isDisconnectLikeError,
        logError: (message, error) => console.error(message, error),
      });
    },
    [
      client,
      defaultHistoryLimit,
      dispatch,
      isDisconnectLikeError,
      loadAgentHistoryViaDomainApi,
      maxHistoryLimit,
      useDomainApiReads,
    ]
  );

  const loadMoreAgentHistory = useCallback(
    (agentId: string) => {
      if (useDomainApiReads) {
        const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
        const nextLimit = resolveRuntimeSyncLoadMoreHistoryLimit({
          currentLimit: agent?.historyFetchLimit ?? null,
          defaultLimit: defaultHistoryLimit,
          maxLimit: maxHistoryLimit,
        });
        void loadAgentHistory(agentId, { limit: nextLimit });
        return;
      }
      const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
      const nextLimit = resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: agent?.historyFetchLimit ?? null,
        defaultLimit: defaultHistoryLimit,
        maxLimit: maxHistoryLimit,
      });
      void loadAgentHistory(agentId, { limit: nextLimit });
    },
    [defaultHistoryLimit, loadAgentHistory, maxHistoryLimit, useDomainApiReads]
  );

  const reconcileRunningAgents = useCallback(async () => {
    if (status !== "connected") return;
    if (useDomainApiReads) return;
    const commands = await runAgentReconcileOperation({
      client,
      agents: agentsRef.current,
      getLatestAgent: (agentId) =>
        agentsRef.current.find((entry) => entry.agentId === agentId) ?? null,
      claimRunId: (runId) => {
        const normalized = runId.trim();
        if (!normalized) return false;
        if (reconcileRunInFlightRef.current.has(normalized)) return false;
        reconcileRunInFlightRef.current.add(normalized);
        return true;
      },
      releaseRunId: (runId) => {
        const normalized = runId.trim();
        if (!normalized) return;
        reconcileRunInFlightRef.current.delete(normalized);
      },
      isDisconnectLikeError,
    });
    executeAgentReconcileCommands({
      commands,
      dispatch,
      clearRunTracking,
      requestHistoryRefresh: (agentId) => {
        void loadAgentHistory(agentId);
      },
      logInfo: (message) => console.info(message),
      logWarn: (message, error) => console.warn(message, error),
    });
  }, [
    clearRunTracking,
    client,
    dispatch,
    isDisconnectLikeError,
    loadAgentHistory,
    status,
    useDomainApiReads,
  ]);

  useEffect(() => {
    if (status !== "connected") return;
    void loadSummarySnapshot();
  }, [loadSummarySnapshot, status]);

  useEffect(() => {
    const reconcileIntent = resolveRuntimeSyncReconcilePollingIntent({
      status,
    });
    if (reconcileIntent.kind === "stop") return;
    void reconcileRunningAgents();
    const timer = window.setInterval(() => {
      void reconcileRunningAgents();
    }, reconcileIntent.intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [reconcileRunningAgents, status]);

  useEffect(() => {
    const bootstrapAgentIds = resolveRuntimeSyncBootstrapHistoryAgentIds({
      status,
      agents,
    });
    if (useDomainApiReads) {
      const normalizedFocusedAgentId = focusedAgentId?.trim() ?? "";
      if (!normalizedFocusedAgentId) return;
      if (!bootstrapAgentIds.includes(normalizedFocusedAgentId)) return;
      void loadAgentHistory(normalizedFocusedAgentId);
      return;
    }
    for (const agentId of bootstrapAgentIds) {
      void loadAgentHistory(agentId);
    }
  }, [agents, focusedAgentId, loadAgentHistory, status, useDomainApiReads]);

  useEffect(() => {
    const pollingIntent = resolveRuntimeSyncFocusedHistoryPollingIntent({
      status,
      focusedAgentId,
      focusedAgentRunning,
    });
    if (pollingIntent.kind === "stop") return;
    void loadAgentHistory(pollingIntent.agentId);
    const timer = window.setInterval(() => {
      const shouldContinue = shouldRuntimeSyncContinueFocusedHistoryPolling({
        agentId: pollingIntent.agentId,
        agents: agentsRef.current,
      });
      if (!shouldContinue) return;
      void loadAgentHistory(pollingIntent.agentId);
    }, pollingIntent.intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [focusedAgentId, focusedAgentRunning, loadAgentHistory, status]);

  useEffect(() => {
    if (useDomainApiReads) return;
    if (!client.onGap) return;
    return client.onGap((info) => {
      const recoveryIntent = resolveRuntimeSyncGapRecoveryIntent();
      console.warn(`Gateway event gap expected ${info.expected}, received ${info.received}.`);
      if (recoveryIntent.refreshSummarySnapshot) {
        void loadSummarySnapshot();
      }
      if (recoveryIntent.reconcileRunningAgents) {
        void reconcileRunningAgents();
      }
    });
  }, [client, loadSummarySnapshot, reconcileRunningAgents, useDomainApiReads]);

  return {
    loadSummarySnapshot,
    loadAgentHistory,
    loadMoreAgentHistory,
    reconcileRunningAgents,
    clearHistoryInFlight,
  };
}
