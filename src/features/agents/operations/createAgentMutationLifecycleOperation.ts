import type { AgentCreateModalSubmitPayload } from "@/features/agents/creation/types";
import {
  resolveMutationStartGuard,
  resolveMutationTimeoutIntent,
} from "@/features/agents/operations/agentMutationLifecycleController";
import type { ConfigMutationKind } from "@/features/agents/operations/useConfigMutationQueue";

export type CreateAgentBlockState = {
  agentName: string;
  phase: "queued" | "creating";
  startedAt: number;
};

export type CreateAgentLifecycleCompletion = {
  agentId: string;
  agentName: string;
};

export type CreateAgentMutationLifecycleDeps = {
  enqueueConfigMutation: (params: {
    kind: ConfigMutationKind;
    label: string;
    run: () => Promise<void>;
  }) => Promise<void>;
  createAgent: (name: string, avatarSeed: string | null) => Promise<{ id: string }>;
  setQueuedBlock: (params: { agentName: string; startedAt: number }) => void;
  setCreatingBlock: (agentName: string) => void;
  onCompletion: (completion: CreateAgentLifecycleCompletion) => Promise<void> | void;
  setCreateAgentModalError: (message: string | null) => void;
  setCreateAgentBusy: (busy: boolean) => void;
  clearCreateBlock: () => void;
  onError: (message: string) => void;
  now?: () => number;
};

export const runCreateAgentMutationLifecycle = async (
  params: {
    payload: AgentCreateModalSubmitPayload;
    status: "connected" | "connecting" | "disconnected";
    hasCreateBlock: boolean;
    hasRenameBlock: boolean;
    hasDeleteBlock: boolean;
    createAgentBusy: boolean;
  },
  deps: CreateAgentMutationLifecycleDeps
): Promise<boolean> => {
  if (params.createAgentBusy) return false;
  const guard = resolveMutationStartGuard({
    status: params.status,
    hasCreateBlock: params.hasCreateBlock,
    hasRenameBlock: params.hasRenameBlock,
    hasDeleteBlock: params.hasDeleteBlock,
  });
  if (guard.kind === "deny") {
    if (guard.reason === "not-connected") {
      deps.setCreateAgentModalError("Connect to gateway before creating an agent.");
    }
    return false;
  }

  const name = params.payload.name.trim();
  if (!name) {
    deps.setCreateAgentModalError("Agent name is required.");
    return false;
  }

  deps.setCreateAgentBusy(true);
  deps.setCreateAgentModalError(null);
  const startedAt = (deps.now ?? Date.now)();
  deps.setQueuedBlock({ agentName: name, startedAt });
  const avatarSeed = params.payload.avatarSeed?.trim() ?? null;
  try {
    const queuedMutation = deps.enqueueConfigMutation({
      kind: "create-agent",
      label: `Create ${name}`,
      run: async () => {
        deps.setCreatingBlock(name);
        const created = await deps.createAgent(name, avatarSeed);
        await deps.onCompletion({
          agentId: created.id,
          agentName: name,
        });
      },
    });
    await queuedMutation;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create agent.";
    deps.clearCreateBlock();
    deps.setCreateAgentModalError(message);
    deps.onError(message);
    return false;
  } finally {
    deps.setCreateAgentBusy(false);
  }
};

export const isCreateBlockTimedOut = (params: {
  block: CreateAgentBlockState | null;
  nowMs: number;
  maxWaitMs: number;
}): boolean => {
  if (!params.block || params.block.phase === "queued") {
    return false;
  }
  const timeoutIntent = resolveMutationTimeoutIntent({
    block: {
      kind: "create-agent",
      agentId: "",
      agentName: params.block.agentName,
      phase: "mutating",
      startedAt: params.block.startedAt,
      sawDisconnect: false,
    },
    nowMs: params.nowMs,
    maxWaitMs: params.maxWaitMs,
  });
  return timeoutIntent.kind === "timeout" && timeoutIntent.reason === "create-timeout";
};
