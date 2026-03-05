import { useCallback, useEffect, useRef } from "react";

import { hydrateDomainHistoryWindow } from "@/features/agents/operations/domainHistoryHydration";
import {
  RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT,
  RUNTIME_SYNC_MAX_HISTORY_LIMIT,
  resolveRuntimeSyncBootstrapHistoryAgentIds,
  resolveRuntimeSyncLoadMoreHistoryLimit,
} from "@/features/agents/operations/runtimeSyncControlWorkflow";
import type { AgentState } from "@/features/agents/state/store";
import { logTranscriptDebugMetric } from "@/features/agents/state/transcript";
import {
  loadDomainAgentHistoryWindow,
  type DomainAgentHistoryResult,
} from "@/lib/controlplane/domain-runtime-client";
import { fetchJson } from "@/lib/http";
import { randomUUID } from "@/lib/uuid";

type RuntimeSyncDispatchAction = {
  type: "updateAgent";
  agentId: string;
  patch: Partial<AgentState>;
};

type HistoryLoadReason = "bootstrap" | "load-more" | "refresh";

type UseRuntimeSyncControllerParams = {
  status: "disconnected" | "connecting" | "connected";
  agents: AgentState[];
  focusedAgentId: string | null;
  dispatch: (action: RuntimeSyncDispatchAction) => void;
  isDisconnectLikeError: (error: unknown) => boolean;
  defaultHistoryLimit?: number;
  maxHistoryLimit?: number;
};

type RuntimeSyncController = {
  loadSummarySnapshot: () => Promise<void>;
  loadAgentHistory: (
    agentId: string,
    options?: { limit?: number; reason?: HistoryLoadReason }
  ) => Promise<void>;
  loadMoreAgentHistory: (agentId: string) => void;
  reconcileRunningAgents: () => Promise<void>;
  clearHistoryInFlight: (sessionKey: string) => void;
};

type HistoryCacheEntry = {
  requestedLimit: number;
  fetchedAt: number;
  history: DomainAgentHistoryResult;
};

const resolveScanLimitForReason = (params: {
  reason: HistoryLoadReason;
  requestedLimit: number;
  maxHistoryLimit: number;
}): number => {
  const floor =
    params.reason === "bootstrap" ? 200 : params.reason === "load-more" ? 400 : 300;
  return Math.min(params.maxHistoryLimit, Math.max(floor, params.requestedLimit * 3));
};

