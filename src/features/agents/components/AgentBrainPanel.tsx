"use client";

import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentState } from "@/features/agents/state/store";
import {
  AGENT_FILE_META,
  AGENT_FILE_NAMES,
  AGENT_FILE_PLACEHOLDERS,
  type AgentFileName,
} from "@/lib/agents/agentFiles";
import { useAgentFilesEditor } from "@/features/agents/state/useAgentFilesEditor";

type AgentBrainPanelProps = {
  agents: AgentState[];
  selectedAgentId: string | null;
  onClose: () => void;
};

export const AgentBrainPanel = ({
  agents,
  selectedAgentId,
  onClose,
}: AgentBrainPanelProps) => {
  const selectedAgent = useMemo(
    () =>
      selectedAgentId
        ? agents.find((entry) => entry.agentId === selectedAgentId) ?? null
        : null,
    [agents, selectedAgentId]
  );

  const {
    agentFiles,
    agentFileTab,
    agentFilesLoading,
    agentFilesSaving,
    agentFilesDirty,
    agentFilesError,
    setAgentFileContent,
    handleAgentFileTabChange,
    saveAgentFiles,
  } = useAgentFilesEditor(selectedAgent?.sessionKey ?? null);
  const [previewMode, setPreviewMode] = useState(true);

  const handleTabChange = useCallback(
    async (nextTab: AgentFileName) => {
      await handleAgentFileTabChange(nextTab);
    },
    [handleAgentFileTabChange]
  );

  const handleClose = useCallback(async () => {
    if (agentFilesSaving) return;
    if (agentFilesDirty) {
      const saved = await saveAgentFiles();
      if (!saved) return;
    }
    onClose();
  }, [agentFilesDirty, agentFilesSaving, onClose, saveAgentFiles]);

  return (
    <div
      className="agent-inspect-panel flex min-h-0 flex-col overflow-hidden"
      data-testid="agent-brain-panel"
      style={{ position: "relative", left: "auto", top: "auto", width: "100%", height: "100%" }}
    >
      <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Brain files
          </div>
          <div className="console-title text-2xl leading-none text-foreground">
            {selectedAgent?.name ?? "No agent selected"}
          </div>
        </div>
        <button
          className="rounded-md border border-border/80 bg-card/70 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition hover:border-border hover:bg-muted/65"
          type="button"
          data-testid="agent-brain-close"
          disabled={agentFilesSaving}
          onClick={() => {
            void handleClose();
          }}
        >
          Close
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-4">
        <section className="flex min-h-0 flex-1 flex-col" data-testid="agent-brain-files">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {AGENT_FILE_META[agentFileTab].hint}
            </div>
          </div>
          {agentFilesError ? (
            <div className="mt-3 rounded-md border border-destructive bg-destructive px-3 py-2 text-xs text-destructive-foreground">
              {agentFilesError}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            {AGENT_FILE_NAMES.map((name) => {
              const active = name === agentFileTab;
              const label = AGENT_FILE_META[name].title.replace(".md", "");
              return (
                <button
                  key={name}
                  type="button"
                  className={`rounded-full border px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                    active
                      ? "border-border bg-background text-foreground shadow-sm"
                      : "border-transparent bg-muted/60 text-muted-foreground hover:border-border/80 hover:bg-muted"
                  }`}
                  onClick={() => {
                    void handleTabChange(name);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-end gap-1">
            <button
              type="button"
              className={`rounded-md border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                previewMode
                  ? "border-border bg-background text-foreground"
                  : "border-border/70 bg-card/60 text-muted-foreground hover:bg-muted/70"
              }`}
              onClick={() => setPreviewMode(true)}
            >
              Preview
            </button>
            <button
              type="button"
              className={`rounded-md border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
                previewMode
                  ? "border-border/70 bg-card/60 text-muted-foreground hover:bg-muted/70"
                  : "border-border bg-background text-foreground"
              }`}
              onClick={() => setPreviewMode(false)}
            >
              Edit
            </button>
          </div>

          <div className="mt-3 min-h-0 flex-1 rounded-md bg-muted/30 p-2">
            {previewMode ? (
              <div className="agent-markdown h-full overflow-y-auto rounded-md border border-border/80 bg-background/80 px-3 py-2 text-xs text-foreground">
                {agentFiles[agentFileTab].content.trim().length === 0 ? (
                  <p className="text-muted-foreground">{AGENT_FILE_PLACEHOLDERS[agentFileTab]}</p>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {agentFiles[agentFileTab].content}
                  </ReactMarkdown>
                )}
              </div>
            ) : (
              <textarea
                className="h-full min-h-0 w-full resize-none overflow-y-auto rounded-md border border-border/80 bg-background/80 px-3 py-2 font-mono text-xs text-foreground outline-none"
                value={agentFiles[agentFileTab].content}
                placeholder={
                  agentFiles[agentFileTab].content.trim().length === 0
                    ? AGENT_FILE_PLACEHOLDERS[agentFileTab]
                    : undefined
                }
                disabled={agentFilesLoading || agentFilesSaving}
                onChange={(event) => {
                  setAgentFileContent(event.target.value);
                }}
              />
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 pt-2">
            <div className="text-xs text-muted-foreground">All changes saved</div>
          </div>
        </section>
      </div>
    </div>
  );
};
