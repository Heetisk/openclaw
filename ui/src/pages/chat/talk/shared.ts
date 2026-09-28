import { REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME } from "../../../../../src/realtime-voice/agent-consult-tool.js";
import type { RealtimeVoiceBrowserSession } from "../../../../../src/realtime-voice/provider-types.js";
import {
  buildRealtimeVoiceAgentCancelProviderResult,
  buildRealtimeVoiceAgentControlSpeechMessage,
  parseRealtimeVoiceAgentControlToolArgs,
  REALTIME_VOICE_AGENT_CONTROL_TOOL_NAME,
  shouldAutoControlRealtimeVoiceAgentText,
} from "../../../../../src/realtime-voice/session-runtime.js";
import type { RealtimeVoiceAgentControlMode } from "../../../../../src/realtime-voice/session-runtime.js";
import type { TalkEvent } from "../../../../../src/talk/talk-events.js";
import type { GatewayBrowserClient, GatewayEventFrame } from "../../../api/gateway.ts";
import { formatUiError } from "../../../lib/format-error.ts";
import type { RealtimeTalkInputController } from "./input.ts";

export type RealtimeTalkStatus = "idle" | "connecting" | "listening" | "thinking" | "error";
export type RealtimeTalkEvent = TalkEvent;

export type RealtimeTalkTranscript = {
  role: "user" | "assistant";
  text: string;
  final: boolean;
  /** Literal fragments append; complete snapshots replace without inferred turn boundaries. */
  textMode?: "verbatim" | "snapshot";
  itemId?: string;
  order?: number;
};

export type RealtimeTalkTranscriptItem =
  | {
      type: "created";
      itemId: string;
      previousItemId?: string | null;
      role: "user" | "assistant" | null;
    }
  | { type: "settled"; itemId: string };

export type RealtimeTalkCallbacks = {
  onStatus?: (status: RealtimeTalkStatus, detail?: string) => void;
  onVideoCapability?: (capable: boolean) => void;
  onInputLevel?: (level: number) => void;
  onTranscript?: (entry: RealtimeTalkTranscript) => void;
  onTranscriptOrder?: (items: ReadonlyArray<{ itemId: string; order: number }>) => void;
  onTranscriptItem?: (item: RealtimeTalkTranscriptItem) => void;
  onTalkEvent?: (event: RealtimeTalkEvent) => void;
  onVideoStream?: (stream: MediaStream | null) => void;
  onVideoError?: (error: unknown) => void;
};

export type RealtimeTalkEventInput<TPayload = unknown> = {
  type: RealtimeTalkEvent["type"];
  payload?: TPayload;
  turnId?: string;
  captureId?: string;
  final?: boolean;
  callId?: string;
  itemId?: string;
  parentId?: string;
};

export type RealtimeTalkSessionResult = RealtimeVoiceBrowserSession & {
  voiceSessionId?: string;
  consultThinkingLevel?: string;
  consultFastMode?: boolean;
};

export type RealtimeTalkWebRtcSdpSessionResult = Extract<
  RealtimeTalkSessionResult,
  { transport: "webrtc" }
>;

export type RealtimeTalkJsonPcmWebSocketSessionResult = Extract<
  RealtimeTalkSessionResult,
  { transport: "provider-websocket" }
>;

export type RealtimeTalkGatewayRelaySessionResult = Extract<
  RealtimeTalkSessionResult,
  { transport: "gateway-relay" }
>;

export type RealtimeTalkTransportStartResult = "ready" | "cancelled";

export type RealtimeTalkTransport = {
  start(): Promise<RealtimeTalkTransportStartResult>;
  activate?: () => void;
  stop(options?: { emitClosed?: boolean }): void | Promise<void>;
  setVideoEnabled?: (enabled: boolean) => Promise<void>;
  switchCamera?: (videoDeviceId: string | undefined) => Promise<void>;
};

export type RealtimeTalkTransportContext = {
  client: GatewayBrowserClient;
  sessionKey: string;
  voiceSessionId?: string;
  flushTranscriptWrites?: () => Promise<void>;
  callbacks: RealtimeTalkCallbacks;
  input: Pick<RealtimeTalkInputController, "stream" | "adopt" | "stop">;
  videoDeviceId?: string;
  consultThinkingLevel?: string;
  consultFastMode?: boolean;
};

