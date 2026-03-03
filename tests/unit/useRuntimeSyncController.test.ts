import { createElement, useEffect } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRuntimeSyncController } from "@/features/agents/operations/useRuntimeSyncController";
import type { AgentState } from "@/features/agents/state/store";

import {
  executeAgentReconcileCommands,
  runAgentReconcileOperation,
} from "@/features/agents/operations/agentReconcileOperation";
import {
  executeHistorySyncCommands,
  runHistorySyncOperation,
} from "@/features/agents/operations/historySyncOperation";
import type { GatewayGapInfo } from "@/lib/gateway/GatewayClient";

vi.mock("@/features/agents/operations/historySyncOperation", () => ({
  runHistorySyncOperation: vi.fn(async () => []),
  executeHistorySyncCommands: vi.fn(),
}));

vi.mock("@/features/agents/operations/agentReconcileOperation", () => ({
  runAgentReconcileOperation: vi.fn(async () => []),
  executeAgentReconcileCommands: vi.fn(),
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
  rerenderWith: (
    overrides: Partial<Parameters<typeof useRuntimeSyncController>[0]>
  ) => void;
  unmount: () => void;
  dispatch: ReturnType<typeof vi.fn>;
  clearRunTracking: ReturnType<typeof vi.fn>;
  call: ReturnType<typeof vi.fn>;
  onGap: ReturnType<typeof vi.fn>;
  getGapHandler: () => ((info: GatewayGapInfo) => void) | null;
  unsubscribeGap: ReturnType<typeof vi.fn>;
};

const renderController = (
  overrides?: Partial<Parameters<typeof useRuntimeSyncController>[0]>
): RenderControllerContext => {
  const dispatch = vi.fn();
  const clearRunTracking = vi.fn();
  const call = vi.fn(async (method: string) => {
    if (method === "status") {
      return { sessions: { recent: [], byAgent: [] } };
    }
    if (method === "sessions.preview") {
      return { ts: 123, previews: [] };
    }
    return {};
  });
  let gapHandler: ((info: GatewayGapInfo) => void) | null = null;
  const unsubscribeGap = vi.fn();
  const onGap = vi.fn((handler: (info: GatewayGapInfo) => void) => {
    gapHandler = handler;
    return unsubscribeGap;
  });

  const currentParamsBase: Omit<
    Parameters<typeof useRuntimeSyncController>[0],
    "useDomainApiReads"
  > = {
    client: {
      call,
      onGap,
    } as never,
    status: "connected",
    agents: [createAgent({ status: "running", historyLoadedAt: 1000, runId: "run-1" })],
    focusedAgentId: null,
    focusedAgentRunning: false,
    dispatch,
    clearRunTracking,
    isDisconnectLikeError: () => false,
    defaultHistoryLimit: 200,
    maxHistoryLimit: 5000,
    ...(overrides ?? {}),
  };
  let currentParams: Parameters<typeof useRuntimeSyncController>[0] = {
    ...currentParamsBase,
    useDomainApiReads: overrides?.useDomainApiReads ?? false,
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
        useDomainApiReads: nextOverrides.useDomainApiReads ?? currentParams.useDomainApiReads,
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
    clearRunTracking,
    call,
    onGap,
    getGapHandler: () => gapHandler,
    unsubscribeGap,
  };
};

describe("useRuntimeSyncController", () => {
  const mockedRunHistorySyncOperation = vi.mocked(runHistorySyncOperation);
  const mockedExecuteHistorySyncCommands = vi.mocked(executeHistorySyncCommands);
  const mockedRunAgentReconcileOperation = vi.mocked(runAgentReconcileOperation);
  const mockedExecuteAgentReconcileCommands = vi.mocked(executeAgentReconcileCommands);

  beforeEach(() => {
    vi.useFakeTimers();
    mockedRunHistorySyncOperation.mockReset();
    mockedRunHistorySyncOperation.mockResolvedValue([]);
    mockedExecuteHistorySyncCommands.mockReset();
    mockedRunAgentReconcileOperation.mockReset();
    mockedRunAgentReconcileOperation.mockResolvedValue([]);
    mockedExecuteAgentReconcileCommands.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("runs reconcile immediately and every 3000ms while connected then cleans up", async () => {
    const ctx = renderController({
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2999);
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3000);
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(3);

    ctx.unmount();
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(3);
  });

  it("polls focused running history every 4500ms and stops when focus no longer running", async () => {
    const ctx = renderController({
      agents: [createAgent({ status: "running", historyLoadedAt: 1234 })],
      focusedAgentId: "agent-1",
      focusedAgentRunning: true,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedRunHistorySyncOperation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4500);
    expect(mockedRunHistorySyncOperation).toHaveBeenCalledTimes(2);

    ctx.rerenderWith({
      agents: [createAgent({ status: "idle", historyLoadedAt: 1234 })],
      focusedAgentId: "agent-1",
      focusedAgentRunning: false,
    });

    await vi.advanceTimersByTimeAsync(9000);
    expect(mockedRunHistorySyncOperation).toHaveBeenCalledTimes(2);
  });

  it("bootstraps history only for connected sessions missing loaded history", async () => {
    renderController({
      status: "connected",
      focusedAgentId: null,
      focusedAgentRunning: false,
      agents: [
        createAgent({ agentId: "agent-1", sessionCreated: true, historyLoadedAt: null }),
        createAgent({ agentId: "agent-2", sessionCreated: true, historyLoadedAt: 1234 }),
        createAgent({ agentId: "agent-3", sessionCreated: false, historyLoadedAt: null }),
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const bootstrappedAgentIds = mockedRunHistorySyncOperation.mock.calls
      .map(([arg]) => (arg as { agentId: string }).agentId)
      .filter((agentId) => agentId === "agent-1" || agentId === "agent-2" || agentId === "agent-3");

    expect(bootstrappedAgentIds).toContain("agent-1");
    expect(bootstrappedAgentIds).not.toContain("agent-2");
    expect(bootstrappedAgentIds).not.toContain("agent-3");
  });

  it("in domain mode bootstraps missing history only for the focused agent", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/summary")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            summary: { status: "connected", reason: null, asOf: null, outboxHead: 0 },
            freshness: { source: "controlplane", stale: false, asOf: null, reason: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/api/runtime/agents/")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [],
            hasMore: false,
            nextBeforeOutboxId: null,
            semanticTurnsIncluded: 0,
            windowTruncated: false,
            activeRun: {
              runId: null,
              status: "idle",
              complete: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderController({
      status: "connected",
      useDomainApiReads: true,
      focusedAgentId: "agent-2",
      focusedAgentRunning: false,
      agents: [
        createAgent({ agentId: "agent-1", sessionKey: "agent:agent-1:main", historyLoadedAt: null }),
        createAgent({ agentId: "agent-2", sessionKey: "agent:agent-2:main", historyLoadedAt: null }),
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const historyCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/api/runtime/agents/"));
    expect(historyCalls.some((url) => url.includes("/api/runtime/agents/agent-2/history"))).toBe(true);
    expect(historyCalls.some((url) => url.includes("/api/runtime/agents/agent-1/history"))).toBe(false);

    vi.unstubAllGlobals();
  });

  it("loads summary snapshot when status transitions to connected", async () => {
    const ctx = renderController({
      status: "disconnected",
      focusedAgentId: null,
      focusedAgentRunning: false,
      agents: [createAgent({ sessionCreated: true, historyLoadedAt: 1234 })],
    });

    expect(ctx.call).not.toHaveBeenCalledWith("status", {});

    ctx.rerenderWith({ status: "connected" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(ctx.call).toHaveBeenCalledWith("status", {});
    expect(ctx.call).toHaveBeenCalledWith("sessions.preview", {
      keys: ["agent:agent-1:main"],
      limit: 8,
      maxChars: 240,
    });
  });

  it("handles gap recovery by triggering summary refresh and reconcile", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = renderController({
      agents: [createAgent({ status: "running", historyLoadedAt: 1234, runId: "run-1" })],
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(ctx.onGap).toHaveBeenCalledTimes(1);
    const handler = ctx.getGapHandler();
    if (!handler) {
      throw new Error("expected gap handler to be registered");
    }

    mockedRunAgentReconcileOperation.mockClear();
    ctx.call.mockClear();

    await act(async () => {
      handler({ expected: 10, received: 11 });
      await Promise.resolve();
    });
    expect(ctx.call).toHaveBeenCalledWith("status", {});
    expect(ctx.call).toHaveBeenCalledWith("sessions.preview", {
      keys: ["agent:agent-1:main"],
      limit: 8,
      maxChars: 240,
    });
    expect(mockedRunAgentReconcileOperation).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("Gateway event gap expected 10, received 11.");
  });

  it("unsubscribes gap listener on unmount", () => {
    const ctx = renderController();
    ctx.unmount();
    expect(ctx.unsubscribeGap).toHaveBeenCalledTimes(1);
  });

  it("clears history in-flight tracking when requested", async () => {
    const inFlightSeen: boolean[] = [];
    mockedRunHistorySyncOperation.mockImplementation(
      async ({ agentId, getAgent, inFlightSessionKeys }) => {
        const agent = getAgent(agentId);
        if (!agent) return [];
        const sessionKey = agent.sessionKey;
        inFlightSeen.push(inFlightSessionKeys.has(sessionKey));
        inFlightSessionKeys.add(sessionKey);
        return [];
      }
    );

    const ctx = renderController({
      status: "disconnected",
      agents: [createAgent({ sessionKey: "agent:agent-1:main", historyLoadedAt: null })],
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1");
    });
    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1");
    });
    act(() => {
      ctx.getValue().clearHistoryInFlight("agent:agent-1:main");
    });
    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1");
    });

    expect(inFlightSeen).toEqual([false, true, false]);
  });

  it("uses domain runtime APIs and expands semantic transcript limit for load-more", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/summary")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            summary: { status: "connected", reason: null, asOf: null, outboxHead: 0 },
            freshness: { source: "controlplane", stale: false, asOf: null, reason: null },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [],
            hasMore: true,
            nextBeforeOutboxId: null,
            semanticTurnsIncluded: 2,
            windowTruncated: true,
            activeRun: {
              runId: null,
              status: "idle",
              complete: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 2 })],
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: "agent-1",
      patch: expect.objectContaining({
        historyFetchLimit: 2,
        historyFetchedCount: 2,
        historyMaybeTruncated: true,
      }),
    });

    await act(async () => {
      ctx.getValue().loadMoreAgentHistory("agent-1");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/runtime/agents/agent-1/history?limit=400&view=semantic&turnLimit=50&scanLimit=800"
      ),
      expect.anything()
    );

    expect(ctx.call).not.toHaveBeenCalledWith("status", {});
    vi.unstubAllGlobals();
    ctx.unmount();
  });

  it("hydrates semantic domain history through history sync so user turns can be restored", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [
              {
                id: 6,
                event: {
                  type: "gateway.event",
                  event: "chat",
                  seq: 6,
                  payload: {
                    runId: "run-1",
                    sessionKey: "agent:agent-1:main",
                    state: "final",
                    message: { role: "assistant", content: "assistant only outbox turn" },
                  },
                  asOf: "2026-03-01T00:00:06.000Z",
                },
                createdAt: "2026-03-01T00:00:06.000Z",
              },
            ],
            hasMore: false,
            nextBeforeOutboxId: null,
            semanticTurnsIncluded: 1,
            windowTruncated: false,
            activeRun: {
              runId: null,
              status: "idle",
              complete: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    mockedRunHistorySyncOperation.mockResolvedValue([
      {
        kind: "dispatchUpdateAgent",
        agentId: "agent-1",
        patch: {
          outputLines: ["> user turn restored from transcript", "assistant response"],
          lastUserMessage: "user turn restored from transcript",
        },
      },
    ]);
    mockedExecuteHistorySyncCommands.mockImplementation(
      ({ commands, dispatch }: { commands: Array<{ kind: string; agentId?: string; patch?: unknown }>; dispatch: (action: { type: "updateAgent"; agentId: string; patch: Partial<AgentState> }) => void }) => {
        for (const command of commands) {
          if (command.kind !== "dispatchUpdateAgent") continue;
          if (typeof command.agentId !== "string") continue;
          if (!command.patch || typeof command.patch !== "object") continue;
          dispatch({
            type: "updateAgent",
            agentId: command.agentId,
            patch: command.patch as Partial<AgentState>,
          });
        }
      }
    );

    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 2 })],
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });

    expect(mockedRunHistorySyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        requestedLimit: 2,
        transcriptV2Enabled: expect.any(Boolean),
        allowTranscriptRevisionSkew: true,
      })
    );
    expect(mockedExecuteHistorySyncCommands).toHaveBeenCalledTimes(1);
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: "agent-1",
      patch: expect.objectContaining({
        outputLines: ["> user turn restored from transcript", "assistant response"],
        lastUserMessage: "user turn restored from transcript",
      }),
    });

    vi.unstubAllGlobals();
    ctx.unmount();
  });

  it("clamps domain transcript hydration requests to gateway chat.history max limit", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [
              {
                id: 6,
                event: {
                  type: "gateway.event",
                  event: "chat",
                  seq: 6,
                  payload: {
                    runId: "run-1",
                    sessionKey: "agent:agent-1:main",
                    state: "final",
                    message: { role: "assistant", content: "assistant only outbox turn" },
                  },
                  asOf: "2026-03-01T00:00:06.000Z",
                },
                createdAt: "2026-03-01T00:00:06.000Z",
              },
            ],
            hasMore: false,
            nextBeforeOutboxId: null,
            semanticTurnsIncluded: 1,
            windowTruncated: false,
            activeRun: {
              runId: null,
              status: "idle",
              complete: true,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/api/runtime/chat-history")) {
        return new Response(
          JSON.stringify({
            ok: true,
            payload: {
              sessionKey: "agent:agent-1:main",
              messages: [{ role: "user", content: "restored user turn" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    mockedRunHistorySyncOperation.mockImplementation(async (params) => {
      await params.client.call("chat.history", {
        sessionKey: "agent:agent-1:main",
        limit: 5_000,
      });
      return [];
    });

    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 5_000 })],
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 5_000 });
    });

    expect(mockedRunHistorySyncOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        requestedLimit: 1_000,
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/runtime/agents/agent-1/history?limit=1000&view=semantic&turnLimit=50&scanLimit=800"
      ),
      expect.anything()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/runtime/chat-history?sessionKey=agent%3Aagent-1%3Amain&limit=1000"),
      expect.anything()
    );
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: "updateAgent",
      agentId: "agent-1",
      patch: expect.objectContaining({
        historyFetchLimit: 1_000,
      }),
    });

    vi.unstubAllGlobals();
    ctx.unmount();
  });

  it("does not request raw outbox backfill pages during semantic domain history loads", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [],
            hasMore: true,
            nextBeforeOutboxId: 10,
            semanticTurnsIncluded: 0,
            windowTruncated: true,
            activeRun: {
              runId: "run-1",
              status: "running",
              complete: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 2 })],
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });

    const historyCalls = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes("/api/runtime/agents/agent-1/history"));
    expect(historyCalls.some((url) => url.includes("view=semantic"))).toBe(true);
    expect(historyCalls.some((url) => url.includes("view=raw"))).toBe(false);

    vi.unstubAllGlobals();
    ctx.unmount();
  });

  it("does not replay outbox history entries through ingest callback", async () => {
    let historyCallCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/runtime/agents/agent-1/history")) {
        historyCallCount += 1;
        if (historyCallCount === 1) {
          return new Response(
            JSON.stringify({
              enabled: true,
              entries: [
                {
                  id: 5,
                  event: {
                    type: "gateway.event",
                    event: "runtime.delta",
                    seq: 5,
                    payload: { sessionKey: "agent:agent-1:main", delta: "old" },
                    asOf: "2026-03-01T00:00:05.000Z",
                  },
                  createdAt: "2026-03-01T00:00:05.000Z",
                },
              ],
              hasMore: false,
              nextBeforeOutboxId: null,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            enabled: true,
            entries: [
              {
                id: 5,
                event: {
                  type: "gateway.event",
                  event: "runtime.delta",
                  seq: 5,
                  payload: { sessionKey: "agent:agent-1:main", delta: "new" },
                  asOf: "2026-03-02T00:00:05.000Z",
                },
                createdAt: "2026-03-02T00:00:05.000Z",
              },
            ],
            hasMore: false,
            nextBeforeOutboxId: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const ctx = renderController({
      status: "disconnected",
      useDomainApiReads: true,
      agents: [createAgent({ historyFetchLimit: 2 })],
      focusedAgentId: null,
      focusedAgentRunning: false,
    });

    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });
    await act(async () => {
      await ctx.getValue().loadAgentHistory("agent-1", { limit: 2 });
    });

    vi.unstubAllGlobals();
    ctx.unmount();
  });
});
