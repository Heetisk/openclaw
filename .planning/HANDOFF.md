# PR #142173 Handoff Context — fix/talk-queued-consult-empty-completion-142080

## Goal
Fix browser Talk consultations that get **queued** (deferred execution) losing their answers. The PR must be clean, minimal, and ready for maintainer review.

---

## What Has Been Done

### To-do #1 (COMPLETE): Fix 3 failing tests
- **Root cause:** `src/gateway/server-startup-post-attach.ts` had already been reverted to HEAD (its `getCron` falls back to `params.deps.cron`), but `src/gateway/server-startup-post-attach.test.ts` still contained uncommitted cron-adapter tests exercising the reverted feature (`createPluginCronHost`, `getGatewayCronService`, scheduler-generation fencing, adapter revocation).
- **Fix:** Restored test file to HEAD with `git checkout HEAD -- src/gateway/server-startup-post-attach.test.ts`.
- **Result:** 113 tests pass.

### To-do #2 (COMPLETE): Verify compilation
- `pnpm tsgo:core` — **passed** (exit 0).
- `pnpm tsgo:ui` — **passed** (exit 0).
- `pnpm vitest run --config test/vitest/vitest.gateway.config.ts src/gateway/server-close.test.ts` — **76 passed, 2 skipped**.

### To-do #3 (COMPLETE): Review the Talk defect fix
- Ran the full consult test suite: `realtime-talk-consult.test.ts` (35 tests) + `realtime-talk-chat-handler.test.ts` (8 tests) — **all 43 passed**.
- Verified `followupRunId` plumbing end-to-end:
  - `run-wait.ts:96` — `followupRunId` normalized from raw Gateway response.
  - `realtime-talk-followup-observation.ts` — polls `agent.wait` every 2s to capture the follow-up runId; consumes it from terminal and timeout responses too, not only pending ones.
  - `realtime-talk-shared.ts` — empty-final 500ms fallback timer only scheduled AFTER followup runId is accepted (or after terminal ok with no followupRunId). The `pending` path no longer races the fallback.
  - `realtime-talk-chat-handler.ts` — buffers terminal events for unrecognized runs; replays after `setAcceptedFollowupRunId`.
- Key test coverage confirmed:
  - "captures queued follow-up final reply with a different runId"
  - "falls back to no-text when adopted run delivers empty final"
  - "does not resolve empty-final fallback when agent.wait returns pending"
  - "retries a pending follow-up recovery until the terminal snapshot arrives"
  - "recovers a discarded terminal reply from the discovered follow-up run"

### Additional verification: Baseline fixes
- `config/assertion-safety-baseline.txt` was stale (32 entries for deleted/renamed files). Pruned with `pnpm tsgo:check:assertion-safety --prune` and verified ratchet passes: **3893 files, 11508 grandfathered assertions**.

---

## Current Branch State

### Branch topology
```
fix/talk-queued-consult-empty-completion-142080 (HEAD, local)
  ├── 1e8a44bb152 fix(talk): preserve queued consult follow-up identity and recover terminal replies (COMMITTED, NOT YET PUSHED)
  ├── ae6d6c75e3c wip: landing-remediation paused at 2/2
  ├── 7084b88d317 wip: Talk follow-up remediation paused at 1/2
  └── 05091fa58ca Merge upstream/main into fix/talk-queued-consult-empty-completion-142080

origin/fix/talk-queued-consult-empty-completion-142080 (remote)
  └── d0defce45a6 ci: refresh PR synchronization
      └── ce495a5b42a fix(talk): recover queued follow-up terminal replies
          └── 0f24ea48257 fix(talk): preserve queued consult follow-up identity
```

### Key insight about the 3 remote commits
The 3 commits on `origin/fix/talk-queued-consult-empty-completion-142080` that are NOT in local HEAD are the **canonical fix**:
- `0f24ea48257` — "fix(talk): preserve queued consult follow-up identity" (14 files, 1056 insertions)
- `ce495a5b42a` — "fix(talk): recover queued follow-up terminal replies" (3 files, 159 insertions)
- `d0defce45a6` — "ci: refresh PR synchronization" (CI refresh)