export function createRealtimeTalkEventEmitter(
  ctx: RealtimeTalkTransportContext,
  session: RealtimeTalkSessionResult,
): (input: RealtimeTalkEventInput) => void {
  let seq = 0;
  let turnSeq = 0;
  let activeTurnId: string | undefined;
  const sessionId = resolveRealtimeTalkEventSessionId(ctx, session);
  return (input) => {
    if (!ctx.callbacks.onTalkEvent) {
      return;
    }
    const turnId = resolveRealtimeTalkTurnId(input);
    seq += 1;
    ctx.callbacks.onTalkEvent({
      id: `${sessionId}:${seq}`,
      type: input.type,
      sessionId,
      turnId,
      captureId: input.captureId,
      seq,
      timestamp: new Date().toISOString(),
      mode: "realtime",
      transport: session.transport,
      brain: "agent-consult",
      provider: session.provider,
      final: input.final,
      callId: input.callId,
      itemId: input.itemId,
      parentId: input.parentId,
      payload: input.payload ?? null,
    });
    if (
      input.type === "turn.ended" ||
      input.type === "turn.cancelled" ||
      input.type === "session.replaced" ||
      input.type === "session.closed"
    ) {
      activeTurnId = undefined;
    }
  };

  function resolveRealtimeTalkTurnId(input: RealtimeTalkEventInput): string | undefined {
    if (input.type === "turn.started") {
      activeTurnId = input.turnId ?? activeTurnId ?? `turn-${++turnSeq}`;
      return activeTurnId;
    }
    if (!isTurnScopedTalkEvent(input.type)) {
      return input.turnId;
    }
    activeTurnId = input.turnId ?? activeTurnId ?? `turn-${++turnSeq}`;
    return activeTurnId;
  }
}

function isTurnScopedTalkEvent(type: RealtimeTalkEvent["type"]): boolean {
  return (
    type === "turn.ended" ||
    type === "turn.cancelled" ||
    type.startsWith("input.audio.") ||
    type.startsWith("transcript.") ||
    type.startsWith("output.") ||
    type.startsWith("tool.")
  );
}

function resolveRealtimeTalkEventSessionId(
  ctx: RealtimeTalkTransportContext,
  session: RealtimeTalkSessionResult,
): string {
  const explicitSessionId = (session as { sessionId?: unknown }).sessionId;
  if (typeof explicitSessionId === "string" && explicitSessionId.trim()) {
    return explicitSessionId.trim();
  }
  if ("relaySessionId" in session && session.relaySessionId.trim()) {
    return session.relaySessionId;
  }
  return `${ctx.sessionKey}:${session.provider}:${session.transport}`;
}

/** Result of an `agent.wait` Gateway request. */
export type AgentWaitResult = {
  status?: string;
  error?: string;
  stopReason?: string;
  endedAt?: number;
  pendingError?: boolean;
  timeoutPhase?: string;
  providerStarted?: boolean;
  aborted?: boolean;
  livenessState?: string;
  yielded?: boolean;
  terminalReply?: {
    disposition?: string;
    text?: string;
  };
  sourceReplyDelivered?: true;
};

const EMPTY_FINAL_FALLBACK_GRACE_MS = 500;
const EMPTY_FINAL_FALLBACK_TEXT = "OpenClaw finished with no text.";
const FOLLOWUP_RECOVERY_RETRY_INTERVAL_MS = 2000;

function extractTextFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const record = message as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text;
  }
  const content = Array.isArray(record.content) ? record.content : [];
  const parts = content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const entry = block as Record<string, unknown>;
      return entry.type === "text" && typeof entry.text === "string" ? entry.text : "";
    })
    .filter(Boolean);
  return parts.join("\n\n").trim();
}

function getTerminalAgentWaitError(result: AgentWaitResult | undefined): Error | undefined {
  if (!result) {
    return undefined;
  }
  const message = result.error?.trim();
  if (result.status === "error") {
    return new Error(message || "OpenClaw tool call failed");
  }
  // pending means the turn is queued/deferred — not terminal, so keep waiting.
  if (result.status === "pending") {
    return undefined;
  }
  if (result.status !== "timeout" || result.pendingError) {
    return undefined;
  }
  const stopReason = result.stopReason?.trim();
  const timeoutPhase = result.timeoutPhase?.trim();
  const livenessState = result.livenessState?.trim();
  const hasTerminalTimeoutMetadata =
    result.endedAt !== undefined ||
    message !== undefined ||
    (livenessState !== undefined && livenessState.length > 0) ||
    result.yielded === true ||
    (stopReason !== undefined && stopReason.length > 0) ||
    timeoutPhase === "preflight" ||
    timeoutPhase === "provider" ||
    timeoutPhase === "post_turn" ||
    result.providerStarted === true;
  if (hasTerminalTimeoutMetadata) {
    return new Error(message || "OpenClaw tool call timed out");
  }
  return undefined;
}

