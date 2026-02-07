import { NextResponse } from "next/server";

import {
  createTaskControlPlaneBrRunner,
  isBeadsWorkspaceError,
} from "@/lib/task-control-plane/br-runner";

export const runtime = "nodejs";

const extractId = (request: Request): string => {
  let id: string | null = null;
  try {
    id = new URL(request.url).searchParams.get("id");
  } catch {
    id = null;
  }
  const trimmed = id?.trim() ?? "";
  if (!trimmed) {
    throw new Error('Missing required query parameter: "id".');
  }
  return trimmed;
};

const coerceSingleRecord = (value: unknown, id: string): Record<string, unknown> => {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Unexpected br show --json output for ${id}.`);
  }
  return record as Record<string, unknown>;
};

export async function GET(request: Request) {
  try {
    const id = extractId(request);
    const runner = createTaskControlPlaneBrRunner();
    const raw = runner.runBrJson(["show", id]);
    const bead = coerceSingleRecord(raw, id);
    return NextResponse.json({ bead });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load task details.";
    if (message.includes('Missing required query parameter: "id"')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
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
