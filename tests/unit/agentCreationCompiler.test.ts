import { describe, expect, it } from "vitest";
import {
  compileGuidedAgentCreation,
  createDefaultGuidedDraft,
  resolveGuidedControlsForPreset,
} from "@/features/agents/creation/compiler";

const createDraft = () => {
  const draft = createDefaultGuidedDraft();
  return {
    ...draft,
    starterKit: "engineer" as const,
    controlLevel: "balanced" as const,
    firstTask: "Refactor React components and open small diffs.",
    customInstructions: "Prefer minimal, test-backed diffs.",
    userProfile: "Product engineer who prefers concise summaries.",
    toolNotes: "Use git history and markdown formatting conventions.",
    memoryNotes: "Remember recurring formatting preferences.",
    heartbeatEnabled: true,
    heartbeatChecklist: ["Check stale release notes.", "Confirm source links.", "Report only blockers."],
  };
};

describe("compileGuidedAgentCreation", () => {
  it("compiles default starter draft without legacy outcome-form errors", () => {
    const result = compileGuidedAgentCreation({
      name: "Agent",
      draft: createDefaultGuidedDraft(),
    });
    expect(result.validation.errors).toEqual([]);
  });

  it("maps researcher + conservative to safe defaults", () => {
    const draft = createDraft();
    draft.starterKit = "researcher";
    draft.controlLevel = "conservative";
    draft.controls = resolveGuidedControlsForPreset({
      starterKit: draft.starterKit,
      controlLevel: draft.controlLevel,
    });
    const result = compileGuidedAgentCreation({
      name: "Research Agent",
      draft,
    });

    expect(result.validation.errors).toEqual([]);
    expect(result.agentOverrides.sandbox).toEqual({
      mode: "non-main",
      workspaceAccess: "ro",
    });
    expect(result.agentOverrides.tools?.profile).toBe("minimal");
    expect(result.agentOverrides.tools?.allow).toBeUndefined();
    expect(result.agentOverrides.tools?.alsoAllow).toContain("group:web");
    expect(result.agentOverrides.tools?.deny).toContain("group:runtime");
    expect(result.execApprovals).toBeNull();
  });

  it("maps engineer + balanced to coding defaults with runtime enabled", () => {
    const draft = createDraft();
    draft.starterKit = "engineer";
    draft.controlLevel = "balanced";
    draft.controls = resolveGuidedControlsForPreset({
      starterKit: draft.starterKit,
      controlLevel: draft.controlLevel,
    });
    const result = compileGuidedAgentCreation({
      name: "Engineer Agent",
      draft,
    });

    expect(result.validation.errors).toEqual([]);
    expect(result.files["AGENTS.md"]).toContain("First Task");
    expect(result.files["AGENTS.md"]).toContain("Refactor React components");
    expect(result.agentOverrides.tools?.profile).toBe("coding");
    expect(result.agentOverrides.tools?.alsoAllow).toContain("group:runtime");
    expect(result.agentOverrides.tools?.deny).not.toContain("group:runtime");
    expect(result.execApprovals).toEqual({
      security: "allowlist",
      ask: "on-miss",
      allowlist: [],
    });
  });

  it("maps marketer + conservative to messaging defaults", () => {
    const draft = createDraft();
    draft.starterKit = "marketer";
    draft.controlLevel = "conservative";
    draft.controls = resolveGuidedControlsForPreset({
      starterKit: draft.starterKit,
      controlLevel: draft.controlLevel,
    });
    const result = compileGuidedAgentCreation({
      name: "Marketing Agent",
      draft,
    });

    expect(result.validation.errors).toEqual([]);
    expect(result.agentOverrides.tools?.profile).toBe("messaging");
    expect(result.agentOverrides.tools?.alsoAllow).toContain("group:web");
    expect(result.agentOverrides.tools?.deny).toContain("group:runtime");
    expect(result.execApprovals).toBeNull();
  });

  it("keeps contradiction validation for manual control overrides", () => {
    const draft = createDraft();
    draft.controlLevel = "autopilot";
    draft.controls = resolveGuidedControlsForPreset({
      starterKit: draft.starterKit,
      controlLevel: draft.controlLevel,
    });
    draft.controls.allowExec = false;

    const result = compileGuidedAgentCreation({
      name: "Broken Agent",
      draft,
    });

    expect(result.validation.errors).toContain("Auto exec requires runtime tools to be enabled.");
  });
});