My local commit `1e8a44bb152` is a **duplicate** of these same fixes plus WIP extras.

---

## To-do #4 (BLOCKED): Resolve branch divergence

**Problem:** The branch has diverged from `origin/main` (274 ahead, 3 behind). Pushing is rejected as non-fast-forward.

**Attempted fix:** `git rebase origin/fix/talk-queued-consult-empty-completion-142080` produced 4 conflicts:
1. `src/gateway/server-lifecycle.ts` — My WIP refactor duplicates upstream commit `05a2844d39c` ("refactor: keep plugin work and cleanup owned during retirement"). **Incoming (upstream) version is better.**
2. `extensions/openai/realtime-quicksilver.ts` — Upstream `isSupportedOpenAIGptLiveModel` uses cleaner composition. **Incoming version is better.**
3. `ui/src/pages/chat/realtime-talk-shared.ts` — My WIP incorrectly changed `waitForEmptyFinalFallback` to use `followupRunId` instead of `params.runId`. **This was a regression in my code.**
4. `ui/src/pages/chat/__tests__/realtime-talk-consult.helpers.ts` / `realtime-talk-consult.test.ts` — My WIP test additions duplicate upstream.

**Rebase was ABORTED** cleanly. Local state is preserved at `1e8a44bb152`.

### Recommended path forward
**Drop my duplicate commit `1e8a44bb152` and sync to the remote branch directly.** The 3 remote commits already contain the complete fix. My commit adds nothing of value that upstream doesn't already have — and in `realtime-talk-shared.ts`, my version was actually worse.

Steps:
1. `git reset --soft ae6d6c75e3c` (move my changes to working tree)
2. Review the diff; only cherry-pick any genuine improvements
3. `git rebase origin/fix/talk-queued-consult-empty-completion-142080`
4. `git push origin fix/talk-queued-consult-empty-completion-142080`

---

## To-do #5 (BLOCKED on #4): Push and watch
- Push cannot proceed until the rebase/merge conflict is resolved.
- After push: monitor ClawSweeper re-review via `gh pr checks 142173`.
- ClawSweeper comments are at https://github.com/Heetisk/openclaw/pull/142173

---

## PR Status Summary
- **PR #142173:** Open, head at `d0defce45a6`
- **CI gate:** FAILING — Security Review job fails because CI gate hasn't passed (self-blocking check)
- **Labels:** `P2`, `size: XL`, `status: 📣 needs proof`, `merge-risk: 🚨 compatibility`, `rating: 🦪 silver shellfish`
- **No human reviewer comments** — only ClawSweeper re-review requests
- **ClawSweeper re-reviews:** 3 re-review requests submitted (2026-09-08), all completed with "durable review result and route handoff completed"

---

## Files Modified in This Work
- `src/agents/run-wait.test.ts` — 14 lines added (followupRunId tests)
- `src/agents/run-wait.ts` — 2 lines added (followupRunId normalization)
- `src/agents/run-wait.types.ts` — 1 line added (followupRunId type)
- `src/gateway/server-close.test.ts` — 4 lines changed (plugin registry close tests)
- `src/gateway/server-close.ts` — 1 line changed (retiredFollowupRunIds cleared on close)
- `src/gateway/server-lifecycle.ts` — 3 lines changed (deps.cron plumbing)
- `ui/src/pages/chat/__tests__/realtime-talk-consult.helpers.ts` — 12 lines added
- `ui/src/pages/chat/realtime-talk-consult.test.ts` — 682 lines added
- `ui/src/pages/chat/realtime-talk-followup-observation.ts` — 150 lines changed
- `ui/src/pages/chat/realtime-talk-shared.ts` — 110 lines changed
- `config/assertion-safety-baseline.txt` — 49 lines changed (baseline prune + merge)

---

## Next Actions
1. **Resolve rebase conflict** — drop my duplicate commit, sync to remote
2. **Push** to trigger CI
3. **Wait for CI gate** to pass
4. **Monitor ClawSweeper re-review** — it auto-triggers after CI passes
5. **Address review findings** if any
6. **Update PR label** from `status: 📣 needs proof` to `status: ready for maintainer look` when CI + review pass
