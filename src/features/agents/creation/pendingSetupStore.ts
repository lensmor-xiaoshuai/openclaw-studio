import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";

export const PENDING_GUIDED_SETUP_SESSION_KEY = "openclaw.studio.pending-guided-setups.v1";
export const PENDING_GUIDED_SETUP_STORE_VERSION = 1;
export const PENDING_GUIDED_SETUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type SerializedPendingGuidedSetupEntry = {
  agentId: string;
  gatewayScope: string;
  setup: AgentGuidedSetup;
  savedAtMs: number;
};

type SerializedPendingGuidedSetupStore = {
  version: 1;
  entries: SerializedPendingGuidedSetupEntry[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const parseAgentId = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizePendingGuidedSetupGatewayScope = (
  value: unknown
): string => {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
};

const isGuidedSetup = (value: unknown): value is AgentGuidedSetup => {
  if (!isRecord(value)) return false;
  if (!isRecord(value.agentOverrides)) return false;
  if (!isRecord(value.files)) return false;
  const execApprovals = value.execApprovals;
  if (execApprovals !== null && execApprovals !== undefined && !isRecord(execApprovals)) {
    return false;
  }
  return true;
};

const readStorageItem = (storage: Storage, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch (err) {
    console.warn(`Failed to read pending guided setup store "${key}".`, err);
    return null;
  }
};

const writeStorageItem = (storage: Storage, key: string, value: string): void => {
  try {
    storage.setItem(key, value);
  } catch (err) {
    console.warn(`Failed to write pending guided setup store "${key}".`, err);
  }
};

const removeStorageItem = (storage: Storage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch (err) {
    console.warn(`Failed to remove pending guided setup store "${key}".`, err);
  }
};

const parseStoreEntries = (raw: string, params: { nowMs: number; maxAgeMs: number }) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [] as SerializedPendingGuidedSetupEntry[];
  }
  if (!isRecord(parsed) || parsed.version !== PENDING_GUIDED_SETUP_STORE_VERSION) {
    return [] as SerializedPendingGuidedSetupEntry[];
  }
  const entriesRaw = Array.isArray(parsed.entries) ? parsed.entries : [];
  const next: SerializedPendingGuidedSetupEntry[] = [];
  for (const entry of entriesRaw) {
    if (!isRecord(entry)) continue;
    const agentId = parseAgentId(entry.agentId);
    const gatewayScope = normalizePendingGuidedSetupGatewayScope(entry.gatewayScope);
    const savedAtMs = asFiniteNumber(entry.savedAtMs);
    if (!agentId || savedAtMs === null || savedAtMs < params.nowMs - params.maxAgeMs) continue;
    if (!isGuidedSetup(entry.setup)) continue;
    next.push({
      agentId,
      gatewayScope,
      setup: entry.setup,
      savedAtMs,
    });
  }
  return next;
};

export const loadPendingGuidedSetupsFromStorage = (params: {
  storage: Storage | null | undefined;
  gatewayScope?: string | null;
  nowMs?: number;
  maxAgeMs?: number;
}): Record<string, AgentGuidedSetup> => {
  if (!params.storage) return {};
  const raw = readStorageItem(params.storage, PENDING_GUIDED_SETUP_SESSION_KEY);
  if (!raw) return {};
  const gatewayScope = normalizePendingGuidedSetupGatewayScope(params.gatewayScope);
  const entries = parseStoreEntries(raw, {
    nowMs: params.nowMs ?? Date.now(),
    maxAgeMs: params.maxAgeMs ?? PENDING_GUIDED_SETUP_MAX_AGE_MS,
  });
  const next: Record<string, AgentGuidedSetup> = {};
  for (const entry of entries) {
    if (entry.gatewayScope !== gatewayScope) continue;
    next[entry.agentId] = entry.setup;
  }
  return next;
};

export const persistPendingGuidedSetupsToStorage = (params: {
  storage: Storage | null | undefined;
  gatewayScope?: string | null;
  setupsByAgentId: Record<string, AgentGuidedSetup>;
  nowMs?: number;
}): void => {
  if (!params.storage) return;
  const nowMs = params.nowMs ?? Date.now();
  const gatewayScope = normalizePendingGuidedSetupGatewayScope(params.gatewayScope);
  const raw = readStorageItem(params.storage, PENDING_GUIDED_SETUP_SESSION_KEY);
  const existingEntries = raw
    ? parseStoreEntries(raw, {
        nowMs,
        maxAgeMs: PENDING_GUIDED_SETUP_MAX_AGE_MS,
      })
    : [];
  const retainedEntries = existingEntries.filter((entry) => entry.gatewayScope !== gatewayScope);
  const scopedEntries: SerializedPendingGuidedSetupEntry[] = Object.entries(params.setupsByAgentId)
    .map(([agentId, setup]) => ({
      agentId: agentId.trim(),
      gatewayScope,
      setup,
      savedAtMs: nowMs,
    }))
    .filter((entry) => entry.agentId.length > 0);
  const entries = [...retainedEntries, ...scopedEntries];
  if (entries.length === 0) {
    removeStorageItem(params.storage, PENDING_GUIDED_SETUP_SESSION_KEY);
    return;
  }
  const payload: SerializedPendingGuidedSetupStore = {
    version: PENDING_GUIDED_SETUP_STORE_VERSION,
    entries,
  };
  writeStorageItem(params.storage, PENDING_GUIDED_SETUP_SESSION_KEY, JSON.stringify(payload));
};
