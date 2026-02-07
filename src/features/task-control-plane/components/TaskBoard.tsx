"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, X } from "lucide-react";

import { fetchJson } from "@/lib/http";
import type {
  TaskControlPlaneCard,
  TaskControlPlaneSnapshot,
} from "@/lib/task-control-plane/read-model";

type TaskBoardProps = {
  snapshot: TaskControlPlaneSnapshot;
  onRequestRefresh?: () => void;
};

type ColumnProps = {
  title: string;
  cards: TaskControlPlaneCard[];
  dataTestId: string;
  showDescriptions: boolean;
  onOpenDetails: (card: TaskControlPlaneCard) => void;
  priorityMenuCardId: string | null;
  prioritySavingCardId: string | null;
  priorityErrorCardId: string | null;
  priorityErrorMessage: string | null;
  onTogglePriorityMenu: (cardId: string) => void;
  onSelectPriority: (card: TaskControlPlaneCard, priority: number) => void;
};

const formatGeneratedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const formatUpdatedAt = (value: string | null) => {
  if (!value) return "Unknown update time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const readString = (record: Record<string, unknown> | null, keys: string[]): string | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const readNumber = (record: Record<string, unknown> | null, keys: string[]): number | null => {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
};

const readObjectArray = (
  record: Record<string, unknown> | null,
  keys: string[]
): Record<string, unknown>[] => {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    return value.filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
    );
  }
  return [];
};

const getDescriptionPreview = (value: string) => {
  const firstLine =
    value
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  if (!firstLine) return "";
  if (firstLine.length <= 140) return firstLine;
  return `${firstLine.slice(0, 140)}...`;
};

