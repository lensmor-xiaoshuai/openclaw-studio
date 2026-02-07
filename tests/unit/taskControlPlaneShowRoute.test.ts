import { beforeEach, describe, expect, it, vi } from "vitest";

import { spawnSync } from "node:child_process";

import { GET } from "@/app/api/task-control-plane/show/route";

const ORIGINAL_ENV = { ...process.env };

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    default: actual,
    ...actual,
    spawnSync: vi.fn(),
  };
});

const mockedSpawnSync = vi.mocked(spawnSync);

describe("task control plane show route", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OPENCLAW_TASK_CONTROL_PLANE_BEADS_DIR;
    delete process.env.OPENCLAW_TASK_CONTROL_PLANE_GATEWAY_BEADS_DIR;
    delete process.env.OPENCLAW_TASK_CONTROL_PLANE_SSH_TARGET;
    delete process.env.OPENCLAW_TASK_CONTROL_PLANE_SSH_USER;
    mockedSpawnSync.mockReset();
  });

  it("returns bead details on success", async () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify([{ id: "bd-1", title: "Thing" }]),
      stderr: "",
      error: undefined,
    } as never);

    const response = await GET(
      new Request("http://example.test/api/task-control-plane/show?id=bd-1")
    );
    const body = (await response.json()) as { bead: unknown };

    expect(response.status).toBe(200);
    expect(body.bead).toMatchObject({ id: "bd-1", title: "Thing" });
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "br",
      ["show", "bd-1", "--json"],
      expect.objectContaining({ encoding: "utf8" })
    );
  });

  it("returns 400 when id is missing", async () => {
    const response = await GET(new Request("http://example.test/api/task-control-plane/show"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toContain("Missing required query parameter");
  });
});

