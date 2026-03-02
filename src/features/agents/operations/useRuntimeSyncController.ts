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
  ingestDomainOutboxEntries: (entries: ControlPlaneOutboxEntry[]) => void;
  defaultHistoryLimit?: number;
  maxHistoryLimit?: number;
};

type RuntimeSyncController = {
  loadSummarySnapshot: () => Promise<void>;
  loadAgentHistory: (
    agentId: string,
    options?: { limit?: number; beforeOutboxId?: number }
  ) => Promise<void>;
  loadMoreAgentHistory: (agentId: string) => void;
  reconcileRunningAgents: () => Promise<void>;
  clearHistoryInFlight: (sessionKey: string) => void;
};

type DomainAgentHistoryResponse = {
  entries?: unknown[];
  hasMore?: unknown;
  nextBeforeOutboxId?: unknown;
};

const MAX_DOMAIN_HISTORY_DEDUPE_KEYS = 20_000;

const resolveDomainOutboxDedupeKey = (entry: ControlPlaneOutboxEntry): string | null => {
  const entryId = typeof entry?.id === "number" && Number.isFinite(entry.id) ? entry.id : null;
  if (entryId === null) return null;
  const createdAt = typeof entry.createdAt === "string" ? entry.createdAt.trim() : "";
  return `${entryId}:${createdAt}`;
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
    ingestDomainOutboxEntries,
  } = params;
  const agentsRef = useRef(agents);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const reconcileRunInFlightRef = useRef<Set<string>>(new Set());
  const domainHistoryCursorByAgentRef = useRef<Map<string, number | null>>(new Map());
  const seenDomainOutboxKeysRef = useRef<Set<string>>(new Set());
  const seenDomainOutboxKeyOrderRef = useRef<string[]>([]);

  const defaultHistoryLimit = params.defaultHistoryLimit ?? RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT;
  const maxHistoryLimit = params.maxHistoryLimit ?? RUNTIME_SYNC_MAX_HISTORY_LIMIT;

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
    async (agentId: string, limit: number, beforeOutboxId?: number) => {
      const encodedAgentId = encodeURIComponent(agentId.trim());
      if (!encodedAgentId) return;
      const query = new URLSearchParams();
      query.set("limit", String(limit));
      if (
        typeof beforeOutboxId === "number" &&
        Number.isFinite(beforeOutboxId) &&
        beforeOutboxId > 0
      ) {
        query.set("beforeOutboxId", String(Math.floor(beforeOutboxId)));
      }
      const result = await fetchJson<DomainAgentHistoryResponse>(
        `/api/runtime/agents/${encodedAgentId}/history?${query.toString()}`,
        { cache: "no-store" }
      );
      const entries = Array.isArray(result.entries) ? (result.entries as ControlPlaneOutboxEntry[]) : [];
      const unseen: ControlPlaneOutboxEntry[] = [];
      for (const entry of entries) {
        const dedupeKey = resolveDomainOutboxDedupeKey(entry);
        if (!dedupeKey) continue;
        if (seenDomainOutboxKeysRef.current.has(dedupeKey)) continue;
        seenDomainOutboxKeysRef.current.add(dedupeKey);
        seenDomainOutboxKeyOrderRef.current.push(dedupeKey);
        unseen.push(entry);
      }
      if (seenDomainOutboxKeyOrderRef.current.length > MAX_DOMAIN_HISTORY_DEDUPE_KEYS) {
        const overflow = seenDomainOutboxKeyOrderRef.current.length - MAX_DOMAIN_HISTORY_DEDUPE_KEYS;
        const dropped = seenDomainOutboxKeyOrderRef.current.splice(0, overflow);
        for (const key of dropped) {
          seenDomainOutboxKeysRef.current.delete(key);
        }
      }
      if (unseen.length > 0) {
        ingestDomainOutboxEntries(unseen);
      }
      const hasMore = result.hasMore === true;
      const nextBeforeOutboxId =
        typeof result.nextBeforeOutboxId === "number" &&
        Number.isFinite(result.nextBeforeOutboxId) &&
        result.nextBeforeOutboxId > 0
          ? Math.floor(result.nextBeforeOutboxId)
          : null;
      const normalizedAgentId = agentId.trim();
      if (normalizedAgentId) {
        domainHistoryCursorByAgentRef.current.set(normalizedAgentId, nextBeforeOutboxId);
      }
      dispatch({
        type: "updateAgent",
        agentId,
        patch: {
          historyLoadedAt: Date.now(),
          historyFetchLimit: limit,
          historyFetchedCount: entries.length,
          historyMaybeTruncated: hasMore,
        },
      });
    },
    [dispatch, ingestDomainOutboxEntries]
  );

  const loadAgentHistory = useCallback(
    async (agentId: string, options?: { limit?: number; beforeOutboxId?: number }) => {
      if (useDomainApiReads) {
        const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
        const limit =
          typeof options?.limit === "number" && Number.isFinite(options.limit)
            ? Math.max(1, Math.floor(options.limit))
            : agent?.historyFetchLimit ?? defaultHistoryLimit;
        const beforeOutboxId =
          typeof options?.beforeOutboxId === "number" && Number.isFinite(options.beforeOutboxId)
            ? Math.max(1, Math.floor(options.beforeOutboxId))
            : undefined;
        try {
          await loadAgentHistoryViaDomainApi(agentId, limit, beforeOutboxId);
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
        const limit = agent?.historyFetchLimit ?? defaultHistoryLimit;
        const beforeOutboxId = domainHistoryCursorByAgentRef.current.get(agentId) ?? null;
        if (beforeOutboxId === null) return;
        void loadAgentHistory(agentId, { limit, beforeOutboxId });
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
    for (const agentId of bootstrapAgentIds) {
      void loadAgentHistory(agentId);
    }
  }, [agents, loadAgentHistory, status]);

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
