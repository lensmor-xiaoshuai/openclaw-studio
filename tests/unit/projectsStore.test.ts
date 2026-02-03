import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Project, ProjectsStore } from "@/lib/projects/types";
import { buildSessionKey } from "@/lib/projects/sessionKey";

type WorkspaceSelection = {
  workspacePath: string | null;
  workspaceName: string | null;
  warnings: string[];
};

type StoreModule = typeof import("@/app/api/projects/store");

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-store-test-"));

const makeProject = (id: string, repoPath: string): Project => ({
  id,
  name: `Project ${id}`,
  repoPath,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  tiles: [
    {
      id: `${id}-tile`,
      name: `${id} tile`,
      agentId: "legacy-agent",
      role: "coding",
      sessionKey: `agent:legacy-agent:studio:${id}-tile`,
      workspacePath: "/legacy",
      archivedAt: null,
      model: null,
      thinkingLevel: null,
      avatarSeed: null,
      position: { x: 0, y: 0 },
      size: { width: 420, height: 520 },
    },
  ],
});

const loadStoreModule = async ({
  storeDir,
  workspaceSelection,
  defaultAgentId = "main",
  config = {},
}: {
  storeDir: string;
  workspaceSelection: WorkspaceSelection;
  defaultAgentId?: string;
  config?: Record<string, unknown>;
}): Promise<StoreModule> => {
  vi.resetModules();
  vi.doMock("@/lib/projects/worktrees.server", () => ({
    resolveAgentCanvasDir: () => storeDir,
  }));
  vi.doMock("@/lib/studio/workspaceSettings.server", () => ({
    resolveWorkspaceSelection: () => workspaceSelection,
  }));
  vi.doMock("@/lib/clawdbot/config", () => ({
    loadClawdbotConfig: () => ({
      config,
      configPath: path.join(storeDir, "openclaw.json"),
    }),
  }));
  vi.doMock("@/lib/clawdbot/resolveDefaultAgent", () => ({
    resolveDefaultAgentId: () => defaultAgentId,
  }));
  return import("@/app/api/projects/store");
};

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("projectsStore", () => {
  it("loadStore_canonicalizes_to_single_workspace", async () => {
    const storeDir = makeTempDir();
    const initial: ProjectsStore = {
      version: 3,
      activeProjectId: "project-b",
      projects: [
        makeProject("project-a", "/workspace/alpha"),
        makeProject("project-b", "/workspace/beta"),
      ],
      needsWorkspace: false,
    };
    fs.writeFileSync(
      path.join(storeDir, "projects.json"),
      JSON.stringify(initial, null, 2),
      "utf8"
    );

    const mod = await loadStoreModule({
      storeDir,
      workspaceSelection: {
        workspacePath: "/workspace/alpha",
        workspaceName: "Alpha Workspace",
        warnings: [],
      },
      defaultAgentId: "main-agent",
      config: {},
    });

    const store = mod.loadStore();
    expect(store.projects).toHaveLength(1);
    expect(store.activeProjectId).toBe("project-a");
    expect(store.needsWorkspace).toBe(false);

    const project = store.projects[0];
    expect(project.name).toBe("Alpha Workspace");
    expect(project.repoPath).toBe("/workspace/alpha");
    expect(project.tiles[0].agentId).toBe("main-agent");
    expect(project.tiles[0].sessionKey).toBe(
      buildSessionKey("main-agent", project.tiles[0].id)
    );
    expect(project.tiles[0].workspacePath).toBe("/workspace/alpha");

    const legacyPath = path.join(storeDir, "legacy-projects.json");
    expect(fs.existsSync(legacyPath)).toBe(true);
    const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as {
      legacyProjects: Project[];
    };
    expect(legacy.legacyProjects).toHaveLength(1);
    expect(legacy.legacyProjects[0].id).toBe("project-b");
  });

  it("loadStore_sets_needsWorkspace_when_unresolved", async () => {
    const storeDir = makeTempDir();
    const mod = await loadStoreModule({
      storeDir,
      workspaceSelection: {
        workspacePath: null,
        workspaceName: null,
        warnings: ["Workspace not configured"],
      },
      config: {},
    });

    const store = mod.loadStore();
    expect(store).toEqual({
      version: 3,
      activeProjectId: null,
      projects: [],
      needsWorkspace: true,
    });
    expect(fs.existsSync(path.join(storeDir, "projects.json"))).toBe(true);
  });

  it("loadStore_migrates_legacy_v1_payload", async () => {
    const storeDir = makeTempDir();
    fs.writeFileSync(
      path.join(storeDir, "projects.json"),
      JSON.stringify(
        {
          version: 1,
          activeProjectId: "project-v1",
          projects: [
            {
              ...makeProject("project-v1", "/workspace/v1"),
              tiles: [
                {
                  ...makeProject("project-v1", "/workspace/v1").tiles[0],
                  sessionKey: "agent:legacy:studio:project-v1-tile",
                  agentId: undefined,
                  role: undefined,
                  workspacePath: undefined,
                  archivedAt: undefined,
                },
              ],
            },
          ],
        },
        null,
        2
      ),
      "utf8"
    );

    const mod = await loadStoreModule({
      storeDir,
      workspaceSelection: {
        workspacePath: "/workspace/v1",
        workspaceName: null,
        warnings: [],
      },
      defaultAgentId: "main-agent",
      config: {},
    });

    const store = mod.loadStore();
    expect(store.version).toBe(3);
    expect(store.projects).toHaveLength(1);
    expect(store.projects[0].tiles[0].agentId).toBe("main-agent");
    expect(store.projects[0].tiles[0].role).toBe("coding");
    expect(store.projects[0].tiles[0].workspacePath).toBe("/workspace/v1");
  });

  it("normalizeProjectsStore_sets_active_to_first_non_archived", async () => {
    const storeDir = makeTempDir();
    const mod = await loadStoreModule({
      storeDir,
      workspaceSelection: { workspacePath: null, workspaceName: null, warnings: [] },
      config: {},
    });
    const now = Date.now();
    const normalized = mod.normalizeProjectsStore({
      version: 3,
      activeProjectId: "missing",
      projects: [
        { ...makeProject("archived", "/workspace/a"), archivedAt: now },
        makeProject("active", "/workspace/b"),
      ],
      needsWorkspace: false,
    });
    expect(normalized.activeProjectId).toBe("active");
  });
});
