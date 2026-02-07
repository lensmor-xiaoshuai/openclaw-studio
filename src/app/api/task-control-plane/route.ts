import { NextResponse } from "next/server";

import {
  createTaskControlPlaneBrRunner,
  isBeadsWorkspaceError,
} from "@/lib/task-control-plane/br-runner";
import { buildTaskControlPlaneSnapshot } from "@/lib/task-control-plane/read-model";

export const runtime = "nodejs";

async function loadTaskControlPlaneRawData(): Promise<{
  scopePath: string | null;
  openIssues: unknown;
  inProgressIssues: unknown;
  blockedIssues: unknown;
  doneIssues: unknown;
}> {
  const runner = createTaskControlPlaneBrRunner();
  const scope = runner.runBrJson(["where"]);
  const openIssues = runner.runBrJson(["list", "--status", "open", "--limit", "0"]);
  const inProgressIssues = runner.runBrJson(["list", "--status", "in_progress", "--limit", "0"]);
  const blockedIssues = runner.runBrJson(["blocked", "--limit", "0"]);
  const doneIssues = runner.runBrJson(["list", "--status", "closed", "--limit", "0"]);
  return {
    scopePath: runner.parseScopePath(scope),
    openIssues,
    inProgressIssues,
    blockedIssues,
    doneIssues,
  };
}

export async function GET() {
  try {
    const raw = await loadTaskControlPlaneRawData();
    const snapshot = buildTaskControlPlaneSnapshot(raw);
    return NextResponse.json({ snapshot });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load task control plane data.";
    console.error(message);
    if (isBeadsWorkspaceError(message)) {
      return NextResponse.json(
        {
          error: "Beads workspace not initialized for this project. Run: br init --prefix <scope>.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
