import { describe, expect, it } from "vitest";

import { buildSessionKey, parseAgentIdFromSessionKey } from "@/lib/projects/sessionKey";

describe("sessionKey helpers", () => {
  it("buildSessionKey formats agent session key", () => {
    expect(buildSessionKey("agent-1")).toBe("agent:agent-1:main");
  });

  it("parseAgentIdFromSessionKey extracts agent id", () => {
    expect(parseAgentIdFromSessionKey("agent:agent-1:main")).toBe("agent-1");
  });

  it("parseAgentIdFromSessionKey falls back when missing", () => {
    expect(parseAgentIdFromSessionKey("")).toBe("main");
    expect(parseAgentIdFromSessionKey("", "fallback")).toBe("fallback");
  });
});
