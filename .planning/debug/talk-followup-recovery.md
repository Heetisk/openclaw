---
name: talk-followup-recovery
description: Diagnose recovery of a discarded Talk follow-up terminal answer after followupRunId discovery.
metadata:
  type: project
---

# Talk Follow-up Recovery

Status: investigating
Trigger: Talk treats queued consult as empty completion and loses adopted-run reply
Created: 2026-09-12
Updated: 2026-09-12

## Symptoms

- A queued Talk consultation can receive its follow-up terminal chat event before the browser discovers the Gateway-allocated followupRunId.
- The browser buffers unknown-run terminal events, but oversized events are rejected and aggregate byte pressure can evict older events.
- Once followupRunId is discovered, the current callback sets the accepted ID and replays the buffer. If the terminal event was discarded, it then calls observePendingFollowupRunId, but that observer exits because isFollowupObserved() is already true.
- Gateway agent.wait can return a terminal status with followupRunId, but the browser recovery path does not reliably retrieve the terminal answer from the original run.

## Current Focus

hypothesis: The recovery callback conflates identity discovery with answer recovery; after accepting followupRunId, it invokes an observer whose guard prevents a recovery request.
next_action: Verify the Gateway agent.wait terminalReply contract and implement a bounded recovery wait that is independent of the identity-observer guard, with regression coverage for discarded buffered answers.
reasoning_checkpoint: Terminal agent.wait results include terminalReply in src/agents/run-wait.types.ts and are returned by agent-turn-service.ts; the browser helper currently models only followupRunId and status.

## Evidence

- ui/src/pages/chat/realtime-talk-shared.ts:313-335 contains the ineffective callback.
- ui/src/pages/chat/realtime-talk-followup-observation.ts:51-53 exits when isFollowupObserved() is true.
- src/gateway/agent-turn/agent-turn-service.ts:687-703 returns terminalReply and followupRunId from terminal snapshots.
- src/agents/run-wait.types.ts:5-20 defines terminalReply in AgentWaitResult.
- ui/src/pages/chat/realtime-talk-chat-handler.ts:92-117 rejects oversized events and evicts under byte pressure.

## Eliminated

- The original pending-only followupRunId consumption is not sufficient for fast completion.
- Replaying the browser buffer cannot recover an event that was never retained.

## Resolution

root_cause:
fix:
verification:
files_changed:
