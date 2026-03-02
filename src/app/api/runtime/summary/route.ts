import { NextResponse } from "next/server";

import { deriveRuntimeFreshness, probeOpenClawLocalState } from "@/lib/controlplane/degraded-read";
import { serializeRuntimeInitFailure } from "@/lib/controlplane/runtime-init-errors";
import { bootstrapDomainRuntime } from "@/lib/controlplane/runtime-route-bootstrap";

export const runtime = "nodejs";

export async function GET() {
  const bootstrap = await bootstrapDomainRuntime();
  if (bootstrap.kind === "mode-disabled") {
    return NextResponse.json({ enabled: false, error: "domain_api_mode_disabled" }, { status: 404 });
  }
  if (bootstrap.kind === "runtime-init-failed") {
    return NextResponse.json(
      {
        enabled: true,
        ...serializeRuntimeInitFailure(bootstrap.failure),
      },
      { status: 503 }
    );
  }
  const controlPlane = bootstrap.runtime;
  const startError = bootstrap.kind === "start-failed" ? bootstrap.message : null;

  const snapshot = controlPlane.snapshot();
  const probe = snapshot.status === "connected" ? null : await probeOpenClawLocalState();
  return NextResponse.json({
    enabled: true,
    ...(startError ? { error: startError } : {}),
    summary: snapshot,
    freshness: deriveRuntimeFreshness(snapshot, probe),
    ...(probe ? { probe } : {}),
  });
}
