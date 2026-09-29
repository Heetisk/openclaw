export type RealtimeVoiceAgentControlMode = "steer" | "status" | "cancel";
export const REALTIME_VOICE_AGENT_CONTROL_TOOL_NAME = "openclaw_agent_control";

export function buildRealtimeVoiceAgentCancelProviderResult(
  message = "Cancelled the active OpenClaw run.",
): { status: "cancelled"; message: string } {
  return { status: "cancelled", message };
}

export function buildRealtimeVoiceAgentControlSpeechMessage(
  text: string,
  _mode = "status",
): string {
  return `Status: "${text}"`;
}

export function parseRealtimeVoiceAgentControlToolArgs(args: unknown): {
  text: string;
  mode: string;
} {
  const record = typeof args === "string" ? JSON.parse(args) : (args ?? {});
  const text = typeof record.text === "string" ? record.text : "";
  const mode = typeof record.mode === "string" ? record.mode : "status";
  if (!text) {
    throw new Error("text required");
  }
  return { text, mode };
}

export function shouldAutoControlRealtimeVoiceAgentText(_text: string): boolean {
  return true;
}