export function useRuntimeSyncController(
  params: UseRuntimeSyncControllerParams
): RuntimeSyncController {
  const { status, agents, focusedAgentId, dispatch, isDisconnectLikeError } = params;
  const agentsRef = useRef(agents);
  const historyInFlightRef = useRef<Set<string>>(new Set());
  const historyCacheRef = useRef<Map<string, HistoryCacheEntry>>(new Map());

  const defaultHistoryLimit = params.defaultHistoryLimit ?? RUNTIME_SYNC_DEFAULT_HISTORY_LIMIT;
  const maxHistoryLimit = params.maxHistoryLimit ?? RUNTIME_SYNC_MAX_HISTORY_LIMIT;

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const clearHistoryInFlight = useCallback((sessionKey: string) => {
    const key = sessionKey.trim();
    if (!key) return;
    historyInFlightRef.current.delete(key);
    historyCacheRef.current.delete(key);
  }, []);

  const loadSummarySnapshot = useCallback(async () => {
    try {
      await fetchJson<{ summary?: unknown; freshness?: unknown }>("/api/runtime/summary", {
        cache: "no-store",
      });
    } catch (error) {
      if (!isDisconnectLikeError(error)) {
        console.error("Failed to load domain runtime summary.", error);
      }
    }
  }, [isDisconnectLikeError]);

  const loadAgentHistory = useCallback(
    async (
      agentId: string,
      options?: { limit?: number; reason?: HistoryLoadReason }
    ) => {
      const targetAgent =
        agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
      if (!targetAgent || !targetAgent.sessionCreated) return;
      const sessionKey = targetAgent.sessionKey.trim();
      if (!sessionKey) return;
      if (historyInFlightRef.current.has(sessionKey)) return;

      const reason = options?.reason ?? "refresh";
      const requestedLimitRaw =
        typeof options?.limit === "number" && Number.isFinite(options.limit)
          ? Math.floor(options.limit)
          : defaultHistoryLimit;
      const requestedLimit = Math.max(1, Math.min(maxHistoryLimit, requestedLimitRaw));

      if (
        reason === "load-more" &&
        targetAgent.historyGatewayCapReached &&
        typeof targetAgent.historyFetchLimit === "number" &&
        requestedLimit <= targetAgent.historyFetchLimit
      ) {
        logTranscriptDebugMetric("history_load_skipped_gateway_cap", {
          agentId,
          sessionKey,
          reason,
          requestedLimit,
        });
        return;
      }

      historyInFlightRef.current.add(sessionKey);
      const requestId = randomUUID();
      const loadedAt = Date.now();
      const requestStartedAt = Date.now();
      logTranscriptDebugMetric("history_load_start", {
        agentId,
        sessionKey,
        reason,
        requestedLimit,
        requestId,
      });

      try {
        let history: DomainAgentHistoryResult;
        let fromCache = false;
        let fetchDurationMs = 0;

        const cached = historyCacheRef.current.get(sessionKey);
        const canUseCache =
          reason !== "refresh" &&
          cached &&
          cached.requestedLimit >= requestedLimit;

        if (canUseCache) {
          history = cached.history;
          fromCache = true;
        } else {
          const fetchStartedAt = Date.now();
          history = await loadDomainAgentHistoryWindow({
            agentId,
            sessionKey,
            view: "semantic",
            turnLimit: requestedLimit,
            scanLimit: resolveScanLimitForReason({
              reason,
              requestedLimit,
              maxHistoryLimit,
            }),
          });
          fetchDurationMs = Date.now() - fetchStartedAt;
          historyCacheRef.current.set(sessionKey, {
            requestedLimit,
            fetchedAt: Date.now(),
            history,
          });
        }

        const latest =
          agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
        if (!latest) return;

        const hydrateStartedAt = Date.now();
        const patch = hydrateDomainHistoryWindow({
          agent: latest,
          history,
          loadedAt,
          requestId,
          requestedLimit,
          view: "semantic",
          reason,
        });
        const hydrateDurationMs = Date.now() - hydrateStartedAt;

        dispatch({
          type: "updateAgent",
          agentId,
          patch,
        });

        logTranscriptDebugMetric("history_load_finish", {
          agentId,
          sessionKey,
          reason,
          requestedLimit,
          requestId,
          fromCache,
          fetchDurationMs,
          hydrateDurationMs,
          totalDurationMs: Date.now() - requestStartedAt,
          messageCount: history.messages.length,
          semanticTurnsIncluded: history.semanticTurnsIncluded,
          windowTruncated: history.windowTruncated,
          gatewayLimit: history.gatewayLimit,
          gatewayCapped: history.gatewayCapped,
        });
      } catch (error) {
        if (!isDisconnectLikeError(error)) {
          console.error("Failed to load domain runtime history.", error);
        }
      } finally {
        historyInFlightRef.current.delete(sessionKey);
      }
    },
    [defaultHistoryLimit, dispatch, isDisconnectLikeError, maxHistoryLimit]
  );

  const loadMoreAgentHistory = useCallback(
    (agentId: string) => {
      const agent = agentsRef.current.find((entry) => entry.agentId === agentId) ?? null;
      if (!agent?.historyMaybeTruncated) return;
      if (agent.historyGatewayCapReached) return;

      const nextLimit = resolveRuntimeSyncLoadMoreHistoryLimit({
        currentLimit: agent.historyFetchLimit,
        defaultLimit: defaultHistoryLimit,
        maxLimit: maxHistoryLimit,
      });

      if (
        typeof agent.historyFetchLimit === "number" &&
        nextLimit <= agent.historyFetchLimit &&
        agent.historyFetchLimit >= maxHistoryLimit
      ) {
        dispatch({
          type: "updateAgent",
          agentId,
          patch: {
            historyGatewayCapReached: true,
          },
        });
        logTranscriptDebugMetric("history_load_more_skipped_reached_max_limit", {
          agentId,
          currentLimit: agent.historyFetchLimit,
          maxHistoryLimit,
        });
        return;
      }

      void loadAgentHistory(agentId, {
        limit: nextLimit,
        reason: "load-more",
      });
    },
    [defaultHistoryLimit, dispatch, loadAgentHistory, maxHistoryLimit]
  );

  const reconcileRunningAgents = useCallback(async () => {
    return;
  }, []);

  useEffect(() => {
    if (status !== "connected") return;
    void loadSummarySnapshot();
  }, [loadSummarySnapshot, status]);

  useEffect(() => {
    const bootstrapAgentIds = resolveRuntimeSyncBootstrapHistoryAgentIds({
      status,
      agents,
    });
    const normalizedFocusedAgentId = focusedAgentId?.trim() ?? "";
    if (!normalizedFocusedAgentId) return;
    if (!bootstrapAgentIds.includes(normalizedFocusedAgentId)) return;
    void loadAgentHistory(normalizedFocusedAgentId, { reason: "bootstrap" });
  }, [agents, focusedAgentId, loadAgentHistory, status]);

  return {
    loadSummarySnapshot,
    loadAgentHistory,
    loadMoreAgentHistory,
    reconcileRunningAgents,
    clearHistoryInFlight,
  };
}
