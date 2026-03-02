import type { Page } from "@playwright/test";

type RuntimeRouteFixture = {
  fleetResult?: {
    seeds: Array<{
      agentId: string;
      name: string;
      model: string;
      modelProvider: string;
      mode: "focused";
      status: "idle" | "running";
      sessionKey: string | null;
      sessionCreated: boolean;
      sessionSettingsSynced: boolean;
      busy: boolean;
      latestUpdateAt: string | null;
      latestUpdate: string;
      latestTranscriptLine: string;
      queuedMessageCount: number;
      latestDoneReason: string | null;
      avatarSeed: string;
      customInstructions: string;
      supportsImageInput: boolean;
      supportsStreaming: boolean;
      supportsSkillSetup: boolean;
      toolCallingEnabled: boolean;
      showThinkingTraces: boolean;
      thinkingLevel: string | null;
      runStartedAt: string | null;
      runningSince: string | null;
      updatedAt: string | null;
      awaitingUserInput: boolean;
      cronScheduleText: string | null;
      cronNextRunAt: string | null;
      cronEnabled: boolean;
      cronJobId: string | null;
      modelMenuAvailable: boolean;
      supportsModelPicker: boolean;
      supportsSessionSettings: boolean;
      permissions: {
        securityLevel: "deny" | "allowlist" | "full";
        askForApprovals: "off" | "on-miss" | "always";
        defaultMode: "deny" | "allowlist" | "full";
        defaultAskForApprovals: "off" | "on-miss" | "always";
      };
      historyLoadedAt: number | null;
      historyFetchLimit: number | null;
      historyFetchedCount: number | null;
      historyMaybeTruncated: boolean;
      historyStaleAt: number | null;
      detailLastLoadedAt: number | null;
      historyError: string | null;
      sessionLabel: string | null;
      statusHint: string | null;
      canPauseForApproval: boolean;
      pausedForApproval: boolean;
      pausedRunId: string | null;
      pendingExecApprovalsCount: number;
      pendingExecApprovalsReady: boolean;
      approvalsCoverage: "unknown" | "covered" | "uncovered";
      meta: {
        createdAt: string | null;
        updatedAt: string | null;
      };
    }>;
    sessionCreatedAgentIds: string[];
    sessionSettingsSyncedAgentIds: string[];
    summaryPatches: Array<{ agentId: string; patch: Record<string, unknown> }>;
    suggestedSelectedAgentId: string | null;
    configSnapshot: Record<string, unknown> | null;
  };
};

const DEFAULT_FLEET_RESULT: RuntimeRouteFixture["fleetResult"] = {
  seeds: [],
  sessionCreatedAgentIds: [],
  sessionSettingsSyncedAgentIds: [],
  summaryPatches: [],
  suggestedSelectedAgentId: null,
  configSnapshot: null,
};

export const stubRuntimeRoutes = async (page: Page, fixture: RuntimeRouteFixture = {}) => {
  await page.route("**/api/runtime/fleet", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        result: fixture.fleetResult ?? DEFAULT_FLEET_RESULT,
      }),
    });
  });

  await page.route("**/api/runtime/summary", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    const asOf = new Date().toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        summary: {
          status: "connected",
          reason: null,
          asOf,
          outboxHead: 0,
        },
        freshness: {
          source: "gateway",
          stale: false,
          asOf,
        },
      }),
    });
  });

  await page.route("**/api/runtime/agents/*/history*", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    const asOf = new Date().toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        entries: [],
        hasMore: false,
        nextBeforeOutboxId: null,
        freshness: {
          source: "gateway",
          stale: false,
          asOf,
        },
      }),
    });
  });

  await page.route("**/api/runtime/stream", async (route, request) => {
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: ": heartbeat\n\n",
      headers: {
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });
};
