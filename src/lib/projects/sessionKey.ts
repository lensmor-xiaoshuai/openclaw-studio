export const buildSessionKey = (agentId: string) => `agent:${agentId}:main`;

export const parseAgentIdFromSessionKey = (
  sessionKey: string,
  fallback: string = "main"
): string => {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match ? match[1] : fallback;
};
