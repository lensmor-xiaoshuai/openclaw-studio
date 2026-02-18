import { describe, expect, it } from "vitest";

import {
  buildMutationSideEffectCommands,
  buildMutatingMutationBlock,
  buildQueuedMutationBlock,
  resolveMutationPostRunIntent,
  resolveMutationStartGuard,
  resolveMutationTimeoutIntent,
} from "@/features/agents/operations/agentMutationLifecycleController";

describe("agentMutationLifecycleController", () => {
  it("blocks mutation starts when another mutation block is active", () => {
    expect(
      resolveMutationStartGuard({
        status: "disconnected",
        hasCreateBlock: false,
        hasRenameBlock: false,
        hasDeleteBlock: false,
      })
    ).toEqual({ kind: "deny", reason: "not-connected" });

    expect(
      resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: true,
        hasRenameBlock: false,
        hasDeleteBlock: false,
      })
    ).toEqual({ kind: "deny", reason: "create-block-active" });

    expect(
      resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: false,
        hasRenameBlock: true,
        hasDeleteBlock: false,
      })
    ).toEqual({ kind: "deny", reason: "rename-block-active" });

    expect(
      resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: false,
        hasRenameBlock: false,
        hasDeleteBlock: true,
      })
    ).toEqual({ kind: "deny", reason: "delete-block-active" });

    expect(
      resolveMutationStartGuard({
        status: "connected",
        hasCreateBlock: false,
        hasRenameBlock: false,
        hasDeleteBlock: false,
      })
    ).toEqual({ kind: "allow" });
  });

  it("builds deterministic queued and mutating block transitions", () => {
    const queued = buildQueuedMutationBlock({
      kind: "rename-agent",
      agentId: "agent-1",
      agentName: "Agent One",
      startedAt: 123,
    });

    expect(queued).toEqual({
      kind: "rename-agent",
      agentId: "agent-1",
      agentName: "Agent One",
      phase: "queued",
      startedAt: 123,
      sawDisconnect: false,
    });

    expect(buildMutatingMutationBlock(queued)).toEqual({
      ...queued,
      phase: "mutating",
    });
  });

  it("resolves post-mutation block outcomes for completed vs awaiting-restart", () => {
    expect(resolveMutationPostRunIntent({ disposition: "completed" })).toEqual({
      kind: "clear",
    });

    expect(resolveMutationPostRunIntent({ disposition: "awaiting-restart" })).toEqual({
      kind: "awaiting-restart",
      patch: {
        phase: "awaiting-restart",
        sawDisconnect: false,
      },
    });
  });

  it("builds typed side-effect commands for completed and awaiting-restart dispositions", () => {
    expect(buildMutationSideEffectCommands({ disposition: "completed" })).toEqual([
      { kind: "reload-agents" },
      { kind: "clear-mutation-block" },
      { kind: "set-mobile-pane", pane: "chat" },
    ]);

    expect(buildMutationSideEffectCommands({ disposition: "awaiting-restart" })).toEqual([
      {
        kind: "patch-mutation-block",
        patch: { phase: "awaiting-restart", sawDisconnect: false },
      },
    ]);
  });

  it("returns timeout intent when mutation block exceeds max wait", () => {
    expect(
      resolveMutationTimeoutIntent({
        block: null,
        nowMs: 10_000,
        maxWaitMs: 90_000,
      })
    ).toEqual({ kind: "none" });

    const createBlock = buildQueuedMutationBlock({
      kind: "create-agent",
      agentId: "agent-1",
      agentName: "A",
      startedAt: 1_000,
    });
    const renameBlock = buildQueuedMutationBlock({
      kind: "rename-agent",
      agentId: "agent-1",
      agentName: "A",
      startedAt: 1_000,
    });
    const deleteBlock = buildQueuedMutationBlock({
      kind: "delete-agent",
      agentId: "agent-1",
      agentName: "A",
      startedAt: 1_000,
    });

    expect(
      resolveMutationTimeoutIntent({
        block: createBlock,
        nowMs: 91_000,
        maxWaitMs: 90_000,
      })
    ).toEqual({ kind: "timeout", reason: "create-timeout" });

    expect(
      resolveMutationTimeoutIntent({
        block: renameBlock,
        nowMs: 91_000,
        maxWaitMs: 90_000,
      })
    ).toEqual({ kind: "timeout", reason: "rename-timeout" });

    expect(
      resolveMutationTimeoutIntent({
        block: deleteBlock,
        nowMs: 91_000,
        maxWaitMs: 90_000,
      })
    ).toEqual({ kind: "timeout", reason: "delete-timeout" });

    expect(
      resolveMutationTimeoutIntent({
        block: createBlock,
        nowMs: 50_000,
        maxWaitMs: 90_000,
      })
    ).toEqual({ kind: "none" });
  });
});
