import { NextResponse } from "next/server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { logger } from "@/lib/logger";
import type {
  Project,
  ProjectCreateOrOpenPayload,
  ProjectCreateOrOpenResult,
  ProjectsStore,
} from "@/lib/projects/types";
import { resolveUserPath } from "@/lib/clawdbot/paths";
import { ensureGitRepo } from "@/lib/fs/git";
import { slugifyProjectName } from "@/lib/ids/slugify";
import { appendProjectToStore, loadStore, normalizeProjectsStore, saveStore } from "./store";

export const runtime = "nodejs";

type ProjectCreateOrOpenParseResult =
  | { ok: true; mode: "create"; name: string }
  | { ok: true; mode: "open"; path: string }
  | { ok: false; error: string };

export const parseProjectCreateOrOpenPayload = (
  body: unknown
): ProjectCreateOrOpenParseResult => {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Workspace name or path is required." };
  }
  const record = body as Record<string, unknown>;
  const hasName = Object.prototype.hasOwnProperty.call(record, "name");
  const hasPath = Object.prototype.hasOwnProperty.call(record, "path");
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const workspacePath = typeof record.path === "string" ? record.path.trim() : "";

  if (hasName && hasPath) {
    return {
      ok: false,
      error: "Workspace name and path cannot be provided together.",
    };
  }
  if (hasName) {
    if (!name) {
      return { ok: false, error: "Workspace name is required." };
    }
    return { ok: true, mode: "create", name };
  }
  if (hasPath) {
    if (!workspacePath) {
      return { ok: false, error: "Workspace path is required." };
    }
    return { ok: true, mode: "open", path: workspacePath };
  }

  return { ok: false, error: "Workspace name or path is required." };
};

export async function GET() {
  try {
    const store = normalizeProjectsStore(loadStore());
    return NextResponse.json(store);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load workspace.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let operation: "create" | "open" | null = null;
  try {
    const body = (await request.json()) as ProjectCreateOrOpenPayload;
    const parsed = parseProjectCreateOrOpenPayload(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    operation = parsed.mode;

    if (parsed.mode === "create") {
      let slug = "";
      try {
        slug = slugifyProjectName(parsed.name);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Workspace name produced an empty folder name.";
        return NextResponse.json({ error: message }, { status: 400 });
      }

      const store = loadStore();
      const { repoPath, warnings: pathWarnings } = resolveProjectPath(slug);
      const gitResult = ensureGitRepo(repoPath);
      const warnings = [...pathWarnings, ...gitResult.warnings];

      const now = Date.now();
      const project: Project = {
        id: randomUUID(),
        name: parsed.name,
        repoPath,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        tiles: [],
      };

      const nextStore = appendProjectToStore(store, project);

      saveStore(nextStore);

      if (warnings.length > 0) {
        logger.warn(`Workspace created with warnings: ${warnings.join(" ")}`);
      }

      const result: ProjectCreateOrOpenResult = {
        store: nextStore,
        warnings,
      };

      return NextResponse.json(result);
    }

    if (
      !path.isAbsolute(parsed.path) &&
      parsed.path !== "~" &&
      !parsed.path.startsWith("~/")
    ) {
      return NextResponse.json(
        { error: "Workspace path must be an absolute path." },
        { status: 400 }
      );
    }
    const resolvedPath = resolveUserPath(parsed.path);
    if (!fs.existsSync(resolvedPath)) {
      return NextResponse.json(
        { error: `Workspace path does not exist: ${resolvedPath}` },
        { status: 404 }
      );
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: `Workspace path is not a directory: ${resolvedPath}` },
        { status: 400 }
      );
    }

    const repoPath = fs.realpathSync(resolvedPath);
    const name = path.basename(repoPath);
    if (!name || name === path.parse(repoPath).root) {
      return NextResponse.json(
        { error: "Workspace path must point to a directory with a name." },
        { status: 400 }
      );
    }

    const store = loadStore();
    if (store.projects.some((project) => project.repoPath === repoPath)) {
      return NextResponse.json(
        { error: "Workspace already exists for this path." },
        { status: 409 }
      );
    }

    const warnings: string[] = [];
    if (!fs.existsSync(path.join(repoPath, ".git"))) {
      warnings.push("No .git directory found for this workspace path.");
    }

    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      name,
      repoPath,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      tiles: [],
    };

    const nextStore = appendProjectToStore(store, project);

    saveStore(nextStore);

    if (warnings.length > 0) {
      logger.warn(`Workspace opened with warnings: ${warnings.join(" ")}`);
    }

    const result: ProjectCreateOrOpenResult = {
      store: nextStore,
      warnings,
    };

    return NextResponse.json(result);
  } catch (err) {
    const fallback =
      operation === "open" ? "Failed to open workspace." : "Failed to create workspace.";
    const message = err instanceof Error ? err.message : fallback;
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as ProjectsStore;
    if (!body || !Array.isArray(body.projects)) {
      return NextResponse.json({ error: "Invalid workspace payload." }, { status: 400 });
    }
    const normalized = normalizeProjectsStore(body);
    saveStore(normalized);
    return NextResponse.json(normalized);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save workspace.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const resolveProjectPath = (slug: string): { repoPath: string; warnings: string[] } => {
  const warnings: string[] = [];
  const basePath = path.join(os.homedir(), slug);
  if (!fs.existsSync(basePath)) {
    return { repoPath: basePath, warnings };
  }
  let suffix = 2;
  let candidate = basePath;
  while (fs.existsSync(candidate)) {
    candidate = path.join(os.homedir(), `${slug}-${suffix}`);
    suffix += 1;
  }
  warnings.push(`Workspace folder already exists. Created ${candidate} instead.`);
  return { repoPath: candidate, warnings };
};