function waitForChatResult(params: {
  client: GatewayBrowserClient;
  runId: string;
  timeoutMs: number;
  emitTalkEvent?: (input: RealtimeTalkEventInput) => void;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(new DOMException("OpenClaw tool call aborted", "AbortError"));
      return;
    }
    let settled = false;
    let resolvedWithText = false;
    let chatTerminalReceived = false;
    let chatTerminalText: string | undefined;
    let emptyFinalFallbackTimer: number | undefined;
    let retryTimer: number | undefined;
    const waitStartedAt = Date.now();

    const settleResolve = (value: string) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleReject = (error: Error | DOMException) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const requestWait = () => {
      if (settled) {
        return;
      }
      const remainingTimeoutMs = params.timeoutMs - (Date.now() - waitStartedAt);
      if (remainingTimeoutMs <= 0) {
        settleReject(new Error("OpenClaw tool call timed out"));
        return;
      }
      void params.client
        .request<AgentWaitResult>(
          "agent.wait",
          {
            runId: params.runId,
            timeoutMs: remainingTimeoutMs,
          },
          {
            signal: params.signal,
          },
        )
        .then((result) => {
          if (settled) {
            return;
          }
          const waitError = getTerminalAgentWaitError(result);
          if (waitError) {
            settleReject(waitError);
            return;
          }
          if (result?.status === "timeout") {
            settleReject(new Error(result.error?.trim() || "OpenClaw tool call timed out"));
            return;
          }
          if (result?.status === "pending") {
            window.clearTimeout(emptyFinalFallbackTimer);
            emptyFinalFallbackTimer = undefined;
            const retryRemainingTimeoutMs = params.timeoutMs - (Date.now() - waitStartedAt);
            if (retryRemainingTimeoutMs <= 0) {
              settleReject(new Error("OpenClaw tool call timed out"));
              return;
            }
            retryTimer = window.setTimeout(
              () => {
                retryTimer = undefined;
                requestWait();
              },
              Math.min(FOLLOWUP_RECOVERY_RETRY_INTERVAL_MS, retryRemainingTimeoutMs),
            );
            return;
          }
          if (result?.sourceReplyDelivered && !chatTerminalReceived) {
            emptyFinalFallbackTimer = window.setTimeout(() => {
              settleResolve(EMPTY_FINAL_FALLBACK_TEXT);
            }, EMPTY_FINAL_FALLBACK_GRACE_MS);
            return;
          }
          if (result?.terminalReply?.disposition === "visible") {
            settleResolve(result.terminalReply.text ?? EMPTY_FINAL_FALLBACK_TEXT);
            return;
          }
          emptyFinalFallbackTimer = window.setTimeout(() => {
            settleResolve(EMPTY_FINAL_FALLBACK_TEXT);
          }, EMPTY_FINAL_FALLBACK_GRACE_MS);
        })
        .catch((error: unknown) => {
          settleReject(error instanceof Error ? error : new Error(String(error)));
        });
    };

    const onAbort = () => {
      settleReject(new DOMException("OpenClaw tool call aborted", "AbortError"));
    };
    params.signal?.addEventListener("abort", onAbort, { once: true });
    let unsubscribe: () => void = () => {};
    unsubscribe = params.client.addEventListener((evt: GatewayEventFrame) => {
      if (settled || evt.event !== "chat") {
        return;
      }
      // SAFETY: chat event payload is the unstructured chat envelope from the gateway.
      const payload = evt.payload as
        | {
            runId?: string;
            state?: string;
            message?: unknown;
            errorMessage?: string;
            stream?: string;
            data?: unknown;
          }
        | undefined;
      if (!payload || payload.runId !== params.runId) {
        return;
      }
      if (payload.stream === "tool") {
        const data = payload.data && typeof payload.data === "object" ? payload.data : {};
        const record = data as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name : undefined;
        const phase = typeof record.phase === "string" ? record.phase : undefined;
        params.emitTalkEvent?.({
          type: "tool.progress",
          callId: typeof record.toolCallId === "string" ? record.toolCallId : undefined,
          payload: {
            runId: payload.runId,
            ...(name ? { name } : {}),
            ...(phase ? { phase } : {}),
          },
        });
      }
      if (payload.state === "final") {
        chatTerminalReceived = true;
        const text = extractTextFromMessage(payload.message);
        if (text) {
          chatTerminalText = text;
          resolvedWithText = true;
          settleResolve(text);
          return;
        }
        if (resolvedWithText) {
          return;
        }
        emptyFinalFallbackTimer = window.setTimeout(() => {
          settleResolve(EMPTY_FINAL_FALLBACK_TEXT);
        }, EMPTY_FINAL_FALLBACK_GRACE_MS);
        return;
      }
      if (payload.state === "aborted") {
        settleReject(
          new DOMException(payload.errorMessage ?? "OpenClaw tool call aborted", "AbortError"),
        );
        return;
      }
      if (payload.state === "error") {
        settleReject(new Error(payload.errorMessage ?? "OpenClaw tool call failed"));
        return;
      }
    });

    const timer = window.setTimeout(() => {
      settleReject(new Error("OpenClaw tool call timed out"));
    }, params.timeoutMs);

    requestWait();

    function cleanup() {
      window.clearTimeout(timer);
      if (emptyFinalFallbackTimer !== undefined) {
        window.clearTimeout(emptyFinalFallbackTimer);
      }
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      params.signal?.removeEventListener("abort", onAbort);
      unsubscribe();
    }
  });
}

