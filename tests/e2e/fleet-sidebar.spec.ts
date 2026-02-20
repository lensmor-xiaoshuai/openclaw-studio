import { expect, test } from "@playwright/test";

type StudioSettingsFixture = {
  version: 1;
  gateway: { url: string; token: string } | null;
  focused: Record<string, { mode: "focused"; filter: string; selectedAgentId: string | null }>;
  avatars: Record<string, Record<string, string>>;
};

const DEFAULT_SETTINGS: StudioSettingsFixture = {
  version: 1,
  gateway: null,
  focused: {},
  avatars: {},
};

const createStudioRoute = (initial: StudioSettingsFixture = DEFAULT_SETTINGS) => {
  let settings: StudioSettingsFixture = {
    version: 1,
    gateway: initial.gateway ?? null,
    focused: { ...(initial.focused ?? {}) },
    avatars: { ...(initial.avatars ?? {}) },
  };

  return async (
    route: { fulfill: (args: Record<string, unknown>) => Promise<void>; fallback: () => Promise<void> },
    request: { method: () => string; postData: () => string | null }
  ) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ settings }),
      });
      return;
    }
    if (request.method() !== "PUT") {
      await route.fallback();
      return;
    }

    const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    const next = { ...settings };

    if ("gateway" in patch) {
      next.gateway = (patch.gateway as StudioSettingsFixture["gateway"]) ?? null;
    }

    if (patch.focused && typeof patch.focused === "object") {
      const focusedPatch = patch.focused as Record<string, Record<string, unknown>>;
      const focusedNext = { ...next.focused };
      for (const [key, value] of Object.entries(focusedPatch)) {
        const existing = focusedNext[key] ?? {
          mode: "focused" as const,
          filter: "all",
          selectedAgentId: null,
        };
        focusedNext[key] = {
          mode: (value.mode as "focused") ?? existing.mode,
          filter: (value.filter as string) ?? existing.filter,
          selectedAgentId:
            "selectedAgentId" in value
              ? ((value.selectedAgentId as string | null) ?? null)
              : existing.selectedAgentId,
        };
      }
      next.focused = focusedNext;
    }

    if (patch.avatars && typeof patch.avatars === "object") {
      const avatarsPatch = patch.avatars as Record<string, Record<string, string | null> | null>;
      const avatarsNext: StudioSettingsFixture["avatars"] = { ...next.avatars };
      for (const [gatewayKey, gatewayPatch] of Object.entries(avatarsPatch)) {
        if (gatewayPatch === null) {
          delete avatarsNext[gatewayKey];
          continue;
        }
        const existing = avatarsNext[gatewayKey] ? { ...avatarsNext[gatewayKey] } : {};
        for (const [agentId, seedPatch] of Object.entries(gatewayPatch)) {
          if (seedPatch === null) {
            delete existing[agentId];
            continue;
          }
          const seed = typeof seedPatch === "string" ? seedPatch.trim() : "";
          if (!seed) {
            delete existing[agentId];
            continue;
          }
          existing[agentId] = seed;
        }
        avatarsNext[gatewayKey] = existing;
      }
      next.avatars = avatarsNext;
    }

    settings = next;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ settings }),
    });
  };
};

test("switches_active_agent_from_sidebar", async ({ page }) => {
  await page.route("**/api/studio", createStudioRoute());
  await page.goto("/");

  const agentPanel = page.locator("[data-agent-panel]");
  await expect(agentPanel).toContainText("youtube-channel");

  await page.getByRole("button", { name: /Avatar for main/i }).click();
  await expect(agentPanel).toContainText("main");

  await page.getByRole("button", { name: /Avatar for Web Researcher/i }).click();
  await expect(agentPanel).toContainText("Web Researcher");
});

test("applies_filters", async ({ page }) => {
  await page.route("**/api/studio", createStudioRoute());
  await page.goto("/");

  await page.getByTestId("fleet-filter-running").click();
  await expect(page.getByTestId("fleet-filter-running")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("fleet-filter-all")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("fleet-filter-idle").click();
  await expect(page.getByTestId("fleet-filter-idle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("fleet-filter-running")).toHaveAttribute("aria-pressed", "false");
});

test("focused_preferences_persist_across_reload", async ({ page }) => {
  await page.route("**/api/studio", createStudioRoute());
  await page.goto("/");

  await page.getByTestId("studio-menu-toggle").click();
  await expect(page.getByTestId("gateway-settings-toggle")).toBeVisible();

  await page.reload();

  await expect(page.getByTestId("studio-menu-toggle")).toBeVisible();
});

test("clears_unseen_indicator_on_focus", async ({ page }) => {
  await page.route("**/api/studio", createStudioRoute());
  await page.goto("/");

  await page.getByTestId("studio-menu-toggle").click();
  await expect(page.getByTestId("gateway-settings-toggle")).toBeVisible();
});
