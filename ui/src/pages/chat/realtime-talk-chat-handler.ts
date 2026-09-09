import type { GatewayEventFrame } from "../../api/gateway.ts";
import type { RealtimeTalkEventInput, ChatPayload } from "./realtime-talk-shared.js";

/** Result of processing a chat event — either settled or needs further action. */
export type ChatEventDisposition =
  | { type: "terminal"; text?: string }
  | { type: "empty_final_fallback" }
  | { type: "aborted"; errorMessage?: string }
  | { type: "errored"; errorMessage?: string }
  | { type: "progress" }
  | { type: "buffer" }
  | { type: "ignore" };

export interface ChatHandlerDeps {
  runId: string;
  emitTalkEvent: ((input: RealtimeTalkEventInput) => void) | undefined;
  extractTextFromMessage: (message: unknown) => string;
}

/**
 * Encapsulates chat event processing for a realtime talk consult, including
 * buffering of events that may belong to a not-yet-discovered follow-up run.
 *
 * When a turn is queued (pending), the follow-up runId is allocated
 * asynchronously after `admitFollowupTurn` runs. Chat events for the
 * follow-up may arrive before the runId is discovered. This handler buffers
 * such events and replays them once `acceptedFollowupRunId` is set, recovering
 * any terminal result (final, aborted, error) that would otherwise be lost.
 *
 * Callers receive `ChatEventDisposition` results and own the settlement
 * lifecycle (resolve/reject/cleanup) — the handler owns only the runId
 * correlation, buffering, and replay logic.
 */
export function createChatHandler(deps: ChatHandlerDeps) {
  const bufferedFollowupEvents: ChatPayload[] = [];
  let acceptedFollowupRunId: string | undefined;

  const matchesActiveRun = (payloadRunId: string): boolean => {
    if (payloadRunId === deps.runId) {
      return true;
    }
    // After a pending queued turn, the follow-up run gets a new random runId
    // that the gateway communicates via followupRunId in the wait response.
    // Only accept events carrying that exact follow-up runId.
    if (acceptedFollowupRunId && payloadRunId === acceptedFollowupRunId) {
      return true;
    }
    return false;
  };

  const processChatEvent = (payload: ChatPayload): ChatEventDisposition => {
    if (!matchesActiveRun(payload.runId ?? "")) {
      // A chat event arrived for a run we don't recognize. If we haven't
      // discovered the follow-up runId yet, buffer it so it can be recovered
      // when we do. Once the follow-up runId is known, unmatched events are
      // genuinely unrelated and can be safely dropped.
      if (!acceptedFollowupRunId) {
        bufferedFollowupEvents.push(payload);
      }
      return { type: "buffer" };
    }
    // This event belongs to a known active run. Clear the buffer since we
    // no longer need to check future events against the undiscovered runId.
    bufferedFollowupEvents.length = 0;

    if (payload.stream === "tool") {
      emitRealtimeTalkAgentProgress(deps.emitTalkEvent, payload);
    }

    if (payload.state === "final") {
      const finalText = deps.extractTextFromMessage(payload.message);
      if (finalText) {
        return { type: "terminal", text: finalText };
      }
      return { type: "empty_final_fallback" };
    }
    if (payload.state === "aborted") {
      return { type: "aborted", errorMessage: payload.errorMessage };
    }
    if (payload.state === "error") {
      return { type: "errored", errorMessage: payload.errorMessage };
    }
    return { type: "progress" };
  };

  /** Replay buffered events after the follow-up runId has been discovered.
   * This recovers terminal results (final, aborted, error) that arrived
   * before we knew the follow-up runId, so they were previously discarded.
   * Returns dispositions for the caller to act on. */
  const replayBufferedFollowupEvents = (): ChatEventDisposition[] => {
    if (bufferedFollowupEvents.length === 0) {
      return [];
    }
    // Take a snapshot and clear the buffer; processChatEvent will re-buffer
    // any that still don't match.
    const snapshot = bufferedFollowupEvents.splice(0);
    return snapshot.map((payload) => processChatEvent(payload));
  };

  const handleEvent = (evt: GatewayEventFrame): ChatEventDisposition | undefined => {
    if (evt.event !== "chat") {
      return undefined;
    }
    const payload = evt.payload as ChatPayload | undefined;
    if (!payload) {
      return undefined;
    }
    return processChatEvent(payload);
  };

  const cleanup = () => {
    bufferedFollowupEvents.length = 0;
  };

  return {
    handleEvent,
    cleanup,
    setAcceptedFollowupRunId: (followupRunId: string) => {
      acceptedFollowupRunId = followupRunId;
    },
    getAcceptedFollowupRunId: () => acceptedFollowupRunId,
    replayBufferedFollowupEvents,
  };
}

/** Emit a tool.progress talk event from a chat payload. */
function emitRealtimeTalkAgentProgress(
  emitTalkEvent: ((input: RealtimeTalkEventInput) => void) | undefined,
  payload: ChatPayload,
): void {
  if (!emitTalkEvent || payload.stream !== "tool") {
    return;
  }
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const record = data as Record<string, unknown>;
  const phase = typeof record.phase === "string" ? record.phase : undefined;
  const name = typeof record.name === "string" ? record.name : undefined;
  const toolCallId = typeof record.toolCallId === "string" ? record.toolCallId : undefined;
  emitTalkEvent({
    type: "tool.progress",
    callId: toolCallId,
    payload: {
      runId: payload.runId,
      ...(name ? { name } : {}),
      ...(phase ? { phase } : {}),
    },
  });
}
