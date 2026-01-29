import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import type { ProjectTileUpdatePayload } from "@/lib/projects/types";
import { resolveAgentWorkspaceDir } from "@/lib/projects/agentWorkspace";
import { deleteAgentArtifacts } from "@/lib/projects/fs.server";
import { resolveProjectTileOrResponse } from "@/app/api/projects/resolveResponse";
import {
  removeAgentEntry,
  updateClawdbotConfig,
  upsertAgentEntry,
} from "@/lib/clawdbot/config";
import { loadStore, removeTileFromProject, saveStore, updateTileInProject } from "../../../store";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const { projectId, tileId } = await context.params;
    const store = loadStore();
    const resolved = resolveProjectTileOrResponse(store, projectId, tileId);
    if (!resolved.ok) {
      return resolved.response;
    }
    const { projectId: resolvedProjectId, tileId: resolvedTileId, tile } = resolved;

    const warnings: string[] = [];
    if (!tile.agentId?.trim()) {
      warnings.push(`Missing agentId for tile ${tile.id}; skipped agent cleanup.`);
    } else {
      deleteAgentArtifacts(resolvedProjectId, tile.agentId, warnings);
      const { warnings: configWarnings } = updateClawdbotConfig((config) =>
        removeAgentEntry(config, tile.agentId)
      );
      warnings.push(...configWarnings);
    }

    const { store: nextStore, removed } = removeTileFromProject(
      store,
      resolvedProjectId,
      resolvedTileId
    );
    if (!removed) {
      return NextResponse.json({ error: "Tile not found." }, { status: 404 });
    }
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete tile.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; tileId: string }> }
) {
  try {
    const { projectId, tileId } = await context.params;
    const body = (await request.json()) as ProjectTileUpdatePayload;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const avatarSeed =
      typeof body?.avatarSeed === "string" ? body.avatarSeed.trim() : "";
    if (!name && !avatarSeed) {
      return NextResponse.json(
        { error: "Tile update requires a name or avatar seed." },
        { status: 400 }
      );
    }
    if (body?.avatarSeed !== undefined && !avatarSeed) {
      return NextResponse.json({ error: "Avatar seed is invalid." }, { status: 400 });
    }

    const store = loadStore();
    const resolved = resolveProjectTileOrResponse(store, projectId, tileId);
    if (!resolved.ok) {
      return resolved.response;
    }
    const { projectId: resolvedProjectId, tileId: resolvedTileId, tile } = resolved;

    const warnings: string[] = [];
    if (name) {
      const nextWorkspaceDir = resolveAgentWorkspaceDir(
        resolvedProjectId,
        tile.agentId
      );
      const { warnings: configWarnings } = updateClawdbotConfig((config) =>
        upsertAgentEntry(config, {
          agentId: tile.agentId,
          agentName: name,
          workspaceDir: nextWorkspaceDir,
        })
      );
      warnings.push(...configWarnings);
    }

    const patch = {
      ...(name ? { name } : {}),
      ...(avatarSeed ? { avatarSeed } : {}),
    };
    const nextStore = updateTileInProject(
      store,
      resolvedProjectId,
      resolvedTileId,
      patch
    );
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to rename tile.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
