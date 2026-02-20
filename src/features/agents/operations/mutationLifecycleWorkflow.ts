import type { GatewayStatus } from "@/features/agents/operations/gatewayRestartPolicy";

export type MutationKind = "create-agent" | "rename-agent" | "delete-agent";

export type MutationBlockPhase = "queued" | "mutating" | "awaiting-restart";

export type MutationBlockState = {
  kind: MutationKind;
  agentId: string;
  agentName: string;
  phase: MutationBlockPhase;
  startedAt: number;
  sawDisconnect: boolean;
};

export type MutationStartGuardResult =
  | { kind: "allow" }
  | {
      kind: "deny";
      reason: "not-connected" | "create-block-active" | "rename-block-active" | "delete-block-active";
    };

export const resolveMutationStartGuard = (params: {
  status: "connected" | "connecting" | "disconnected";
  hasCreateBlock: boolean;
  hasRenameBlock: boolean;
  hasDeleteBlock: boolean;
}): MutationStartGuardResult => {
  if (params.status !== "connected") {
    return { kind: "deny", reason: "not-connected" };
  }
  if (params.hasCreateBlock) {
    return { kind: "deny", reason: "create-block-active" };
  }
  if (params.hasRenameBlock) {
    return { kind: "deny", reason: "rename-block-active" };
  }
  if (params.hasDeleteBlock) {
    return { kind: "deny", reason: "delete-block-active" };
  }
  return { kind: "allow" };
};

export const buildQueuedMutationBlock = (params: {
  kind: MutationKind;
  agentId: string;
  agentName: string;
  startedAt: number;
}): MutationBlockState => {
  return {
    kind: params.kind,
    agentId: params.agentId,
    agentName: params.agentName,
    phase: "queued",
    startedAt: params.startedAt,
    sawDisconnect: false,
  };
};

export const buildMutatingMutationBlock = (block: MutationBlockState): MutationBlockState => {
  return {
    ...block,
    phase: "mutating",
  };
};

export type MutationPostRunIntent =
  | { kind: "clear" }
  | { kind: "awaiting-restart"; patch: { phase: "awaiting-restart"; sawDisconnect: boolean } };

export const resolveMutationPostRunIntent = (params: {
  disposition: "completed" | "awaiting-restart";
}): MutationPostRunIntent => {
  if (params.disposition === "awaiting-restart") {
    return {
      kind: "awaiting-restart",
      patch: {
        phase: "awaiting-restart",
        sawDisconnect: false,
      },
    };
  }
  return { kind: "clear" };
};

export type MutationSideEffectCommand =
  | { kind: "reload-agents" }
  | { kind: "clear-mutation-block" }
  | { kind: "set-mobile-pane"; pane: "chat" }
  | { kind: "patch-mutation-block"; patch: { phase: "awaiting-restart"; sawDisconnect: boolean } };

export const buildMutationSideEffectCommands = (params: {
  disposition: "completed" | "awaiting-restart";
}): MutationSideEffectCommand[] => {
  const postRunIntent = resolveMutationPostRunIntent({
    disposition: params.disposition,
  });
  if (postRunIntent.kind === "clear") {
    return [
      { kind: "reload-agents" },
      { kind: "clear-mutation-block" },
      { kind: "set-mobile-pane", pane: "chat" },
    ];
  }
  return [{ kind: "patch-mutation-block", patch: postRunIntent.patch }];
};

export type MutationTimeoutIntent =
  | { kind: "none" }
  | { kind: "timeout"; reason: "create-timeout" | "rename-timeout" | "delete-timeout" };

const resolveTimeoutReason = (
  kind: MutationKind
): "create-timeout" | "rename-timeout" | "delete-timeout" => {
  if (kind === "create-agent") {
    return "create-timeout";
  }
  if (kind === "rename-agent") {
    return "rename-timeout";
  }
  return "delete-timeout";
};

