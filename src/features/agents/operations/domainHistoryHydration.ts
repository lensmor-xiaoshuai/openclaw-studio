import {
  buildHistoryLines,
  resolveHistoryRunStatePatch,
} from "@/features/agents/state/runtimeEventBridge";
import type { AgentState } from "@/features/agents/state/store";
import {
  areTranscriptEntriesEqual,
  buildOutputLinesFromTranscriptEntries,
  buildTranscriptEntriesFromLines,
  mergeTranscriptEntriesWithHistory,
  type TranscriptEntry,
} from "@/features/agents/state/transcript";
import type {
  DomainAgentHistoryResult,
  DomainAgentHistoryView,
} from "@/lib/controlplane/domain-runtime-client";
import { normalizeAssistantDisplayText } from "@/lib/text/assistantText";

const areStringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const ensureTranscriptEntries = (agent: AgentState): TranscriptEntry[] => {
  if (Array.isArray(agent.transcriptEntries)) {
    return agent.transcriptEntries;
  }
  return buildTranscriptEntriesFromLines({
    lines: agent.outputLines,
    sessionKey: agent.sessionKey,
    source: "legacy",
    startSequence: 0,
    confirmed: true,
  });
};

type HydrateDomainHistoryWindowParams = {
  agent: AgentState;
  history: DomainAgentHistoryResult;
  loadedAt: number;
  requestId: string;
  requestedLimit?: number;
  view: DomainAgentHistoryView;
  reason: "bootstrap" | "load-more" | "refresh";
};

export const hydrateDomainHistoryWindow = (
  params: HydrateDomainHistoryWindowParams
): Partial<AgentState> => {
  const historyMessages = params.history.messages;
  const history = buildHistoryLines(historyMessages);

  const existingEntries = ensureTranscriptEntries(params.agent);
  const historyEntryPrefix = `domain-history:${params.agent.agentId}:${params.requestId}`;
  const historyEntries = buildTranscriptEntriesFromLines({
    lines: history.lines,
    sessionKey: params.agent.sessionKey,
    source: "history",
    startSequence: params.agent.transcriptSequenceCounter ?? existingEntries.length,
    confirmed: true,
    entryIdPrefix: historyEntryPrefix,
  });

  const merged = mergeTranscriptEntriesWithHistory({
    existingEntries,
    historyEntries,
  });
  const nextEntries = merged.entries;
  const nextLines = buildOutputLinesFromTranscriptEntries(nextEntries);

  const transcriptChanged = !areTranscriptEntriesEqual(existingEntries, nextEntries);
  const outputChanged = !areStringArraysEqual(params.agent.outputLines, nextLines);

  const runPatch =
    params.reason === "load-more"
      ? null
      : resolveHistoryRunStatePatch({
          status: params.agent.status,
          runId: params.agent.runId,
          lastRole: history.lastRole,
          lastUserAt: history.lastUserAt,
          loadedAt: params.loadedAt,
        });

  const normalizedLastAssistant = history.lastAssistant
    ? normalizeAssistantDisplayText(history.lastAssistant)
    : null;

  return {
    ...(transcriptChanged || outputChanged
      ? {
          transcriptEntries: nextEntries,
          outputLines: nextLines,
        }
      : {}),
    historyLoadedAt: params.loadedAt,
    historyFetchLimit:
      typeof params.requestedLimit === "number" && Number.isFinite(params.requestedLimit)
        ? params.requestedLimit
        : params.agent.historyFetchLimit,
    historyFetchedCount:
      params.view === "semantic"
        ? params.history.semanticTurnsIncluded
        : params.history.messages.length,
    historyMaybeTruncated: params.history.windowTruncated,
    historyHasMore: params.history.hasMore,
    historyGatewayCapReached: params.history.gatewayCapped && params.history.windowTruncated,
    lastAppliedHistoryRequestId: params.requestId,
    ...(normalizedLastAssistant ? { lastResult: normalizedLastAssistant } : {}),
    ...(normalizedLastAssistant ? { latestPreview: normalizedLastAssistant } : {}),
    ...(typeof history.lastAssistantAt === "number"
      ? { lastAssistantMessageAt: history.lastAssistantAt }
      : {}),
    ...(history.lastUser ? { lastUserMessage: history.lastUser } : {}),
    ...(runPatch ?? {}),
  };
};