function requestRealtimeTalkSteer(
  ctx: RealtimeTalkTransportContext,
  sessionId: string | undefined,
  text: string,
  mode?: RealtimeVoiceAgentControlMode,
): Promise<unknown> {
  const request = {
    sessionKey: ctx.sessionKey,
    text,
    ...(mode ? { mode } : {}),
  };
  return sessionId && sessionId.trim()
    ? ctx.client.request("talk.session.steer", { sessionId, ...request })
    : ctx.client.request("talk.client.steer", request);
}

export async function steerRealtimeTalkActiveConsult(params: {
  ctx: RealtimeTalkTransportContext;
  text: string;
  mode?: RealtimeVoiceAgentControlMode;
  sessionId?: string;
  emitTalkEvent?: (input: RealtimeTalkEventInput) => void;
  onControlResult?: (result: unknown) => void;
  speakControlResult?: (message: string) => void;
  suppressSpeechForModes?: readonly RealtimeVoiceAgentControlMode[];
}): Promise<void> {
  const text = params.text.trim();
  if (!text) {
    return;
  }
  const request = requestRealtimeTalkSteer(params.ctx, params.sessionId, text, params.mode);
  try {
    const result = await request;
    params.onControlResult?.(result);
    maybeSpeakRealtimeTalkControlResult(
      result,
      params.speakControlResult,
      params.suppressSpeechForModes,
    );
    params.emitTalkEvent?.({
      type: "tool.progress",
      payload: {
        name: "openclaw_agent_control",
        result,
      },
      final:
        result && typeof result === "object" && "mode" in result
          ? result.mode === "status" || result.mode === "cancel"
          : undefined,
    });
  } catch (error) {
    params.emitTalkEvent?.({
      type: "tool.error",
      payload: { message: formatUiError(error) },
      final: true,
    });
  }
}

export async function submitRealtimeTalkAgentControl(params: {
  ctx: RealtimeTalkTransportContext;
  args: unknown;
  submit: (callId: string, result: unknown) => void | Promise<void>;
  callId: string;
  sessionId?: string;
  emitTalkEvent?: (input: RealtimeTalkEventInput) => void;
  signal?: AbortSignal;
}): Promise<void> {
  if (params.signal?.aborted) {
    return;
  }
  let result: unknown;
  let talkEvent: RealtimeTalkEventInput;
  try {
    const parsed = parseRealtimeVoiceAgentControlToolArgs(params.args);
    result = await requestRealtimeTalkSteer(params.ctx, params.sessionId, parsed.text, parsed.mode);
    if (params.signal?.aborted) {
      return;
    }
    talkEvent = {
      type: "tool.progress",
      callId: params.callId,
      payload: {
        name: "openclaw_agent_control",
        result,
      },
      final:
        result && typeof result === "object" && "mode" in result
          ? result.mode === "status" || result.mode === "cancel"
          : undefined,
    };
  } catch (error) {
    const message = formatUiError(error);
    talkEvent = {
      type: "tool.error",
      callId: params.callId,
      payload: { message },
      final: true,
    };
    result = { error: message };
    if (params.signal?.aborted || isAbortError(error)) {
      return;
    }
  }
  await params.submit(params.callId, result);
  if (params.signal?.aborted) {
    return;
  }
  params.emitTalkEvent?.(talkEvent);
}

