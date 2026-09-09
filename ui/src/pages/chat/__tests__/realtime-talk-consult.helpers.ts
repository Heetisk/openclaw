import { vi } from "vitest";
import { createDeferred } from "../../../../../test/helpers/promise.js";

export type ChatListener = (event: { event: string; payload?: unknown }) => void;

export interface MockGatewayRequestOptions {
  /** The runId to return for talk.client.toolCall (default: "run-1") */
  runId?: string;
  /** The agentId to return (default: "main") */
  agentId?: string;
  /** The session key to return (default: "agent:main:main") */
  sessionKey?: string;
  /** Override agent.wait response with a custom value */
  waitResult?: unknown;
  /** Whether agent.wait should return a never-resolving promise (for timeout tests) */
  waitNeverResolves?: boolean;
  /** Whether agent.wait should return a deferred that can be resolved later */
  waitDeferred?: ReturnType<typeof createDeferred>;
}

/** Create a mock Gateway request function for consult tests. */
export function createMockGatewayRequest({
  runId = "run-1",
  agentId = "main",
  sessionKey = "agent:main:main",
  waitResult,
  waitNeverResolves = false,
  waitDeferred,
}: MockGatewayRequestOptions = {}) {
  return vi.fn(async (method: string) => {
    if (method === "talk.client.toolCall") {
      return {
        runId,
        idempotencyKey: runId,
        agentId,
        agentSessionKey: sessionKey,
      };
    }
    if (method === "agent.wait") {
      if (waitNeverResolves) {
        return new Promise(() => {});
      }
      if (waitDeferred) {
        return await waitDeferred.promise;
      }
      return waitResult ?? { runId, status: "ok" };
    }
    throw new Error(`unexpected request: ${method}`);
  });
}

/**
 * Install a mock addEventListener that captures the chat event listener.
 * Returns the listener setter so tests can emit events.
 */
export function createMockAddEventListener() {
  let listener: ChatListener | undefined;
  const addEventListener = vi.fn((callback: ChatListener) => {
    listener = callback;
    return () => {
      listener = undefined;
    };
  });
  return {
    addEventListener,
    emitChat: (payload: unknown) => listener?.({ event: "chat", payload }),
    listener: () => listener,
  };
}

/** Common context passed to submitRealtimeTalkConsult in tests. */
export interface TestConsultOptions {
  request: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  emitTalkEvent?: ReturnType<typeof vi.fn>;
  speakControlResult?: ReturnType<typeof vi.fn>;
  suppressSpeechForModes?: string[];
  sessionKey?: string;
  callId?: string;
  signal?: AbortSignal;
  args?: { question?: string };
}

/** Build a minimal context object for submitRealtimeTalkConsult. */
export function buildTestCtx(opts: TestConsultOptions) {
  return {
    client: {
      request: opts.request,
      addEventListener: opts.addEventListener,
    },
    sessionKey: opts.sessionKey ?? "agent:main:main",
    callbacks: {},
  } as never;
}

/** Default empty-final fallback message. */
export const EMPTY_FINAL_FALLBACK = "OpenClaw finished with no text.";

/**
 * Create a pending agent.wait response that includes a follow-up runId.
 * This matches the production shape after the security fix.
 */
export function pendingWithFollowup(runId: string, followupRunId: string) {
  return { runId, status: "pending" as const, followupRunId };
}

/**
 * Create a pending agent.wait response without a follow-up runId.
 * Used to test the delayed-allocation observation path.
 */
export function pendingWithoutFollowup(runId: string) {
  return { runId, status: "pending" as const };
}

/**
 * Create a terminal agent.wait response (ok).
 */
export function terminalOk(runId: string) {
  return { runId, status: "ok" as const };
}

/**
 * Create an empty-final chat event payload for the given runId.
 */
export function emptyFinalPayload(runId: string) {
  return { runId, state: "final", message: { text: "" } };
}

/**
 * Create a text-bearing chat event payload for the given runId.
 */
export function textFinalPayload(runId: string, text: string) {
  return {
    runId,
    state: "final",
    message: {
      role: "assistant" as const,
      provider: "openclaw" as const,
      model: "delivery-mirror" as const,
      text,
    },
  };
}
