import type { AgentWaitResult } from "./realtime-talk-shared.ts";

const FOLLOWUP_POLL_MAX_RETRIES = 10;
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
    request: (method: string, input: unknown) => Promise<AgentWaitResult>;
  };
  runId: string;
  timeoutMs: number;
  isSettled: () => boolean;
  isFollowupObserved: () => boolean;
  onFollowupObserved: (followupRunId: string) => void;
  onError: (error: Error) => void;
}): () => void {
  let retry = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const poll = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (params.isSettled() || params.isFollowupObserved()) {
      return;
    }
    if (retry >= FOLLOWUP_POLL_MAX_RETRIES) {
      return;
    }
    retry += 1;
    void params.client
      .request("agent.wait", {
        runId: params.runId,
        timeoutMs: FOLLOWUP_POLL_INTERVAL_MS,
      })
      .then((result) => {
        if (params.isSettled() || params.isFollowupObserved()) {
          return;
        }
        const status = result?.status;
        // A terminal state here is unexpected during follow-up observation;
        // surface it rather than silently dropping the turn.
        if (status === "error" && result && typeof result === "object" && "error" in result) {
          return;
        }
        if (status === "pending" && result?.followupRunId) {
          params.onFollowupObserved(result.followupRunId);
          return;
        }
        if (status === "pending") {
          timeoutId = setTimeout(poll, FOLLOWUP_POLL_INTERVAL_MS);
          return;
        }
        // Any other status means the wait resolved differently than expected;
        // poll again to re-check rather than abandoning the follow-up.
        timeoutId = setTimeout(poll, FOLLOWUP_POLL_INTERVAL_MS);
      })
      .catch(() => {
        if (params.isFollowupObserved()) {
          return;
        }
        timeoutId = setTimeout(poll, FOLLOWUP_POLL_INTERVAL_MS);
      });
  };

  // Delay the first poll so a same-frame follow-upRunId in the pending
  // response is captured synchronously before polling begins.
  timeoutId = setTimeout(poll, FOLLOWUP_POLL_INTERVAL_MS);
  return () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  };
}

export { FOLLOWUP_POLL_MAX_RETRIES, FOLLOWUP_POLL_INTERVAL_MS };
