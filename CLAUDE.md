# Claude Code instructions for OpenClaw

@AGENTS.md

@.agents/skills/openclaw-pr-maintainer/SKILL.md

## Repository guidance and precedence

- Treat the imported `AGENTS.md` and PR-maintainer skill as canonical policy. Do not create competing policy or silently weaken their safety, review, authorization, or validation gates.
- Read the nearest scoped `AGENTS.md` before changing files in that area. Follow references in those files when relevant.
- Before opening or materially updating a PR, read `CONTRIBUTING.md` and `.github/pull_request_template.md`. After Barnacle, ClawSweeper, or human review, follow `docs/reference/pull-request-review-flow.md`. For tests, follow `docs/help/testing/writing-tests.md` and the `.agents/skills/openclaw-testing/SKILL.md` failure policy.
- Keep the change within the user's authorized scope. A request to investigate or fix does not automatically authorize publishing, merging, broad cleanup, security-sensitive changes, dependency changes, or other gated actions.

## Behavior, evidence, and regression tests

- Verify the current branch head, relevant source, callers, tests, history, and live CI evidence before making claims. Treat PR descriptions and code comments as intent, not proof.
- Reproduce the failure through the real entry point when feasible. Fix the owner of the violated invariant and test the observable contract, not just an internal helper or log message. State exactly which boundary the evidence proves; mocks do not prove behavior hidden behind the mocked boundary.
- For asynchronous lifecycle/restart regressions, synchronize on the intended run and on the observation being admitted before triggering interruption. A normal message followed immediately by a restart is not proof that a live run was interrupted. Use a deterministic hold/checkpoint and supported lifecycle path, and assert the actual wire result and user-visible side effect. Do not claim the underlying run was preserved or cancelled unless the test observes that distinction.
- Keep tests for independent contracts even when they share fixtures. Consolidate duplicated setup, not distinct behavioral guarantees. A test that passes both before and after the fix, checks only a log substring, or can race past the intended state is not sufficient regression proof.
- When adding or moving a test, verify every applicable canonical test-selection/planner list, ownership inventory, serial/prebuilt classification, and TypeScript boundary. Run the relevant inventory/registration tests.
- For CI failures, inspect the exact failed job and diagnostic, reproduce when possible, and compare the same check on the base commit before calling it pre-existing or flaky. Separate product failures, test/inventory mistakes, environment failures, and known base-branch failures. Never hide failures, weaken guards to get green, or claim unrun checks passed.
- Keep the PR description current with the concrete problem, user impact, concise explanation, measured validation, CI evidence, and meaningful gaps. Redact secrets and unrelated user data from logs and artifacts. Ask for re-review only after the requested branch, evidence, and description updates are actually present.

## Scope and completion

- Prefer the smallest coherent repair that satisfies the owning contract and review feedback. Do not rebuild unrelated code, expand a focused fix into refactoring, delete valuable coverage just to reduce test count, or fix unrelated pre-existing failures in the same PR without a clear need.
- Before adding a new test lane, worker pin, polling loop, delay, broad import, helper, or extra validation step, explain which concrete risk or required contract it covers and check the repository's existing alternatives.
- Report what changed, the exact checks run and their results, and what remains unverified. Do not equate a green subset with a fully green CI run or describe a queued review as completed.
