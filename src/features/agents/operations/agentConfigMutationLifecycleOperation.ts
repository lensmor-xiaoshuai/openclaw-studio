import {
  buildConfigMutationFailureMessage,
  runConfigMutationWorkflow,
  type MutationWorkflowKind,
  buildMutationSideEffectCommands,
} from "@/features/agents/operations/mutationLifecycleWorkflow";
import type { ConfigMutationKind } from "@/features/agents/operations/useConfigMutationQueue";

export type AgentConfigMutationLifecycleKind = MutationWorkflowKind;

export type AgentConfigMutationLifecycleDeps = {
  enqueueConfigMutation: (params: {
    kind: ConfigMutationKind;
    label: string;
    run: () => Promise<void>;
  }) => Promise<void>;
  setQueuedBlock: () => void;
  setMutatingBlock: () => void;
  patchBlockAwaitingRestart: (patch: { phase: "awaiting-restart"; sawDisconnect: boolean }) => void;
  clearBlock: () => void;
  executeMutation: () => Promise<void>;
  shouldAwaitRemoteRestart: () => Promise<boolean>;
  reloadAgents: () => Promise<void>;
  setMobilePaneChat: () => void;
  onError: (message: string) => void;
};

export const runAgentConfigMutationLifecycle = async (params: {
  kind: AgentConfigMutationLifecycleKind;
  label: string;
  isLocalGateway: boolean;
  deps: AgentConfigMutationLifecycleDeps;
}): Promise<boolean> => {
  params.deps.setQueuedBlock();
  try {
    await params.deps.enqueueConfigMutation({
      kind: params.kind,
      label: params.label,
      run: async () => {
        params.deps.setMutatingBlock();
        const result = await runConfigMutationWorkflow(
          { kind: params.kind, isLocalGateway: params.isLocalGateway },
          {
            executeMutation: params.deps.executeMutation,
            shouldAwaitRemoteRestart: params.deps.shouldAwaitRemoteRestart,
          }
        );
        const commands = buildMutationSideEffectCommands({
          disposition: result.disposition,
        });
        for (const command of commands) {
          if (command.kind === "reload-agents") {
            await params.deps.reloadAgents();
            continue;
          }
          if (command.kind === "clear-mutation-block") {
            params.deps.clearBlock();
            continue;
          }
          if (command.kind === "set-mobile-pane") {
            params.deps.setMobilePaneChat();
            continue;
          }
          params.deps.patchBlockAwaitingRestart(command.patch);
        }
      },
    });
    return true;
  } catch (error) {
    params.deps.clearBlock();
    params.deps.onError(
      buildConfigMutationFailureMessage({
        kind: params.kind,
        error,
      })
    );
    return false;
  }
};
