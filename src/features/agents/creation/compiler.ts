import type { AgentFileName } from "@/lib/agents/agentFiles";
import type {
  AgentControlLevel,
  AgentStarterKit,
  GuidedAgentCreationCompileResult,
  GuidedAgentCreationDraft,
  GuidedCreationControls,
} from "@/features/agents/creation/types";

const normalizeLineList = (values: string[]): string[] => {
  const next = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(next));
};

const renderList = (values: string[], marker: "-" | "1"): string => {
  if (marker === "1") {
    return values.map((value, index) => `${index + 1}. ${value}`).join("\n");
  }
  return values.map((value) => `- ${value}`).join("\n");
};

const firstNonEmpty = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const defaultHeartbeatChecklist = [
  "Check for open blockers tied to my goal.",
  "List one next action if attention is required.",
  "If nothing needs attention, reply HEARTBEAT_OK.",
];

type StarterTemplate = {
  label: string;
  role: string;
  mission: string;
  tone: string;
  guardrails: string[];
  defaultFirstTask: string;
  exampleTasks: string[];
  toolsProfile: GuidedCreationControls["toolsProfile"];
  allowExecByDefault: boolean;
  baseAlsoAllow: string[];
  baseDeny: string[];
};

const STARTER_TEMPLATES: Record<AgentStarterKit, StarterTemplate> = {
  researcher: {
    label: "Researcher",
    role: "Research analyst",
    mission: "Collect trustworthy sources and synthesize concise findings.",
    tone: "Be precise, cite uncertainty clearly, and avoid unsupported claims.",
    guardrails: [
      "Do not invent sources or confidence.",
      "Highlight unknowns explicitly.",
      "Prefer summaries with citations over broad advice.",
    ],
    defaultFirstTask: "Research current options and produce a cited decision brief.",
    exampleTasks: [
      "Compare two approaches with pros, cons, and source notes.",
      "Summarize updates from the last week with evidence links.",
    ],
    toolsProfile: "minimal",
    allowExecByDefault: false,
    baseAlsoAllow: ["group:web"],
    baseDeny: ["group:runtime"],
  },
  engineer: {
    label: "Software Engineer",
    role: "Software engineer",
    mission: "Implement safe, test-backed code changes with minimal diff surface area.",
    tone: "Be direct, specific, and explicit about risks and tradeoffs.",
    guardrails: [
      "Prefer small changes over broad refactors.",
      "Explain file-level impact before risky edits.",
      "Call out test coverage and remaining risk.",
    ],
    defaultFirstTask: "Fix one scoped issue and include tests that prove the behavior.",
    exampleTasks: [
      "Implement a focused feature with tests and concise notes.",
      "Debug a failing test and submit a minimal patch.",
    ],
    toolsProfile: "coding",
    allowExecByDefault: true,
    baseAlsoAllow: [],
    baseDeny: [],
  },
  marketer: {
    label: "Digital Marketer",
    role: "Marketing operator",
    mission: "Draft growth assets and recommendations without publishing externally by default.",
    tone: "Be practical, outcome-oriented, and audience-aware.",
    guardrails: [
      "Do not publish or send outbound messages without explicit approval.",
      "Call out assumptions about audience and channel fit.",
      "Prefer reusable messaging frameworks over one-off copy.",
    ],
    defaultFirstTask: "Draft a campaign brief with channel-specific copy suggestions.",
    exampleTasks: [
      "Create social copy variants for one announcement.",
      "Draft a weekly marketing summary with next actions.",
    ],
    toolsProfile: "messaging",
    allowExecByDefault: false,
    baseAlsoAllow: ["group:web"],
    baseDeny: ["group:runtime"],
  },
  "chief-of-staff": {
    label: "Chief of Staff",
    role: "Operations coordinator",
    mission: "Track priorities, summarize status, and keep follow-ups moving.",
    tone: "Be concise, structured, and deadline-aware.",
    guardrails: [
      "Escalate blockers early.",
      "Keep summaries action-focused.",
      "Avoid acting externally without approval.",
    ],
    defaultFirstTask: "Create a short weekly operating review with priorities and blockers.",
    exampleTasks: [
      "Summarize active work and identify the top blocker.",
      "Draft a weekly checkpoint with owners and deadlines.",
    ],
    toolsProfile: "minimal",
    allowExecByDefault: false,
    baseAlsoAllow: [],
    baseDeny: ["group:runtime"],
  },
  blank: {
    label: "Blank Starter",
    role: "General assistant",
    mission: "Provide practical support with explicit boundaries and clear next actions.",
    tone: "Be clear, concise, and transparent about uncertainty.",
    guardrails: [
      "Ask before taking irreversible actions.",
      "Prefer concrete next steps over abstract advice.",
      "State assumptions when context is incomplete.",
    ],
    defaultFirstTask: "Handle one concrete task end-to-end and summarize results.",
    exampleTasks: [
      "Draft a plan for a requested task.",
      "Summarize recent activity and propose next steps.",
    ],
    toolsProfile: "minimal",
    allowExecByDefault: false,
    baseAlsoAllow: [],
    baseDeny: ["group:runtime"],
  },
};

