import type { Page } from "@playwright/test";
import type { AgentStoreSeed } from "@/features/agents/state/store";

type RuntimeRouteFixture = {
  fleetResult?: {
    seeds: AgentStoreSeed[];
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
        messages: [],
        hasMore: false,
        semanticTurnsIncluded: 0,
        windowTruncated: false,
        gatewayLimit: 200,
        gatewayCapped: false,
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
