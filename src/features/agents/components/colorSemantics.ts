import type { AgentStatus } from "@/features/agents/state/store";
import type { GatewayStatus } from "@/lib/gateway/gateway-status";

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "空闲",
  running: "运行中",
  error: "错误",
};

export const AGENT_STATUS_BADGE_CLASS: Record<AgentStatus, string> = {
  idle: "ui-badge-status-idle",
  running: "ui-badge-status-running",
  error: "ui-badge-status-error",
};

export const GATEWAY_STATUS_LABEL: Record<GatewayStatus, string> = {
  disconnected: "已断开",
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
  error: "错误",
};

export const GATEWAY_STATUS_BADGE_CLASS: Record<GatewayStatus, string> = {
  disconnected: "ui-badge-status-disconnected",
  connecting: "ui-badge-status-connecting",
  connected: "ui-badge-status-connected",
  reconnecting: "ui-badge-status-connecting",
  error: "ui-badge-status-error",
};

export const NEEDS_APPROVAL_BADGE_CLASS = "ui-badge-approval";

export const resolveAgentStatusBadgeClass = (status: AgentStatus): string =>
  AGENT_STATUS_BADGE_CLASS[status];

export const resolveGatewayStatusBadgeClass = (status: GatewayStatus): string =>
  GATEWAY_STATUS_BADGE_CLASS[status];

export const resolveAgentStatusLabel = (status: AgentStatus): string => AGENT_STATUS_LABEL[status];

export const resolveGatewayStatusLabel = (status: GatewayStatus): string => GATEWAY_STATUS_LABEL[status];