type ControlDefaults = {
  execAutonomy: GuidedCreationControls["execAutonomy"];
  fileEditAutonomy: GuidedCreationControls["fileEditAutonomy"];
  sandboxMode: GuidedCreationControls["sandboxMode"];
  workspaceAccess: GuidedCreationControls["workspaceAccess"];
  approvalSecurity: GuidedCreationControls["approvalSecurity"];
  approvalAsk: GuidedCreationControls["approvalAsk"];
};

const CONTROL_DEFAULTS: Record<AgentControlLevel, ControlDefaults> = {
  conservative: {
    execAutonomy: "ask-first",
    fileEditAutonomy: "propose-only",
    sandboxMode: "non-main",
    workspaceAccess: "ro",
    approvalSecurity: "allowlist",
    approvalAsk: "always",
  },
  balanced: {
    execAutonomy: "ask-first",
    fileEditAutonomy: "propose-only",
    sandboxMode: "non-main",
    workspaceAccess: "ro",
    approvalSecurity: "allowlist",
    approvalAsk: "on-miss",
  },
  autopilot: {
    execAutonomy: "auto",
    fileEditAutonomy: "auto-edit",
    sandboxMode: "all",
    workspaceAccess: "rw",
    approvalSecurity: "full",
    approvalAsk: "off",
  },
};

const resolveStarterTemplate = (starterKit: AgentStarterKit): StarterTemplate =>
  STARTER_TEMPLATES[starterKit] ?? STARTER_TEMPLATES.engineer;

export const resolveGuidedControlsForPreset = (params: {
  starterKit: AgentStarterKit;
  controlLevel: AgentControlLevel;
}): GuidedCreationControls => {
  const starter = resolveStarterTemplate(params.starterKit);
  const control = CONTROL_DEFAULTS[params.controlLevel];
  const allowExec = params.controlLevel === "autopilot" ? true : starter.allowExecByDefault;
  return {
    allowExec,
    execAutonomy: control.execAutonomy,
    fileEditAutonomy: control.fileEditAutonomy,
    sandboxMode: control.sandboxMode,
    workspaceAccess: control.workspaceAccess,
    toolsProfile: starter.toolsProfile,
    toolsAllow: [...starter.baseAlsoAllow],
    toolsDeny: [...starter.baseDeny],
    approvalSecurity: control.approvalSecurity,
    approvalAsk: control.approvalAsk,
    approvalAllowlist: [],
  };
};

export const createDefaultGuidedDraft = (): GuidedAgentCreationDraft => ({
  starterKit: "engineer",
  controlLevel: "balanced",
  firstTask: "",
  customInstructions: "",
  userProfile: "",
  toolNotes: "",
  memoryNotes: "",
  heartbeatEnabled: false,
  heartbeatChecklist: [...defaultHeartbeatChecklist],
  controls: resolveGuidedControlsForPreset({
    starterKit: "engineer",
    controlLevel: "balanced",
  }),
});

