import type { GatewayProtocolRequestOptions } from "@openclaw/gateway-client/browser";
import type { AgentWaitResult as GatewayAgentWaitResult } from "../../../../src/agents/run-wait.types.js";

/** Result of an `agent.wait` Gateway request. */
export type AgentWaitResult = GatewayAgentWaitResult;

const FOLLOWUP_POLL_INTERVAL_MS = 2000;

/**
 * When `agent.wait` returns `pending` without a `followupRunId`, the gateway
 * has not yet admitted the follow-up run. The follow-up runId is allocated
 * after `admitFollowupTurn` runs, which happens asynchronously once the queue
 * drain reaches the group. This observer polls `agent.wait` on a bounded
 * retry loop to capture the follow-up runId when admission completes, so the
 * client can switch from accepting any runId to matching the exact follow-up
 * runId for secure result correlation.
 */
export function observePendingFollowupRunId(params: {
  client: {
    request: (
      method: string,
      input: unknown,
      options?: GatewayProtocolRequestOptions,
    ) => Promise<AgentWaitResult>;
  };
  runId: string;
  timeoutMs: number;
  startedAt: number;
  signal?: AbortSignal;
  isSettled: () => boolean;
  isFollowupObserved: () => boolean;
  onFollowupObserved: (followupRunId: string) => void;
  onError: (error: Error) => void;
}): () => void {
  let stopped = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const getRemainingTimeoutMs = () => {
    return params.timeoutMs - (Date.now() - params.startedAt);
  };
  const isDeadlineReached = () => getRemainingTimeoutMs() <= 0;
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    params.signal?.removeEventListener("abort", onAbort);
  };
  const onAbort = () => stop();
  if (params.signal?.aborted) {
    stop();
  } else {
    params.signal?.addEventListener("abort", onAbort, { once: true });
  }

  const poll = () => {
    if (stopped) {
      return;
    }
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (
      params.signal?.aborted ||
      params.isSettled() ||
      params.isFollowupObserved() ||
      isDeadlineReached()
    ) {
      stop();
      return;
    }

    const remainingTimeoutMs = getRemainingTimeoutMs();
    void params.client
      .request(
        "agent.wait",
        { runId: params.runId },
        {
          timeoutMs: remainingTimeoutMs,
          signal: params.signal,
        },
      )
      .then((result) => {
        if (
          stopped ||
          params.signal?.aborted ||
          params.isSettled() ||
          params.isFollowupObserved()
        ) {
          return;
        }
        if (isDeadlineReached()) {
          stop();
          return;
        }
        const status = result?.status;
        // A follow-up can finish between identity polls: the Gateway returns
        // its retired identifier with a terminal status. Consume the
        // followupRunId from terminal and timeout responses too, not only
        // from pending ones, so the buffered answer is never lost.
        if (result?.followupRunId) {
          params.onFollowupObserved(result.followupRunId);
          stop();
          return;
        }
        // A terminal error here is unexpected during follow-up observation.
        // Surface it to the caller so the turn is rejected rather than
        // silently dropped; stop polling once the error is reported.
        if (status === "error") {
          const errorMessage =
            typeof result?.error === "string"
              ? result.error
              : "OpenClaw follow-up observation failed";
          params.onError(new Error(errorMessage));
          stop();
          return;
        }
        // A terminal timeout without a followupRunId: surface the failure
        // instead of scheduling another poll.
        if (status === "timeout" || result?.endedAt !== undefined) {
          params.onError(
            new Error(
              status === "timeout"
                ? "OpenClaw follow-up observation timed out"
                : "OpenClaw follow-up observation failed",
            ),
          );
          stop();
          return;
        }
        const nextRemainingTimeoutMs = getRemainingTimeoutMs();
        if (nextRemainingTimeoutMs <= 0) {
          stop();
          return;
        }
        timeoutId = setTimeout(poll, Math.min(FOLLOWUP_POLL_INTERVAL_MS, nextRemainingTimeoutMs));
      })
      .catch(() => {
        if (
          stopped ||
          params.signal?.aborted ||
          params.isSettled() ||
          params.isFollowupObserved()
        ) {
          return;
        }
        if (isDeadlineReached()) {
          stop();
          return;
        }
        const nextRemainingTimeoutMs = getRemainingTimeoutMs();
        if (nextRemainingTimeoutMs <= 0) {
          stop();
          return;
        }
        timeoutId = setTimeout(poll, Math.min(FOLLOWUP_POLL_INTERVAL_MS, nextRemainingTimeoutMs));
      });
  };

  // Delay the first poll so a same-frame followupRunId in the pending
  // response is captured synchronously before polling begins.
  const initialRemainingTimeoutMs = getRemainingTimeoutMs();
  if (params.signal?.aborted || initialRemainingTimeoutMs <= 0) {
    stop();
  } else {
    timeoutId = setTimeout(poll, Math.min(FOLLOWUP_POLL_INTERVAL_MS, initialRemainingTimeoutMs));
  }
  return stop;
}
