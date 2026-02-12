import { describe, expect, it } from "vitest";
import type { AgentGuidedSetup } from "@/features/agents/operations/createAgentOperation";
import {
  loadPendingGuidedSetupsFromStorage,
  PENDING_GUIDED_SETUP_MAX_AGE_MS,
  PENDING_GUIDED_SETUP_SESSION_KEY,
  persistPendingGuidedSetupsToStorage,
} from "@/features/agents/creation/pendingSetupStore";

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length() {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const createSetup = (): AgentGuidedSetup => ({
  agentOverrides: {
    sandbox: { mode: "non-main", workspaceAccess: "ro" },
    tools: { profile: "coding", alsoAllow: ["group:runtime"], deny: ["group:web"] },
  },
  files: {
    "AGENTS.md": "# Mission",
  },
  execApprovals: {
    security: "allowlist",
    ask: "always",
    allowlist: [{ pattern: "/usr/bin/git" }],
  },
});

describe("pendingGuidedSetupStore", () => {
  it("persists and loads pending setups by agent id for the requested gateway scope", () => {
    const storage = new MemoryStorage();
    const setup = createSetup();
    persistPendingGuidedSetupsToStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      setupsByAgentId: { "agent-1": setup },
      nowMs: 2_000,
    });

    const loaded = loadPendingGuidedSetupsFromStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      nowMs: 2_500,
    });

    expect(loaded).toEqual({ "agent-1": setup });
  });

  it("preserves entries for other gateway scopes when persisting", () => {
    const storage = new MemoryStorage();
    const setupA = createSetup();
    const setupB = createSetup();

    persistPendingGuidedSetupsToStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      setupsByAgentId: { "agent-a": setupA },
      nowMs: 1_000,
    });
    persistPendingGuidedSetupsToStorage({
      storage,
      gatewayScope: "ws://gateway-b:18789",
      setupsByAgentId: { "agent-b": setupB },
      nowMs: 1_100,
    });

    const loadedA = loadPendingGuidedSetupsFromStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      nowMs: 1_200,
    });
    const loadedB = loadPendingGuidedSetupsFromStorage({
      storage,
      gatewayScope: "ws://gateway-b:18789",
      nowMs: 1_200,
    });

    expect(loadedA).toEqual({ "agent-a": setupA });
    expect(loadedB).toEqual({ "agent-b": setupB });
  });

  it("removes only the requested gateway scope entries when persisting an empty map", () => {
    const storage = new MemoryStorage();
    const setupA = createSetup();
    const setupB = createSetup();

    persistPendingGuidedSetupsToStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      setupsByAgentId: { "agent-a": setupA },
      nowMs: 1_000,
    });
    persistPendingGuidedSetupsToStorage({
      storage,
      gatewayScope: "ws://gateway-b:18789",
      setupsByAgentId: { "agent-b": setupB },
      nowMs: 1_100,
    });

    persistPendingGuidedSetupsToStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      setupsByAgentId: {},
      nowMs: 1_200,
    });

    const loadedA = loadPendingGuidedSetupsFromStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      nowMs: 1_300,
    });
    const loadedB = loadPendingGuidedSetupsFromStorage({
      storage,
      gatewayScope: "ws://gateway-b:18789",
      nowMs: 1_300,
    });

    expect(loadedA).toEqual({});
    expect(loadedB).toEqual({ "agent-b": setupB });
  });

  it("ignores malformed JSON and unknown shapes", () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_GUIDED_SETUP_SESSION_KEY, "not-json");
    expect(loadPendingGuidedSetupsFromStorage({ storage, gatewayScope: "ws://gateway-a:18789" })).toEqual({});

    storage.setItem(
      PENDING_GUIDED_SETUP_SESSION_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          {
            agentId: "",
            gatewayScope: "ws://gateway-a:18789",
            setup: {},
            savedAtMs: 1_000,
          },
        ],
      })
    );
    expect(
      loadPendingGuidedSetupsFromStorage({
        storage,
        gatewayScope: "ws://gateway-a:18789",
        nowMs: 2_000,
      })
    ).toEqual({});
  });

  it("drops stale entries using max age", () => {
    const storage = new MemoryStorage();
    const setup = createSetup();
    storage.setItem(
      PENDING_GUIDED_SETUP_SESSION_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          {
            agentId: "agent-1",
            gatewayScope: "ws://gateway-a:18789",
            setup,
            savedAtMs: 1_000,
          },
        ],
      })
    );

    const loaded = loadPendingGuidedSetupsFromStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      nowMs: 1_000 + PENDING_GUIDED_SETUP_MAX_AGE_MS + 1,
    });

    expect(loaded).toEqual({});
  });

  it("removes storage key when no pending setups remain for any scope", () => {
    const storage = new MemoryStorage();
    storage.setItem(PENDING_GUIDED_SETUP_SESSION_KEY, "{}");

    persistPendingGuidedSetupsToStorage({
      storage,
      gatewayScope: "ws://gateway-a:18789",
      setupsByAgentId: {},
    });

    expect(storage.getItem(PENDING_GUIDED_SETUP_SESSION_KEY)).toBeNull();
  });

  it("fails safe when storage methods throw", () => {
    class ThrowingStorage extends MemoryStorage {
      override getItem(): string | null {
        throw new Error("getItem failed");
      }
      override setItem(): void {
        throw new Error("setItem failed");
      }
      override removeItem(): void {
        throw new Error("removeItem failed");
      }
    }

    const storage = new ThrowingStorage();

    expect(() =>
      loadPendingGuidedSetupsFromStorage({
        storage,
        gatewayScope: "ws://gateway-a:18789",
      })
    ).not.toThrow();

    expect(() =>
      persistPendingGuidedSetupsToStorage({
        storage,
        gatewayScope: "ws://gateway-a:18789",
        setupsByAgentId: { "agent-1": createSetup() },
      })
    ).not.toThrow();

    expect(() =>
      persistPendingGuidedSetupsToStorage({
        storage,
        gatewayScope: "ws://gateway-a:18789",
        setupsByAgentId: {},
      })
    ).not.toThrow();
  });
});