export const compileGuidedAgentCreation = (params: {
  name: string;
  draft: GuidedAgentCreationDraft;
}): GuidedAgentCreationCompileResult => {
  const name = params.name.trim();
  const starter = resolveStarterTemplate(params.draft.starterKit);
  const firstTask = firstNonEmpty(params.draft.firstTask, starter.defaultFirstTask);
  const customInstructions = params.draft.customInstructions.trim();
  const userProfile = params.draft.userProfile.trim();
  const toolNotes = params.draft.toolNotes.trim();
  const memoryNotes = params.draft.memoryNotes.trim();
  const heartbeatChecklist = normalizeLineList(params.draft.heartbeatChecklist);

  const toolsAllow = normalizeLineList(params.draft.controls.toolsAllow);
  const toolsDeny = normalizeLineList(params.draft.controls.toolsDeny);
  const approvalAllowlist = normalizeLineList(params.draft.controls.approvalAllowlist).map(
    (pattern) => ({ pattern })
  );

  const ensureToolAlsoAllow = new Set(toolsAllow);
  const ensureToolDeny = new Set(toolsDeny);
  if (params.draft.controls.allowExec) {
    ensureToolAlsoAllow.add("group:runtime");
    ensureToolDeny.delete("group:runtime");
  } else {
    ensureToolDeny.add("group:runtime");
    ensureToolAlsoAllow.delete("group:runtime");
  }

  const normalizedAlsoAllow = Array.from(ensureToolAlsoAllow);
  const normalizedDeny = Array.from(ensureToolDeny).filter(
    (entry) => !ensureToolAlsoAllow.has(entry)
  );

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!name) errors.push("Agent name is required.");
  if (params.draft.controls.execAutonomy === "auto" && params.draft.controls.approvalSecurity === "deny") {
    errors.push("Auto exec cannot be enabled when approval security is set to deny.");
  }
  if (
    params.draft.controls.fileEditAutonomy === "auto-edit" &&
    params.draft.controls.workspaceAccess === "none"
  ) {
    errors.push("Auto file edits require sandbox workspace access ro or rw.");
  }
  if (params.draft.controls.execAutonomy === "auto" && !params.draft.controls.allowExec) {
    errors.push("Auto exec requires runtime tools to be enabled.");
  }

  if (!params.draft.firstTask.trim()) {
    warnings.push("First task is empty; using starter template default.");
  }
  if (!userProfile) {
    warnings.push("User profile is empty; USER.md will use a minimal default.");
  }
  if (params.draft.controls.allowExec && params.draft.controls.approvalSecurity === "allowlist" && approvalAllowlist.length === 0) {
    warnings.push("Approval security is allowlist with no patterns yet.");
  }

  const uncertaintyRule =
    params.draft.controls.execAutonomy === "auto"
      ? "When uncertain, take the best bounded action and explain your assumptions."
      : "When uncertain, ask for confirmation before taking action.";
  const fileEditRule =
    params.draft.controls.fileEditAutonomy === "auto-edit"
      ? "You may apply file edits directly within the configured workspace bounds."
      : "Propose file edits first and wait for explicit confirmation before applying.";

  const files: Partial<Record<AgentFileName, string>> = {
    "AGENTS.md": [
      "# Mission",
      starter.mission,
      "",
      "## First Task",
      firstTask,
      "",
      "## Example Tasks",
      renderList(starter.exampleTasks, "-"),
      "",
      "## Guardrails",
      renderList(starter.guardrails, "-"),
      customInstructions ? `\n## Custom Instructions\n${customInstructions}` : "",
      "",
      "## Operating Rules",
      `- ${uncertaintyRule}`,
      `- ${fileEditRule}`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
    "SOUL.md": [
      "# Voice",
      starter.tone,
      "",
      "# Boundaries",
      renderList(starter.guardrails, "-"),
    ].join("\n"),
    "IDENTITY.md": [
      "# Identity",
      `- Name: ${firstNonEmpty(name, "New Agent")}`,
      `- Role: ${starter.role}`,
      `- Starter kit: ${starter.label}`,
    ].join("\n"),
    "USER.md": [
      "# User",
      firstNonEmpty(
        userProfile,
        "The user values clear tradeoffs, practical progress, and direct communication."
      ),
    ].join("\n"),
    "TOOLS.md": [
      "# Tool Notes",
      firstNonEmpty(toolNotes, "No custom tool notes yet."),
      "",
      "These notes are guidance only and do not grant tool permissions.",
    ].join("\n"),
    "HEARTBEAT.md": params.draft.heartbeatEnabled
      ? ["# Heartbeat Checklist", renderList(heartbeatChecklist, "-")].join("\n\n")
      : "# Heartbeat\nHeartbeats are disabled for this agent by default.",
    "MEMORY.md": [
      "# Memory Seeds",
      firstNonEmpty(memoryNotes, "No durable memory seeds have been provided yet."),
    ].join("\n"),
  };

  const summary = [
    `Starter: ${starter.label}`,
    `Control level: ${params.draft.controlLevel}`,
    `Sandbox: ${params.draft.controls.sandboxMode}`,
    `Workspace access: ${params.draft.controls.workspaceAccess}`,
    `Tools profile: ${params.draft.controls.toolsProfile}`,
    params.draft.controls.allowExec
      ? `Exec approvals: ${params.draft.controls.approvalSecurity} / ${params.draft.controls.approvalAsk}`
      : "Exec tools: disabled (group:runtime denied)",
  ];

  return {
    files,
    agentOverrides: {
      sandbox: {
        mode: params.draft.controls.sandboxMode,
        workspaceAccess: params.draft.controls.workspaceAccess,
      },
      tools: {
        profile: params.draft.controls.toolsProfile,
        alsoAllow: normalizedAlsoAllow,
        deny: normalizedDeny,
      },
    },
    execApprovals: params.draft.controls.allowExec
      ? {
          security: params.draft.controls.approvalSecurity,
          ask: params.draft.controls.approvalAsk,
          allowlist: approvalAllowlist,
        }
      : null,
    validation: {
      errors,
      warnings,
    },
    summary,
  };
};
