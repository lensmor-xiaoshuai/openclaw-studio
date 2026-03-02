import { expect, test } from "@playwright/test";
import { stubStudioRoute } from "./helpers/studioRoute";
import { stubRuntimeRoutes } from "./helpers/runtimeRoute";

test("connection settings persist to the studio settings API", async ({ page }) => {
  await stubStudioRoute(page);
  await stubRuntimeRoutes(page);

  await page.goto("/");
  await page.getByTestId("studio-menu-toggle").click();
  await page.getByTestId("gateway-settings-toggle").click();
  await expect(page.getByLabel(/Upstream (gateway )?URL/i)).toBeVisible();

  await page.getByLabel(/Upstream (gateway )?URL/i).fill("ws://gateway.example:18789");
  await page.getByLabel("Upstream token").fill("token-123");

  const request = await page.waitForRequest((req) => {
    if (!req.url().includes("/api/studio") || req.method() !== "PUT") {
      return false;
    }
    const payload = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
    const gateway = (payload.gateway ?? {}) as { url?: string; token?: string };
    return gateway.url === "ws://gateway.example:18789" && gateway.token === "token-123";
  });

  const payload = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
  const gateway = (payload.gateway ?? {}) as { url?: string; token?: string };
  expect(gateway.url).toBe("ws://gateway.example:18789");
  expect(gateway.token).toBe("token-123");
  await expect(
    page.getByRole("button", { name: /^(Connect|Disconnect)$/ })
  ).toBeVisible();
});
