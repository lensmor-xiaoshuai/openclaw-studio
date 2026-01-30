import type { GatewayStatus } from "@/lib/gateway/GatewayClient";

type HeaderBarProps = {
  projects: Array<{ id: string; name: string }>;
  activeProjectId: string | null;
  status: GatewayStatus;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  onOpenProject: () => void;
  onDeleteProject: () => void;
  onNewAgent: () => void;
  onCreateDiscordChannel: () => void;
  canCreateDiscordChannel: boolean;
};

const statusDotStyles: Record<GatewayStatus, string> = {
  disconnected: "bg-slate-400",
  connecting: "bg-amber-400",
  connected: "bg-emerald-400",
};

const statusLabel: Record<GatewayStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
};

export const HeaderBar = ({
  projects,
  activeProjectId,
  status,
  onProjectChange,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
  onNewAgent,
  onCreateDiscordChannel,
  canCreateDiscordChannel,
}: HeaderBarProps) => {
  const hasProjects = projects.length > 0;
  return (
    <div className="glass-panel px-6 py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {hasProjects ? (
            <div className="relative">
              <select
                className="h-11 min-w-[200px] max-w-[min(360px,70vw)] appearance-none rounded-full border border-slate-300 bg-white/80 px-4 pr-10 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-slate-400"
                onChange={(event) => onProjectChange(event.target.value)}
                value={activeProjectId ?? ""}
                aria-label="Workspace"
              >
                {!activeProjectId ? (
                  <option value="" disabled>
                    Select workspace
                  </option>
                ) : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">
                v
              </span>
            </div>
          ) : (
            <span className="text-sm font-semibold text-slate-500">No workspaces</span>
          )}
        </div>

        <div className="flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold uppercase text-slate-600">
            <span
              className={`h-2 w-2 rounded-full ${statusDotStyles[status]}`}
              aria-hidden="true"
            />
            {statusLabel[status]}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            className="rounded-full bg-[var(--accent-strong)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            onClick={onNewAgent}
            disabled={!activeProjectId}
          >
            New Agent
          </button>
          <details className="relative">
            <summary className="flex h-10 items-center gap-2 rounded-full border border-slate-300 bg-white/80 px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 [&::-webkit-details-marker]:hidden">
              Workspaces
              <span className="text-xs font-semibold text-slate-500">v</span>
            </summary>
            <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-200 bg-white/95 p-2 text-sm shadow-xl">
              <button
                className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                type="button"
                onClick={(event) => {
                  onCreateProject();
                  const details = event.currentTarget.closest(
                    "details"
                  ) as HTMLDetailsElement | null;
                  if (details) details.open = false;
                }}
              >
                New Workspace
              </button>
              <button
                className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                type="button"
                onClick={(event) => {
                  onOpenProject();
                  const details = event.currentTarget.closest(
                    "details"
                  ) as HTMLDetailsElement | null;
                  if (details) details.open = false;
                }}
              >
                Open Workspace
              </button>
              <button
                className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={(event) => {
                  onDeleteProject();
                  const details = event.currentTarget.closest(
                    "details"
                  ) as HTMLDetailsElement | null;
                  if (details) details.open = false;
                }}
                disabled={!activeProjectId}
              >
                Delete Workspace
              </button>
              {canCreateDiscordChannel ? (
                <button
                  className="mt-1 flex w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                  type="button"
                  onClick={(event) => {
                    onCreateDiscordChannel();
                    const details = event.currentTarget.closest(
                      "details"
                    ) as HTMLDetailsElement | null;
                    if (details) details.open = false;
                  }}
                >
                  Create Discord Channel
                </button>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
};