export const resolveMutationTimeoutIntent = (params: {
  block: MutationBlockState | null;
  nowMs: number;
  maxWaitMs: number;
}): MutationTimeoutIntent => {
  if (!params.block) {
    return { kind: "none" };
  }
  const elapsed = params.nowMs - params.block.startedAt;
  if (elapsed < params.maxWaitMs) {
    return { kind: "none" };
  }
  return {
    kind: "timeout",
    reason: resolveTimeoutReason(params.block.kind),
  };
};

export type MutationWorkflowKind = "rename-agent" | "delete-agent";

export type MutationWorkflowResult = {
  disposition: "completed" | "awaiting-restart";
};

export type AwaitingRestartPatch = {
  phase: "awaiting-restart";
  sawDisconnect: boolean;
};

export type MutationWorkflowPostRunEffects = {
  shouldReloadAgents: boolean;
  shouldClearBlock: boolean;
  awaitingRestartPatch: AwaitingRestartPatch | null;
};

export type MutationWorkflowDeps = {
  executeMutation: () => Promise<void>;
  shouldAwaitRemoteRestart: () => Promise<boolean>;
};

export type MutationStatusBlock = {
  phase: "queued" | "mutating" | "awaiting-restart";
  sawDisconnect: boolean;
};

type MutationFailureMessageByKind = Record<MutationWorkflowKind, string>;

const FALLBACK_MUTATION_FAILURE_MESSAGE: MutationFailureMessageByKind = {
  "rename-agent": "Failed to rename agent.",
  "delete-agent": "Failed to delete agent.",
};

const assertMutationKind = (kind: string): MutationWorkflowKind => {
  if (kind === "rename-agent" || kind === "delete-agent") {
    return kind;
  }
  throw new Error(`Unknown config mutation kind: ${kind}`);
};

export const runConfigMutationWorkflow = async (
  params: { kind: MutationWorkflowKind; isLocalGateway: boolean },
  deps: MutationWorkflowDeps
): Promise<MutationWorkflowResult> => {
  assertMutationKind(params.kind);
  await deps.executeMutation();
  if (params.isLocalGateway) {
    return { disposition: "completed" };
  }
  const shouldAwaitRestart = await deps.shouldAwaitRemoteRestart();
  return {
    disposition: shouldAwaitRestart ? "awaiting-restart" : "completed",
  };
};

export const buildConfigMutationFailureMessage = (params: {
  kind: MutationWorkflowKind;
  error: unknown;
}): string => {
  const fallback = FALLBACK_MUTATION_FAILURE_MESSAGE[params.kind];
  if (params.error instanceof Error) {
    return params.error.message || fallback;
  }
  return fallback;
};

export const resolveConfigMutationStatusLine = (params: {
  block: MutationStatusBlock | null;
  status: GatewayStatus;
  mutatingLabel?: string;
}): string | null => {
  const { block, status } = params;
  if (!block) return null;
  if (block.phase === "queued") {
    return "Waiting for active runs to finish";
  }
  if (block.phase === "mutating") {
    return params.mutatingLabel ?? "Submitting config change";
  }
  if (!block.sawDisconnect) {
    return "Waiting for gateway to restart";
  }
  return status === "connected"
    ? "Gateway is back online, syncing agents"
    : "Gateway restart in progress";
};

export const buildAwaitingRestartPatch = (): AwaitingRestartPatch => {
  return {
    phase: "awaiting-restart",
    sawDisconnect: false,
  };
};

export const resolveConfigMutationPostRunEffects = (
  result: MutationWorkflowResult
): MutationWorkflowPostRunEffects => {
  const commands = buildMutationSideEffectCommands({
    disposition: result.disposition,
  });
  let shouldReloadAgents = false;
  let shouldClearBlock = false;
  let awaitingRestartPatch: AwaitingRestartPatch | null = null;
  for (const command of commands) {
    if (command.kind === "reload-agents") {
      shouldReloadAgents = true;
      continue;
    }
    if (command.kind === "clear-mutation-block") {
      shouldClearBlock = true;
      continue;
    }
    if (command.kind === "patch-mutation-block") {
      awaitingRestartPatch = command.patch;
    }
  }
  return {
    shouldReloadAgents,
    shouldClearBlock,
    awaitingRestartPatch,
  };
};
