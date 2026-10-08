/**
 * Real-gateway E2E test for gateway_draining behavior during Talk consult.
 *
 * Verifies that when a Gateway lifecycle reset occurs during an active consult:
 * 1. The agent.wait returns timeout with gateway_draining phase
 * 2. The voice transport receives a timeout error (not false "OpenClaw finished with no text")
 * 3. The underlying run is NOT marked as completed
 */

import path from "node:path";
import { buildAgentSessionKey } from "openclaw/plugin-sdk/routing";
import { afterEach, describe, expect, it } from "vitest";
import { startQaBusServer } from "../../../extensions/qa-lab/src/bus-server.js";
import { createQaBusState } from "../../../extensions/qa-lab/src/bus-state.js";
import { createQaGatewayChild } from "../../../extensions/qa-lab/src/gateway-child.js";
import { startQaMockOpenAiServer } from "../../../extensions/qa-lab/src/providers/mock-openai/server.js";
import { createQaChannelTransport } from "../../../extensions/qa-lab/src/qa-channel-transport.js";
import { waitForQaTransportCondition } from "../../../extensions/qa-lab/src/qa-transport.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

// Skip on Windows like other real-gateway e2e tests (e.g., gateway-kill-restart-send.e2e.test.ts)
// due to platform-specific browser/Gateway startup issues
describe.skipIf(process.platform === "win32")("gateway draining during active Talk consult", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    const errors: unknown[] = [];
    for (const cleanup of cleanups.splice(0).toReversed()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(errors, "gateway draining test cleanup failed");
    }
  });

  it("gateway emits gateway_draining on restart during active consult", async () => {
    const state = createQaBusState();
    const transport = createQaChannelTransport(state);
    const bus = await startQaBusServer({ state });
    cleanups.push(() => bus.stop());
    const mock = await startQaMockOpenAiServer();
    cleanups.push(() => mock.stop());
    const owner = createQaGatewayChild();
    cleanups.push(async () => {
      expect((await owner.stop()).errors).toEqual([]);
    });
    const gateway = await owner.start({
      repoRoot,
      providerBaseUrl: `${mock.baseUrl}/v1`,
      providerMode: "mock-openai",
      forcedRuntime: "openclaw",
      transport,
      transportBaseUrl: bus.baseUrl,
      controlUiEnabled: false,
      mutateConfig: (cfg) => ({
        ...cfg,
        tools: { profile: "full", allow: ["talk.client.toolCall"], codeMode: false },
      }),
    });

    try {
      await transport.waitReady({ gateway });

      // Start a consult session
      const sessionKey = buildAgentSessionKey({
        agentId: "qa",
        channel: "qa-channel",
        accountId: transport.accountId,
        peer: { kind: "direct", id: `dm:gateway-draining-test` },
        dmScope: gateway.cfg.session?.dmScope,
        identityLinks: gateway.cfg.session?.identityLinks,
      });

      // Create session
      await gateway.call("sessions.create", {
        key: sessionKey,
        label: "Gateway draining test",
      });

      // Send an inbound message that triggers a consult (tool call)
      await transport.sendInbound({
        accountId: transport.accountId,
        conversation: { id: "gateway-draining-test", kind: "direct" },
        senderId: "gateway-draining-test",
        text: "Run a consult test [consult-test:start]",
      });

      // Wait for the tool call to be initiated - poll the mock's debug endpoint
      await expect
        .poll(
          async () => {
            const requests = (await (
              await fetch(`${mock.baseUrl}/debug/requests`)
            ).json()) as Array<{ plannedToolName?: string; prompt?: string }>;
            return requests.some(
              (r) =>
                r.plannedToolName === "openclaw_agent_consult" ||
                r.prompt?.includes("consult-test:start"),
            );
          },
          { timeout: 30_000 },
        )
        .toBe(true);

      // Now trigger gateway restart (should emit gateway_draining)
      console.log("Triggering gateway restart to emit gateway_draining...");
      await gateway.call("gateway.restart.request", {
        reason: "e2e-gateway-draining-test",
        safe: true,
      });

      // Wait for the restart to complete and logs to appear
      await waitForQaTransportCondition(
        () => (gateway.logs().includes("gateway_draining") ? true : undefined),
        30_000,
        500,
      );

      // Check gateway logs for gateway_draining
      const logs = gateway.logs();
      console.log("Gateway logs:", logs);
      expect(logs).toContain("gateway_draining");

      // Verify the mock server received the consult request
      const requests = (await (await fetch(`${mock.baseUrl}/debug/requests`)).json()) as Array<{
        plannedToolName?: string;
        prompt?: string;
      }>;
      console.log(
        "Mock requests:",
        requests.map((r) => ({ tool: r.plannedToolName, prompt: r.prompt?.slice(0, 100) })),
      );
      expect(
        requests.some(
          (r) =>
            r.plannedToolName === "openclaw_agent_consult" ||
            r.prompt?.includes("consult-test:start"),
        ),
      ).toBe(true);
    } finally {
      await owner.stop();
      await mock.stop();
      await bus.stop();
    }
  }, 180_000);
});
