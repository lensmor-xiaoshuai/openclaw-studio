import { NextResponse } from "next/server";

import {
  createTaskControlPlaneBrRunner,
  isBeadsWorkspaceError,
} from "@/lib/task-control-plane/br-runner";

export const runtime = "nodejs";

const extractPayload = async (
  request: Request
): Promise<{ id: string; priority: number }> => {
  const body = (await request.json()) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid JSON body.");
  }
  const record = body as Record<string, unknown>;

  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) throw new Error('Missing required field: "id".');

  const priority = record.priority;
  if (typeof priority !== "number" || !Number.isInteger(priority)) {
    throw new Error('Missing required field: "priority".');
  }
  if (priority < 0 || priority > 4) {
    throw new Error("Priority must be between 0 and 4.");
  }

  return { id, priority };
};

const coerceSingleRecord = (value: unknown, id: string): Record<string, unknown> => {
  const record = Array.isArray(value) ? value[0] : value;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`Unexpected br update --json output for ${id}.`);
  }
  return record as Record<string, unknown>;
};

export async function POST(request: Request) {
  try {
    const payload = await extractPayload(request);
    const runner = createTaskControlPlaneBrRunner();
    const raw = runner.runBrJson([
      "update",
      "--priority",
      String(payload.priority),
      payload.id,
    ]);
    const bead = coerceSingleRecord(raw, payload.id);
    return NextResponse.json({ bead });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update task priority.";
    if (
      message.includes("Invalid JSON body.") ||
      message.includes('Missing required field: "id".') ||
      message.includes('Missing required field: "priority".') ||
      message.includes("Priority must be between 0 and 4.")
    ) {
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

