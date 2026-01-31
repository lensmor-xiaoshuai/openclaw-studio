import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveUserPath } from "@/lib/clawdbot/paths";

type AgentEntry = Record<string, unknown> & {
  id?: string;
  default?: boolean;
  workspace?: string;
};

const DEFAULT_AGENT_ID = "main";

const resolveDefaultWorkspaceRoot = (
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir
) => {
  const override =
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.MOLTBOT_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (override) {
    return resolveUserPath(override, homedir);
  }
  const home = homedir();
  const clawdbotDir = path.join(home, ".clawdbot");
  const moltbotDir = path.join(home, ".moltbot");
  const openclawDir = path.join(home, ".openclaw");
  if (fs.existsSync(clawdbotDir)) return clawdbotDir;
  if (fs.existsSync(moltbotDir)) return moltbotDir;
  if (fs.existsSync(openclawDir)) return openclawDir;
  return clawdbotDir;
};

const resolveDefaultWorkspaceDir = (
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir
) => {
  const profile = env.OPENCLAW_PROFILE?.trim();
  const suffix =
    profile && profile.toLowerCase() !== "default" ? `workspace-${profile}` : "workspace";
  return path.join(resolveDefaultWorkspaceRoot(env, homedir), suffix);
};

const readAgentList = (config: Record<string, unknown>): AgentEntry[] => {
  const agents = (config.agents ?? {}) as Record<string, unknown>;
  const list = Array.isArray(agents.list) ? agents.list : [];
  return list.filter((entry): entry is AgentEntry => Boolean(entry && typeof entry === "object"));
};

export const resolveDefaultAgentId = (config: Record<string, unknown>): string => {
  const list = readAgentList(config);
  if (list.length === 0) return DEFAULT_AGENT_ID;
  const defaults = list.filter((entry) => Boolean(entry.default));
  const chosen = (defaults[0] ?? list[0])?.id;
  const trimmed = typeof chosen === "string" ? chosen.trim() : "";
  return trimmed || DEFAULT_AGENT_ID;
};

export const resolveDefaultWorkspacePath = (
  config: Record<string, unknown>,
  defaultAgentId: string
): string | null => {
  const list = readAgentList(config);
  const entry = list.find((item) => item.id === defaultAgentId);
  const configured = typeof entry?.workspace === "string" ? entry.workspace.trim() : "";
  if (configured) return resolveUserPath(configured);

  const agents = (config.agents ?? {}) as Record<string, unknown>;
  const defaults = (agents.defaults ?? {}) as Record<string, unknown>;
  const fallback = typeof defaults.workspace === "string" ? defaults.workspace.trim() : "";
  if (fallback) return resolveUserPath(fallback);

  return resolveDefaultWorkspaceDir();
};
