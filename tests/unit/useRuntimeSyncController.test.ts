import { createElement, useEffect } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRuntimeSyncController } from "@/features/agents/operations/useRuntimeSyncController";
import type { AgentState } from "@/features/agents/state/store";
import type { DomainAgentHistoryResult } from "@/lib/controlplane/domain-runtime-client";

import { hydrateDomainHistoryWindow } from "@/features/agents/operations/domainHistoryHydration";
import { loadDomainAgentHistoryWindow } from "@/lib/controlplane/domain-runtime-client";
import { fetchJson } from "@/lib/http";

vi.mock("@/features/agents/operations/domainHistoryHydration", () => ({
  hydrateDomainHistoryWindow: vi.fn(),
}));

vi.mock("@/lib/controlplane/domain-runtime-client", () => ({
  loadDomainAgentHistoryWindow: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  fetchJson: vi.fn(),
}));

const createAgent = (overrides?: Partial<AgentState>): AgentState => ({
  agentId: "agent-1",
  name: "Agent One",
  sessionKey: "agent:agent-1:main",
  status: "idle",
  sessionCreated: true,
  awaitingUserInput: false,
  hasUnseenActivity: false,
  outputLines: [],
  lastResult: null,
  lastDiff: null,
  runId: null,
  runStartedAt: null,
  streamText: null,
  thinkingTrace: null,
  latestOverride: null,
  latestOverrideKind: null,
  lastAssistantMessageAt: null,
  lastActivityAt: null,
  latestPreview: null,
  lastUserMessage: null,
  draft: "",
  sessionSettingsSynced: true,
  historyLoadedAt: null,
  historyFetchLimit: null,
  historyFetchedCount: null,
  historyMaybeTruncated: false,
  historyHasMore: false,
  historyGatewayCapReached: false,
  toolCallingEnabled: true,
  showThinkingTraces: true,
  model: "openai/gpt-5",
  thinkingLevel: "medium",
  avatarSeed: "seed-1",
  avatarUrl: null,
  ...(overrides ?? {}),
});

type RuntimeSyncControllerValue = ReturnType<typeof useRuntimeSyncController>;

type RenderControllerContext = {
  getValue: () => RuntimeSyncControllerValue;
  rerenderWith: (overrides: Partial<Parameters<typeof useRuntimeSyncController>[0]>) => void;
  unmount: () => void;
  dispatch: ReturnType<typeof vi.fn>;
};

const renderController = (
  overrides?: Partial<Parameters<typeof useRuntimeSyncController>[0]>
): RenderControllerContext => {
  const dispatch = vi.fn();

  let currentParams: Parameters<typeof useRuntimeSyncController>[0] = {
    status: "connected",
    agents: [createAgent({ historyLoadedAt: 1000 })],
    focusedAgentId: null,
    dispatch,
    isDisconnectLikeError: () => false,
    ...(overrides ?? {}),
  };

  const valueRef: { current: RuntimeSyncControllerValue | null } = { current: null };

  const Probe = ({
    params,
    onValue,
  }: {
    params: Parameters<typeof useRuntimeSyncController>[0];
    onValue: (value: RuntimeSyncControllerValue) => void;
  }) => {
    const value = useRuntimeSyncController(params);
    useEffect(() => {
      onValue(value);
    }, [onValue, value]);
    return createElement("div", { "data-testid": "probe" }, "ok");
  };

  const rendered = render(
    createElement(Probe, {
      params: currentParams,
      onValue: (value) => {
        valueRef.current = value;
      },
    })
  );

  return {
    getValue: () => {
      if (!valueRef.current) {
        throw new Error("runtime sync controller value unavailable");
      }
      return valueRef.current;
    },
    rerenderWith: (nextOverrides) => {
      currentParams = {
        ...currentParams,
        ...nextOverrides,
      };
      rendered.rerender(
        createElement(Probe, {
          params: currentParams,
          onValue: (value) => {
            valueRef.current = value;
          },
        })
      );
    },
    unmount: () => {
      rendered.unmount();
    },
    dispatch,
  };
};

const createHistoryResult = (): DomainAgentHistoryResult => ({
  enabled: true,
  agentId: "agent-1",
  view: "semantic",
  messages: [],
  hasMore: false,
  semanticTurnsIncluded: 0,
  windowTruncated: false,
  gatewayLimit: 200,
  gatewayCapped: false,
});