function maybeSpeakRealtimeTalkControlResult(
  result: unknown,
  speakControlResult: ((message: string) => void) | undefined,
  suppressSpeechForModes: readonly RealtimeVoiceAgentControlMode[] | undefined,
): void {
  if (!speakControlResult || !result || typeof result !== "object") {
    return;
  }
  const record = result as Record<string, unknown>;
  const mode =
    typeof record.mode === "string" ? (record.mode as RealtimeVoiceAgentControlMode) : undefined;
  if (mode && suppressSpeechForModes?.includes(mode)) {
    return;
  }
  const message = typeof record.message === "string" ? record.message.trim() : "";
  const shouldSpeak =
    (record.speak === true && record.suppress !== true) ||
    (record.ok === true && mode === "steer" && record.suppress === true);
  if (shouldSpeak && message) {
    speakControlResult(buildRealtimeVoiceAgentControlSpeechMessage(message));
  }
}

export async function submitRealtimeTalkConsult(params: {
  ctx: RealtimeTalkTransportContext;
  args: unknown;
  submit: (callId: string, result: unknown) => void | Promise<void>;
  callId: string;
  relaySessionId?: string;
  emitTalkEvent?: (input: RealtimeTalkEventInput) => void;
  submitAbortResult?: boolean;
  signal?: AbortSignal;
}): Promise<void> {
  const { ctx, callId, submit } = params;
  ctx.callbacks.onStatus?.("thinking");
  let run: TalkClientToolCallResult | undefined;
  let aborted = false;
  let submitted = false;
  let submissionCompleted = false;
  const submitOnce = async (result: unknown): Promise<void> => {
    if (submitted) {
      return;
    }
    submitted = true;
    await submit(callId, result);
    submissionCompleted = true;
  };
  const submitAbortResult = async (): Promise<void> => {
    if (params.submitAbortResult !== false) {
      await submitOnce(buildRealtimeVoiceAgentCancelProviderResult());
    }
  };
  const abortRun = () => {
    aborted = true;
    if (run) {
      void ctx.client.request("chat.abort", {
        sessionKey: run.agentSessionKey,
        agentId: run.agentId,
        runId: run.runId,
      });
    }
  };
  if (params.signal?.aborted) {
    await submitAbortResult();
    return;
  }
  params.signal?.addEventListener("abort", abortRun, { once: true });
  try {
    const args =
      typeof params.args === "string" ? JSON.parse(params.args || "{}") : (params.args ?? {});
    await ctx.flushTranscriptWrites?.();
    if (params.signal?.aborted) {
      await submitAbortResult();
      return;
    }
    // Cancellation must not hide the acknowledgement that owns the Gateway run.
    // Once the run id arrives, abortRun() can cancel the exact started consult.
    run = await ctx.client.request<TalkClientToolCallResult>("talk.client.toolCall", {
      sessionKey: ctx.sessionKey,
      ...(ctx.voiceSessionId ? { voiceSessionId: ctx.voiceSessionId } : {}),
      callId,
      name: REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME,
      args,
      ...(params.relaySessionId ? { relaySessionId: params.relaySessionId } : {}),
    });
    if (params.signal?.aborted) {
      abortRun();
      await submitAbortResult();
      return;
    }
    const result = await waitForChatResult({
      client: ctx.client,
      runId: run.runId,
      timeoutMs: 120_000,
      emitTalkEvent: params.emitTalkEvent,
      signal: params.signal,
    });
    await submitOnce({ result });
  } catch (error) {
    if (submitted) {
      throw error;
    }
    if (aborted || params.signal?.aborted || isAbortError(error)) {
      await submitAbortResult();
      return;
    }
    await submitOnce({
      error: formatUiError(error),
    });
  } finally {
    params.signal?.removeEventListener("abort", abortRun);
    if (submissionCompleted && !aborted && !params.signal?.aborted) {
      ctx.callbacks.onStatus?.("listening");
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

export {
  REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME,
  REALTIME_VOICE_AGENT_CONTROL_TOOL_NAME,
  shouldAutoControlRealtimeVoiceAgentText,
};