function Column({
  title,
  cards,
  dataTestId,
  showDescriptions,
  onOpenDetails,
  priorityMenuCardId,
  prioritySavingCardId,
  priorityErrorCardId,
  priorityErrorMessage,
  onTogglePriorityMenu,
  onSelectPriority,
}: ColumnProps) {
  return (
    <section
      data-testid={dataTestId}
      className="glass-panel flex min-h-[360px] w-full min-w-[260px] flex-col p-3"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-foreground/85">
          {title}
        </h2>
        <span className="rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {cards.length}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {cards.map((card) => (
          <article
            key={card.id}
            className="rounded-xl border border-border/70 bg-card/90 p-3 shadow-xs"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="font-mono text-[11px] font-medium uppercase text-muted-foreground">
                {card.id}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-background/60 text-muted-foreground transition hover:bg-background hover:text-foreground ${card.description ? "" : "opacity-60"}`}
                  aria-label={`View details for ${card.id}`}
                  data-testid={`task-control-card-description-${card.id}`}
                  onClick={() => onOpenDetails(card)}
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="relative" data-priority-menu-root={card.id}>
                  <button
                    type="button"
                    className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:bg-background hover:text-foreground"
                    aria-label={`Change priority for ${card.id}`}
                    data-testid={`task-control-card-priority-${card.id}`}
                    disabled={prioritySavingCardId === card.id}
                    onClick={() => onTogglePriorityMenu(card.id)}
                  >
                    {card.priority === null ? "P-" : `P${card.priority}`}
                  </button>
                  {priorityMenuCardId === card.id ? (
                    <div className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-lg border border-border/70 bg-card/95 shadow-xl">
                      {[
                        { value: 0, label: "Critical" },
                        { value: 1, label: "High" },
                        { value: 2, label: "Medium" },
                        { value: 3, label: "Low" },
                        { value: 4, label: "Backlog" },
                      ].map((entry) => (
                        <button
                          key={entry.value}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/60 disabled:opacity-60"
                          disabled={prioritySavingCardId === card.id}
                          onClick={() => onSelectPriority(card, entry.value)}
                        >
                          <span className="font-mono text-[11px] font-semibold">
                            P{entry.value}
                          </span>
                          <span className="flex-1 text-muted-foreground">
                            {entry.label}
                          </span>
                          {card.priority === entry.value ? (
                            <span className="text-[11px] text-muted-foreground">Current</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {card.decisionNeeded ? (
                  <span className="rounded-full border border-accent/45 bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
                    Decision Needed
                  </span>
                ) : null}
              </div>
            </div>
            <p className="text-sm font-medium text-foreground">{card.title}</p>
            {showDescriptions && card.description ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {getDescriptionPreview(card.description)}
              </p>
            ) : null}
            {priorityErrorCardId === card.id && priorityErrorMessage ? (
              <p className="mt-2 text-xs text-destructive">{priorityErrorMessage}</p>
            ) : null}
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>Updated: {formatUpdatedAt(card.updatedAt)}</p>
              {card.assignee ? <p>Assignee: {card.assignee}</p> : null}
              {card.blockedBy.length > 0 ? (
                <p>Blocked by: {card.blockedBy.join(", ")}</p>
              ) : null}
              {card.labels.length > 0 ? (
                <p>Labels: {card.labels.join(", ")}</p>
              ) : null}
            </div>
          </article>
        ))}
        {cards.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 bg-background/40 px-3 py-4 text-sm text-muted-foreground">
            No tasks in this column.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function TaskBoard({ snapshot, onRequestRefresh }: TaskBoardProps) {
  const [showDescriptions, setShowDescriptions] = useState(false);
  const [detailsCard, setDetailsCard] = useState<TaskControlPlaneCard | null>(null);
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [priorityMenuCardId, setPriorityMenuCardId] = useState<string | null>(null);
  const [prioritySavingCardId, setPrioritySavingCardId] = useState<string | null>(null);
  const [priorityErrorCardId, setPriorityErrorCardId] = useState<string | null>(null);
  const [priorityErrorMessage, setPriorityErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!detailsCard) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsCard(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailsCard]);

  useEffect(() => {
    if (!priorityMenuCardId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const root = target?.closest?.("[data-priority-menu-root]") as HTMLElement | null;
      if (!root) {
        setPriorityMenuCardId(null);
        return;
      }
      if (root.dataset.priorityMenuRoot !== priorityMenuCardId) {
        setPriorityMenuCardId(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [priorityMenuCardId]);

  useEffect(() => {
    if (!detailsCard) {
      setDetails(null);
      setDetailsLoading(false);
      setDetailsError(null);
      return;
    }

    let cancelled = false;
    setDetails(null);
    setDetailsLoading(true);
    setDetailsError(null);
    void (async () => {
      try {
        const response = await fetchJson<{ bead: Record<string, unknown> }>(
          `/api/task-control-plane/show?id=${encodeURIComponent(detailsCard.id)}`
        );
        if (cancelled) return;
        setDetails(response.bead);
      } catch (err) {
        if (cancelled) return;
        setDetailsError(err instanceof Error ? err.message : "Failed to load task details.");
      } finally {
        if (cancelled) return;
        setDetailsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [detailsCard]);

  const descriptionBody = useMemo(() => {
    const fromDetails = details?.description;
    const raw =
      typeof fromDetails === "string"
        ? fromDetails
        : (detailsCard?.description ?? "");
    return raw.trim();
  }, [details, detailsCard]);

  const detailsJson = useMemo(() => {
    if (!details) return "";
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return "";
    }
  }, [details]);

  const onTogglePriorityMenu = (cardId: string) => {
    setPriorityErrorCardId(null);
    setPriorityErrorMessage(null);
    setPriorityMenuCardId((value) => (value === cardId ? null : cardId));
  };

  const onSelectPriority = async (card: TaskControlPlaneCard, priority: number) => {
    setPrioritySavingCardId(card.id);
    setPriorityErrorCardId(null);
    setPriorityErrorMessage(null);
    try {
      await fetchJson<{ bead: Record<string, unknown> }>("/api/task-control-plane/priority", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: card.id, priority }),
      });
      setPriorityMenuCardId(null);
      if (onRequestRefresh) onRequestRefresh();
    } catch (err) {
      setPriorityErrorCardId(card.id);
      setPriorityErrorMessage(
        err instanceof Error ? err.message : "Failed to update priority."
      );
    } finally {
      setPrioritySavingCardId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="glass-panel rounded-xl px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              Read-only task board from Beads status data
            </p>
            <p className="text-xs text-muted-foreground">
              Last refresh: {formatGeneratedAt(snapshot.generatedAt)}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-background hover:text-foreground"
            aria-pressed={showDescriptions}
            data-testid="task-control-description-toggle"
            onClick={() => setShowDescriptions((value) => !value)}
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Descriptions: {showDescriptions ? "On" : "Off"}
          </button>
        </div>
        {snapshot.scopePath ? (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Scope: {snapshot.scopePath}
          </p>
        ) : null}
        {snapshot.warnings.length > 0 ? (
          <p className="mt-1 text-xs text-accent-foreground">
            Warnings: {snapshot.warnings.join(" | ")}
          </p>
        ) : null}
      </div>

      <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-4">
        <Column
          title="Ready"
          cards={snapshot.columns.ready}
          dataTestId="task-control-column-ready"
          showDescriptions={showDescriptions}
          onOpenDetails={setDetailsCard}
          priorityMenuCardId={priorityMenuCardId}
          prioritySavingCardId={prioritySavingCardId}
          priorityErrorCardId={priorityErrorCardId}
          priorityErrorMessage={priorityErrorMessage}
          onTogglePriorityMenu={onTogglePriorityMenu}
          onSelectPriority={onSelectPriority}
        />
        <Column
          title="In Progress"
          cards={snapshot.columns.inProgress}
          dataTestId="task-control-column-in-progress"
          showDescriptions={showDescriptions}
          onOpenDetails={setDetailsCard}
          priorityMenuCardId={priorityMenuCardId}
          prioritySavingCardId={prioritySavingCardId}
          priorityErrorCardId={priorityErrorCardId}
          priorityErrorMessage={priorityErrorMessage}
          onTogglePriorityMenu={onTogglePriorityMenu}
          onSelectPriority={onSelectPriority}
        />
        <Column
          title="Blocked"
          cards={snapshot.columns.blocked}
          dataTestId="task-control-column-blocked"
          showDescriptions={showDescriptions}
          onOpenDetails={setDetailsCard}
          priorityMenuCardId={priorityMenuCardId}
          prioritySavingCardId={prioritySavingCardId}
          priorityErrorCardId={priorityErrorCardId}
          priorityErrorMessage={priorityErrorMessage}
          onTogglePriorityMenu={onTogglePriorityMenu}
          onSelectPriority={onSelectPriority}
        />
        <Column
          title="Done"
          cards={snapshot.columns.done}
          dataTestId="task-control-column-done"
          showDescriptions={showDescriptions}
          onOpenDetails={setDetailsCard}
          priorityMenuCardId={priorityMenuCardId}
          prioritySavingCardId={prioritySavingCardId}
          priorityErrorCardId={priorityErrorCardId}
          priorityErrorMessage={priorityErrorMessage}
          onTogglePriorityMenu={onTogglePriorityMenu}
          onSelectPriority={onSelectPriority}
        />
      </div>

      {detailsCard ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Details for ${detailsCard.id}`}
          data-testid="task-control-description-modal"
          onClick={() => setDetailsCard(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card/95 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border/80 px-4 py-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {detailsCard.id}
                </div>
                <div className="mt-1 text-base font-semibold text-foreground">
                  {detailsCard.title}
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/80 bg-card/70 text-muted-foreground transition hover:border-border hover:bg-muted/65 hover:text-foreground"
                aria-label="Close description"
                data-testid="task-control-description-modal-close"
                onClick={() => setDetailsCard(null)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
              {detailsLoading ? (
                <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                  <span className="mr-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">
                    Loading details
                  </span>
                  <span className="typing-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              ) : null}
              {detailsError ? (
                <div className="rounded-md border border-destructive/40 bg-muted/40 px-3 py-3 text-sm text-destructive">
                  {detailsError}
                </div>
              ) : null}

              {details && !detailsLoading && !detailsError ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Bead
                    </div>
                    <dl className="mt-2 grid grid-cols-1 gap-2 text-sm text-foreground sm:grid-cols-2">
                      {readString(details, ["issue_type", "issueType"]) ? (
                        <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Type
                          </dt>
                          <dd className="mt-1 font-mono text-[12px]">
                            {readString(details, ["issue_type", "issueType"])}
                          </dd>
                        </div>
                      ) : null}
                      {readString(details, ["created_at", "createdAt"]) ? (
                        <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Created
                          </dt>
                          <dd className="mt-1 font-mono text-[12px]">
                            {formatGeneratedAt(
                              readString(details, ["created_at", "createdAt"]) ?? ""
                            )}
                          </dd>
                        </div>
                      ) : null}
                      {readString(details, ["created_by", "createdBy"]) ? (
                        <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Created By
                          </dt>
                          <dd className="mt-1 font-mono text-[12px]">
                            {readString(details, ["created_by", "createdBy"])}
                          </dd>
                        </div>
                      ) : null}
                      {readNumber(details, ["compaction_level", "compactionLevel"]) !== null ? (
                        <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Compaction
                          </dt>
                          <dd className="mt-1 font-mono text-[12px]">
                            {readNumber(details, ["compaction_level", "compactionLevel"])}
                          </dd>
                        </div>
                      ) : null}
                      {readNumber(details, ["original_size", "originalSize"]) !== null ? (
                        <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Original Size
                          </dt>
                          <dd className="mt-1 font-mono text-[12px]">
                            {readNumber(details, ["original_size", "originalSize"])}
                          </dd>
                        </div>
                      ) : null}
                      {readObjectArray(details, ["dependencies"]).length > 0 ? (
                        <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2 sm:col-span-2">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Dependencies
                          </dt>
                          <dd className="mt-2 space-y-1 font-mono text-[12px]">
                            {readObjectArray(details, ["dependencies"]).map((dep, index) => (
                              <div
                                key={
                                  typeof dep.id === "string"
                                    ? dep.id
                                    : typeof dep.title === "string"
                                      ? dep.title
                                      : String(index)
                                }
                              >
                                {typeof dep.id === "string" ? dep.id : "unknown"}{" "}
                                {typeof dep.title === "string" ? `- ${dep.title}` : ""}
                              </div>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                      {readObjectArray(details, ["dependents"]).length > 0 ? (
                        <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2 sm:col-span-2">
                          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Dependents
                          </dt>
                          <dd className="mt-2 space-y-1 font-mono text-[12px]">
                            {readObjectArray(details, ["dependents"]).map((dep, index) => (
                              <div
                                key={
                                  typeof dep.id === "string"
                                    ? dep.id
                                    : typeof dep.title === "string"
                                      ? dep.title
                                      : String(index)
                                }
                              >
                                {typeof dep.id === "string" ? dep.id : "unknown"}{" "}
                                {typeof dep.title === "string" ? `- ${dep.title}` : ""}
                              </div>
                            ))}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 space-y-4">
                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Summary
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-2 text-sm text-foreground sm:grid-cols-2">
                    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Status
                      </dt>
                      <dd className="mt-1 font-mono text-[12px]">{detailsCard.status}</dd>
                    </div>
                    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Column
                      </dt>
                      <dd className="mt-1 font-mono text-[12px]">{detailsCard.column}</dd>
                    </div>
                    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Priority
                      </dt>
                      <dd className="mt-1 font-mono text-[12px]">
                        {detailsCard.priority === null ? "None" : `P${detailsCard.priority}`}
                      </dd>
                    </div>
                    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Updated
                      </dt>
                      <dd className="mt-1 font-mono text-[12px]">
                        {formatUpdatedAt(detailsCard.updatedAt)}
                      </dd>
                    </div>
                    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Assignee
                      </dt>
                      <dd className="mt-1 font-mono text-[12px]">
                        {detailsCard.assignee ?? "None"}
                      </dd>
                    </div>
                    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Labels
                      </dt>
                      <dd className="mt-1 font-mono text-[12px]">
                        {detailsCard.labels.length > 0 ? detailsCard.labels.join(", ") : "None"}
                      </dd>
                    </div>
                    <div className="rounded-md border border-border/70 bg-background/40 px-3 py-2 sm:col-span-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Blocked By
                      </dt>
                      <dd className="mt-1 font-mono text-[12px]">
                        {detailsCard.blockedBy.length > 0
                          ? detailsCard.blockedBy.join(", ")
                          : "None"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Description
                  </div>
                  <div className="mt-2 rounded-md border border-border/70 bg-background/40 px-3 py-3">
                    {descriptionBody ? (
                      <div className="agent-markdown text-sm text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{descriptionBody}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No description.</p>
                    )}
                  </div>
                </div>

                {detailsJson ? (
                  <details className="rounded-md border border-border/70 bg-background/40 px-3 py-3">
                    <summary className="cursor-pointer font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Raw JSON
                    </summary>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">
                      {detailsJson}
                    </pre>
                  </details>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
