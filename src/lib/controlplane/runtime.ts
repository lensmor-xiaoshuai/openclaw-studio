import type {
  ControlPlaneDomainEvent,
  ControlPlaneOutboxEntry,
  ControlPlaneRuntimeSnapshot,
} from "@/lib/controlplane/contracts";
import { OpenClawGatewayAdapter, type OpenClawAdapterOptions } from "@/lib/controlplane/openclaw-adapter";
import {
  SQLiteControlPlaneProjectionStore,
  type BackfillAgentOutboxResult,
} from "@/lib/controlplane/projection-store";

const DOMAIN_MODE_FALSE_VALUES = new Set(["0", "false", "no", "off"]);

const readDomainModeRawValue = (env: NodeJS.ProcessEnv = process.env): string => {
  const serverValue = env.STUDIO_DOMAIN_API_MODE?.trim().toLowerCase() ?? "";
  if (serverValue) return serverValue;
  return env.NEXT_PUBLIC_STUDIO_DOMAIN_API_MODE?.trim().toLowerCase() ?? "";
};

const readDomainApiMode = (env: NodeJS.ProcessEnv = process.env): boolean => {
  const raw = readDomainModeRawValue(env);
  if (!raw) return true;
  return !DOMAIN_MODE_FALSE_VALUES.has(raw);
};

type ControlPlaneRuntimeOptions = {
  adapterOptions?: OpenClawAdapterOptions;
  dbPath?: string;
};

export class ControlPlaneRuntime {
  private readonly store: SQLiteControlPlaneProjectionStore;
  private readonly adapter: OpenClawGatewayAdapter;
  private readonly eventSubscribers = new Set<(entry: ControlPlaneOutboxEntry) => void>();

  constructor(options?: ControlPlaneRuntimeOptions) {
    this.store = new SQLiteControlPlaneProjectionStore(options?.dbPath);
    this.adapter = new OpenClawGatewayAdapter({
      ...(options?.adapterOptions ?? {}),
      onDomainEvent: (event) => this.handleDomainEvent(event),
    });
  }

  async ensureStarted(): Promise<void> {
    await this.adapter.start();
  }

  async disconnect(): Promise<void> {
    await this.adapter.stop();
  }

  snapshot(): ControlPlaneRuntimeSnapshot {
    return this.store.snapshot();
  }

  eventsAfter(lastSeenId: number, limit?: number): ControlPlaneOutboxEntry[] {
    return this.store.readOutboxAfter(lastSeenId, limit);
  }

  eventsBeforeForAgent(
    agentId: string,
    beforeOutboxId: number,
    limit?: number
  ): ControlPlaneOutboxEntry[] {
    return this.store.readAgentOutboxBefore(agentId, beforeOutboxId, limit);
  }

  backfillAgentHistoryIndex(beforeOutboxId: number, limit?: number): BackfillAgentOutboxResult {
    return this.store.backfillAgentOutboxBefore(beforeOutboxId, limit);
  }

  subscribe(handler: (entry: ControlPlaneOutboxEntry) => void): () => void {
    this.eventSubscribers.add(handler);
    return () => {
      this.eventSubscribers.delete(handler);
    };
  }

  async callGateway<T = unknown>(method: string, params: unknown): Promise<T> {
    return await this.adapter.request<T>(method, params);
  }

  close(): void {
    this.store.close();
  }

  private handleDomainEvent(event: ControlPlaneDomainEvent): void {
    const entry = this.store.applyDomainEvent(event);
    for (const subscriber of this.eventSubscribers) {
      try {
        subscriber(entry);
      } catch (err) {
        console.error("Control-plane event subscriber failed.", err);
      }
    }
  }
}

type GlobalControlPlaneState = typeof globalThis & {
  __openclawStudioControlPlaneRuntime?: ControlPlaneRuntime;
};

export const getControlPlaneRuntime = (options?: ControlPlaneRuntimeOptions): ControlPlaneRuntime => {
  const globalState = globalThis as GlobalControlPlaneState;
  if (!globalState.__openclawStudioControlPlaneRuntime) {
    globalState.__openclawStudioControlPlaneRuntime = new ControlPlaneRuntime(options);
  }
  return globalState.__openclawStudioControlPlaneRuntime;
};

export const resetControlPlaneRuntimeForTests = (): void => {
  const globalState = globalThis as GlobalControlPlaneState;
  delete globalState.__openclawStudioControlPlaneRuntime;
};

export const isStudioDomainApiModeEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  readDomainApiMode(env);