describe("useRuntimeSyncController", () => {
  const mockedLoadDomainAgentHistoryWindow = vi.mocked(loadDomainAgentHistoryWindow);
  const mockedHydrateDomainHistoryWindow = vi.mocked(hydrateDomainHistoryWindow);
  const mockedFetchJson = vi.mocked(fetchJson);

  beforeEach(() => {
    mockedLoadDomainAgentHistoryWindow.mockReset();
    mockedHydrateDomainHistoryWindow.mockReset();
    mockedFetchJson.mockReset();

    mockedLoadDomainAgentHistoryWindow.mockResolvedValue(createHistoryResult());
    mockedHydrateDomainHistoryWindow.mockReturnValue({ historyLoadedAt: 1000 });
    mockedFetchJson.mockResolvedValue({ summary: {}, freshness: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads summary snapshot when connected", async () => {
    renderController({
      status: "connected",
      agents: [createAgent({ historyLoadedAt: 1234 })],
      focusedAgentId: null,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockedFetchJson).toHaveBeenCalledWith("/api/runtime/summary", {
      cache: "no-store",
    });
  });

  it("bootstraps focused agent history when connected and history is missing", async () => {
    renderController({
      status: "connected",
      agents: [createAgent({ historyLoadedAt: null })],
      focusedAgentId: "agent-1",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedLoadDomainAgentHistoryWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        view: "semantic",
      })
    );
  });

  it("loads domain history, hydrates it, and dispatches update", async () => {
    const ctx = renderController({
      status: "disconnected",
      agents: [createAgent({ historyLoadedAt: null })],
      focusedAgentId: null,
      defaultHistoryLimit: 50,
      maxHistoryLimit: 300,
    });

    mockedHydrateDomainHistoryWindow.mockReturnValue({
      outputLines: ["restored"],
      historyLoadedAt: 555,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 500, reason: "refresh" });
    });

    expect(mockedLoadDomainAgentHistoryWindow).toHaveBeenCalledWith({
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      view: "semantic",
      turnLimit: 300,
      scanLimit: 300,
    });
    expect(mockedHydrateDomainHistoryWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.any(String),
        requestedLimit: 300,
        view: "semantic",
        reason: "refresh",
      })
    );
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: "agent-1",
      patch: {
        outputLines: ["restored"],
        historyLoadedAt: 555,
      },
    });
  });

  it("dedupes in-flight history requests by session key", async () => {
    let resolveHistory!: (value: DomainAgentHistoryResult) => void;
    const historyPromise = new Promise<DomainAgentHistoryResult>((resolve) => {
      resolveHistory = resolve;
    });
    mockedLoadDomainAgentHistoryWindow.mockReturnValue(historyPromise);

    const ctx = renderController({
      status: "disconnected",
      agents: [createAgent({ historyLoadedAt: null })],
      focusedAgentId: null,
    });

    const first = ctx.getValue().loadAgentHistory("agent-1");
    const second = ctx.getValue().loadAgentHistory("agent-1");
    await second;

    expect(mockedLoadDomainAgentHistoryWindow).toHaveBeenCalledTimes(1);

    resolveHistory(createHistoryResult());
    await first;
  });

  it("allows manual clear of in-flight key to force a second request", async () => {
    let resolveHistory!: (value: DomainAgentHistoryResult) => void;
    const historyPromise = new Promise<DomainAgentHistoryResult>((resolve) => {
      resolveHistory = resolve;
    });
    mockedLoadDomainAgentHistoryWindow.mockReturnValue(historyPromise);

    const ctx = renderController({
      status: "disconnected",
      agents: [createAgent({ historyLoadedAt: null, sessionKey: "agent:agent-1:main" })],
      focusedAgentId: null,
    });

    void ctx.getValue().loadAgentHistory("agent-1");
    act(() => {
      ctx.getValue().clearHistoryInFlight("agent:agent-1:main");
    });
    void ctx.getValue().loadAgentHistory("agent-1");

    expect(mockedLoadDomainAgentHistoryWindow).toHaveBeenCalledTimes(2);

    resolveHistory(createHistoryResult());
  });

  it("clears session history cache when clearing in-flight state", async () => {
    const ctx = renderController({
      status: "disconnected",
      agents: [createAgent({ historyLoadedAt: null, sessionKey: "agent:agent-1:main" })],
      focusedAgentId: null,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { reason: "bootstrap" });
    });
    expect(mockedLoadDomainAgentHistoryWindow).toHaveBeenCalledTimes(1);

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { reason: "bootstrap" });
    });
    expect(mockedLoadDomainAgentHistoryWindow).toHaveBeenCalledTimes(1);

    act(() => {
      ctx.getValue().clearHistoryInFlight("agent:agent-1:main");
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { reason: "bootstrap" });
    });
    expect(mockedLoadDomainAgentHistoryWindow).toHaveBeenCalledTimes(2);
  });

  it("grows history limit when loading more history", async () => {
    const ctx = renderController({
      status: "disconnected",
      agents: [
        createAgent({
          historyLoadedAt: 1234,
          historyMaybeTruncated: true,
          historyFetchLimit: 200,
        }),
      ],
      focusedAgentId: null,
      defaultHistoryLimit: 50,
      maxHistoryLimit: 500,
    });

    await act(async () => {
      ctx.getValue().loadMoreAgentHistory("agent-1");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedLoadDomainAgentHistoryWindow).toHaveBeenCalledWith({
      agentId: "agent-1",
      sessionKey: "agent:agent-1:main",
      view: "semantic",
      turnLimit: 400,
      scanLimit: 500,
    });
  });

  it("skips load-more when history is not truncated", async () => {
    const ctx = renderController({
      status: "disconnected",
      agents: [createAgent({ historyLoadedAt: 1234, historyMaybeTruncated: false })],
      focusedAgentId: null,
    });

    await act(async () => {
      ctx.getValue().loadMoreAgentHistory("agent-1");
      await Promise.resolve();
    });

    expect(mockedLoadDomainAgentHistoryWindow).not.toHaveBeenCalled();
  });

  it("skips load-more when gateway cap has been reached", async () => {
    const ctx = renderController({
      status: "disconnected",
      agents: [
        createAgent({
          historyLoadedAt: 1234,
          historyMaybeTruncated: true,
          historyGatewayCapReached: true,
          historyFetchLimit: 1000,
        }),
      ],
      focusedAgentId: null,
    });

    await act(async () => {
      ctx.getValue().loadMoreAgentHistory("agent-1");
      await Promise.resolve();
    });

    expect(mockedLoadDomainAgentHistoryWindow).not.toHaveBeenCalled();
  });
});
