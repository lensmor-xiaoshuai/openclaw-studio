"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Shuffle } from "lucide-react";
import type { AgentCreateModalSubmitPayload } from "@/features/agents/creation/types";
import { AgentAvatar } from "@/features/agents/components/AgentAvatar";
import { randomUUID } from "@/lib/uuid";

type AgentCreateModalProps = {
  open: boolean;
  suggestedName: string;
  busy?: boolean;
  submitError?: string | null;
  onClose: () => void;
  onSubmit: (payload: AgentCreateModalSubmitPayload) => Promise<void> | void;
};

const fieldClassName =
  "w-full rounded-md border border-border/80 bg-surface-3 px-3 py-2 text-xs text-foreground outline-none";
const labelClassName =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

const resolveInitialName = (suggestedName: string): string => {
  const trimmed = suggestedName.trim();
  if (!trimmed) return "New Agent";
  return trimmed;
};

export const AgentCreateModal = ({
  open,
  suggestedName,
  busy = false,
  submitError = null,
  onClose,
  onSubmit,
}: AgentCreateModalProps) => {
  const initialName = useMemo(() => resolveInitialName(suggestedName), [suggestedName]);
  const [name, setName] = useState(initialName);
  const [avatarSeed, setAvatarSeed] = useState(() => randomUUID());
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(initialName);
      setAvatarSeed(randomUUID());
    }
    wasOpenRef.current = open;
  }, [initialName, open]);

  const canSubmit = name.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit || busy) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;
    void onSubmit({ name: trimmedName, avatarSeed });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-background/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create agent"
      onClick={busy ? undefined : onClose}
    >
      <form
        className="w-full max-w-2xl rounded-lg border border-border bg-card"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        onClick={(event) => event.stopPropagation()}
        data-testid="agent-create-modal"
      >
        <div className="flex items-center justify-between border-b border-border/80 px-5 py-4">
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              New Agent
            </div>
            <div className="mt-1 text-base font-semibold text-foreground">Launch Agent</div>
            <div className="mt-1 text-xs text-muted-foreground">Name it and activate immediately.</div>
          </div>
          <button
            type="button"
            className="rounded-md border border-border/80 bg-surface-3 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:border-border hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="grid gap-4 px-5 py-4">
          <label className={labelClassName}>
            Agent name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={`mt-1 ${fieldClassName}`}
              placeholder="My agent"
            />
          </label>
          <div className="-mt-2 text-[11px] text-muted-foreground">
            You can rename this agent later in settings.
          </div>
          <div className="grid justify-items-center gap-2 border-t border-border/70 pt-3">
            <div className={labelClassName}>Choose avatar</div>
            <AgentAvatar
              seed={avatarSeed}
              name={name.trim() || "New Agent"}
              size={64}
              isSelected
            />
            <button
              type="button"
              aria-label="Shuffle avatar selection"
              className="inline-flex items-center gap-2 rounded-md border border-border/80 bg-surface-3 px-3 py-2 text-xs text-muted-foreground transition hover:border-border hover:bg-surface-2"
              onClick={() => setAvatarSeed(randomUUID())}
              disabled={busy}
            >
              <Shuffle className="h-3.5 w-3.5" />
              Shuffle
            </button>
          </div>

          {submitError ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/12 px-3 py-2 text-xs text-destructive">
              {submitError}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border/80 px-5 py-3">
          <div className="text-[11px] text-muted-foreground">Authority can be configured after launch.</div>
          <button
            type="submit"
            className="rounded-md border border-transparent bg-primary px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-primary-foreground transition hover:brightness-105 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-muted-foreground"
            disabled={!canSubmit || busy}
          >
            {busy ? "Launching..." : "Launch agent"}
          </button>
        </div>
      </form>
    </div>
  );
};
