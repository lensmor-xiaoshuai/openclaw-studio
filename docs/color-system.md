# Color System

This document defines how color is used in OpenClaw Studio so action priority, system state, and destructive risk are consistently readable across fleet, chat, settings, and connection flows.

## Semantic Contract

Color has one job per semantic family:

- Action (`--action-*`): primary forward actions such as `New agent`, `Send`, `Create`, `Launch agent`, `Connect`.
- Danger (`--danger-*`): destructive and failure semantics such as `Delete agent`, deny actions, and error banners.
- Status (`--status-*`): runtime state only. Not used for action emphasis.
- Surfaces (`--surface-*`, `--panel`, `--sidebar-*`): structural hierarchy (app background -> panel shell -> cards -> subsurfaces).
- Command preview (`--command-*`): terminal-like command snippets in the connect flow, implemented as semantic tokens and utility classes, not raw hue utilities.

## Status Mapping

Status rendering is centralized in `src/features/agents/components/colorSemantics.ts`.

Agent status:

- `idle` -> `ui-badge-status-idle`
- `running` -> `ui-badge-status-running`
- `error` -> `ui-badge-status-error`

Gateway status:

- `disconnected` -> `ui-badge-status-disconnected`
- `connecting` -> `ui-badge-status-connecting`
- `connected` -> `ui-badge-status-connected`

Approval state:

- `Needs approval` -> `ui-badge-approval`

## Surface Hierarchy

Structural layers are intentionally separated by tokenized contrast steps:

- App background: `--surface-0`
- Panel shell: `--panel` + `--panel-border`
- Card blocks: `--sidebar-card-bg` + `--sidebar-card-border`
- Subsurface/inputs: `--surface-2`, `--surface-3`, `--sidebar-input-*`
- User chat message surfaces: `--chat-user-bg`, `--chat-user-header-bg`

## Shared Utility Classes

Core semantic classes in `src/app/globals.css`:

- Alerts: `ui-alert-danger`, `ui-text-danger`
- Status badges: `ui-badge-status-*`, `ui-badge-approval`
- Danger controls: `ui-btn-danger`, `ui-btn-icon-danger`
- Emphasized controls: `ui-control-important`
- Command preview: `ui-command-surface`, `ui-command-copy`
- Status dots: `ui-dot-status-*`

## File-Level Color Sources

Token layer:

- `src/app/globals.css`
- `src/app/styles/markdown.css`

Component usage:

- `src/features/agents/components/FleetSidebar.tsx`
- `src/features/agents/components/AgentChatPanel.tsx`
- `src/features/agents/components/ConnectionPanel.tsx`
- `src/features/agents/components/HeaderBar.tsx`
- `src/features/agents/components/AgentInspectPanels.tsx`
- `src/features/agents/components/GatewayConnectScreen.tsx`
- `src/features/agents/components/AgentCreateModal.tsx`
- `src/app/page.tsx`

## Guardrails

`tests/unit/colorSemanticsGuard.test.ts` prevents reintroducing raw Tailwind hue utilities in core color-owned files (for example `bg-amber-500`, `text-zinc-100`).

If a new exception is needed, use semantic tokens/classes first. Only allow-list a raw utility in the guard test if there is a concrete reason a semantic class cannot represent it.

## Migration Checklist

- [x] Semantic token contract documented.
- [x] Shared token layer refactored.
- [x] Fleet/chat/connection statuses centralized through `colorSemantics.ts`.
- [x] Inspect/connect/modal panels migrated off raw hue utilities.
- [x] Regression tests added for semantic mappings and source guardrails.
