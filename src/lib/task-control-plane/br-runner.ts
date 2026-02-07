import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { loadStudioSettings } from "@/lib/studio/settings-store";

type RunBrJsonOptions = {
  cwd?: string;
  env?: Record<string, string>;
};

const extractErrorMessage = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const direct = record.error;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (direct && typeof direct === "object") {
      const nested = (direct as Record<string, unknown>).message;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
    return null;
  } catch {
    return null;
  }
};

const parseJsonOutput = (raw: string, command: string[]) => {
  if (!raw.trim()) {
    throw new Error(`Command produced empty JSON output: br ${command.join(" ")} --json`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Command produced invalid JSON output: br ${command.join(" ")} --json`);
  }
};

const runBrJsonLocal = (command: string[], options?: RunBrJsonOptions): unknown => {
  const args = [...command, "--json"];
  const result = childProcess.spawnSync("br", args, {
    cwd: options?.cwd,
    env: { ...process.env, ...(options?.env ?? {}) },
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Failed to execute br: ${result.error.message}`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    const stderrText = stderr.trim();
    const stdoutText = stdout.trim();
    const message =
      extractErrorMessage(stdout) ??
      extractErrorMessage(stderr) ??
      (stderrText || stdoutText || `Command failed: br ${args.join(" ")}`);
    throw new Error(message);
  }
  return parseJsonOutput(stdout, command);
};

const quoteShellArg = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";

const runBrJsonViaSsh = (command: string[], options: { sshTarget: string; cwd: string }) => {
  const remote =
    `cd ${quoteShellArg(options.cwd)} && ` +
    `PATH=\"$HOME/.local/bin:$HOME/.cargo/bin:$PATH\" ` +
    `br ${command.join(" ")} --json`;
  const result = childProcess.spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", options.sshTarget, remote],
    { encoding: "utf8" }
  );
  if (result.error) {
    throw new Error(`Failed to execute ssh: ${result.error.message}`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (result.status !== 0) {
    const stderrText = stderr.trim();
    const stdoutText = stdout.trim();
    const message =
      extractErrorMessage(stdout) ??
      extractErrorMessage(stderr) ??
      (stderrText || stdoutText || `Command failed: ssh ${options.sshTarget} <br>`);
    throw new Error(message);
  }
  return parseJsonOutput(stdout, command);
};

const parseScopePath = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const path = (value as Record<string, unknown>).path;
  return typeof path === "string" && path.trim().length > 0 ? path : null;
};

const BEADS_DIR_ENV = "OPENCLAW_TASK_CONTROL_PLANE_BEADS_DIR";
const GATEWAY_BEADS_DIR_ENV = "OPENCLAW_TASK_CONTROL_PLANE_GATEWAY_BEADS_DIR";
const SSH_TARGET_ENV = "OPENCLAW_TASK_CONTROL_PLANE_SSH_TARGET";
const SSH_USER_ENV = "OPENCLAW_TASK_CONTROL_PLANE_SSH_USER";

const resolveTaskControlPlaneCwd = (): string | undefined => {
  const configured = process.env[BEADS_DIR_ENV];
  if (!configured) return undefined;
  const trimmed = configured.trim();
  if (!trimmed) return undefined;

  if (path.basename(trimmed) !== ".beads") {
    throw new Error(
      `${BEADS_DIR_ENV} must be an absolute path to a ".beads" directory (got: ${trimmed}).`
    );
  }

  let stats: fs.Stats;
  try {
    stats = fs.statSync(trimmed);
  } catch {
    throw new Error(`${BEADS_DIR_ENV} does not exist on this host: ${trimmed}.`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${BEADS_DIR_ENV} must point to a directory (got file): ${trimmed}.`);
  }

  return path.dirname(trimmed);
};

const resolveGatewayBeadsDir = (): string | undefined => {
  const configured = process.env[GATEWAY_BEADS_DIR_ENV];
  if (!configured) return undefined;
  const trimmed = configured.trim();
  if (!trimmed) return undefined;

  if (!path.isAbsolute(trimmed) || path.basename(trimmed) !== ".beads") {
    throw new Error(
      `${GATEWAY_BEADS_DIR_ENV} must be an absolute path to a ".beads" directory on the gateway host (got: ${trimmed}).`
    );
  }

  return trimmed;
};

const resolveSshTarget = (): string => {
  const configuredTarget = process.env[SSH_TARGET_ENV]?.trim() ?? "";
  const configuredUser = process.env[SSH_USER_ENV]?.trim() ?? "";

  if (configuredTarget) {
    if (configuredTarget.includes("@")) return configuredTarget;
    if (configuredUser) return `${configuredUser}@${configuredTarget}`;
    return configuredTarget;
  }

  const settings = loadStudioSettings();
  const gatewayUrl = settings.gateway?.url?.trim() ?? "";
  if (!gatewayUrl) {
    throw new Error(
      `Remote beads configured but gateway URL is missing. Set it in Studio settings or set ${SSH_TARGET_ENV}.`
    );
  }
  let hostname: string;
  try {
    hostname = new URL(gatewayUrl).hostname;
  } catch {
    throw new Error(`Invalid gateway URL in studio settings: ${gatewayUrl}`);
  }
  if (!hostname) {
    throw new Error(`Invalid gateway URL in studio settings: ${gatewayUrl}`);
  }

  const user = configuredUser || "ubuntu";
  return `${user}@${hostname}`;
};

export const isBeadsWorkspaceError = (message: string) => {
  const lowered = message.toLowerCase();
  return lowered.includes("no beads directory found") || lowered.includes("not initialized");
};

export const createTaskControlPlaneBrRunner = (): {
  runBrJson: (command: string[]) => unknown;
  parseScopePath: (value: unknown) => string | null;
} => {
  const gatewayBeadsDir = resolveGatewayBeadsDir();
  if (gatewayBeadsDir) {
    const sshTarget = resolveSshTarget();
    const cwd = path.dirname(gatewayBeadsDir);
    return {
      runBrJson: (command) => runBrJsonViaSsh(command, { sshTarget, cwd }),
      parseScopePath,
    };
  }
  const cwd = resolveTaskControlPlaneCwd();
  return {
    runBrJson: (command) => runBrJsonLocal(command, { cwd }),
    parseScopePath,
  };
};

