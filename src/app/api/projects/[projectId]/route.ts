import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import {
  removeAgentEntry,
  updateClawdbotConfig,
} from "@/lib/clawdbot/config";
import { deleteAgentArtifacts } from "@/lib/projects/fs.server";
import { resolveProjectOrResponse } from "@/app/api/projects/resolveResponse";
import { loadStore, removeProjectFromStore, saveStore } from "../store";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const store = loadStore();
    const resolved = resolveProjectOrResponse(store, projectId);
    if (!resolved.ok) {
      return resolved.response;
    }
    const { projectId: resolvedProjectId, project } = resolved;

    const warnings: string[] = [];
    const agentIds: string[] = [];
    for (const tile of project.tiles) {
      if (!tile.agentId?.trim()) {
        warnings.push(`Missing agentId for tile ${tile.id}; skipped agent cleanup.`);
        continue;
      }
      deleteAgentArtifacts(resolvedProjectId, tile.agentId, warnings);
      agentIds.push(tile.agentId);
    }
    const { warnings: configWarnings } = updateClawdbotConfig((config) => {
      let changed = false;
      for (const agentId of agentIds) {
        if (removeAgentEntry(config, agentId)) {
          changed = true;
        }
      }
      return changed;
    });
    warnings.push(...configWarnings);

    const { store: nextStore } = removeProjectFromStore(store, resolvedProjectId);
    saveStore(nextStore);
    return NextResponse.json({ store: nextStore, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete workspace.";
    logger.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
