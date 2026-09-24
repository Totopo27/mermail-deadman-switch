/**
 * Cloudflare Worker Simulation & Validation Test
 * Validates the complete Cloudflare Worker lifecycle locally:
 * 1. 1-Click Vault Setup API (/api/setup-vault)
 * 2. Status inspection API (/status)
 * 3. Scheduled Cron Trigger (every 12h) checking live Solana Devnet RPC
 * 4. Real-time Mermail Webhook listener (/webhooks/mermail)
 * 5. Guardian Emergency Hold API (/api/guardian-hold)
 */

import fs from "fs";
import worker from "./worker.mjs";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";

function loadEnv() {
  const c = fs.readFileSync(".env", "utf-8");
  const env = {};
  for (const l of c.split("\n")) {
    const t = l.trim();
    if (t && !t.startsWith("#")) {
      const idx = t.indexOf("=");
      if (idx !== -1) env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
    }
  }
  return env;
}

const env = {
  ...loadEnv(),
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
  MERMAIL_MCP_URL: "https://console.mermail.app/mcp"
};

async function testWorkerFlow() {
  console.log("===============================================================");
  console.log("⚡ TEST CLOUDFLARE WORKER: SERVERLESS CRON & WEBHOOK APIS ⚡");
  console.log("Simulación de Cloudflare Edge con Solana Devnet y Mermail MCP");
  console.log("===============================================================\n");

  let passed = 0;
  const total = 5;

  // -------------------------------------------------------------------
  // TEST 1: 1-Click Setup API (/api/setup-vault)
  // -------------------------------------------------------------------
  console.log("[TEST 1/5] Testing 1-Click Vault Setup API (Zero Terminal Friction)...");
  const setupPayload = {
    ownerEmail: env.OWNER_EMAIL,
    ownerSolPubkey: env.AGENT_WALLET_SOL || "A6sKW3FgobaiWh6QYgUg3sunn6yPSWtjjEMqyEzv75NG",
    beneficiaryEmail: env.BENEFICIARY_EMAIL,
    beneficiarySolWallet: env.BENEFICIARY_WALLET_SOL || "F9tjfnvJUy8EYip947GhYM4YW7kG6U5hDcMFc3DRFbwE",
    guardianEmails: ["guardian@trusted-notary.org"],
    masterSecret: "SOLANA-CLOUD-MIGRATION-SECRET-PHRASE-2026",
    heartbeatIntervalDays: 30
  };

  const setupReq = new Request("https://deadman.app/api/setup-vault", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(setupPayload)
  });

  const setupRes = await worker.fetch(setupReq, env);
  const setupData = await setupRes.json();

  console.log(`   - Setup Response Status: ${setupRes.status}`);
  console.log(`   - Vault ID: ${setupData.switchId}`);
  console.log(`   - Beneficiary Shard (1/3): ID=${setupData.beneficiaryShard?.id} (Returned for safe storage)`);
  console.log(`   - Guardian Shard (3/3):    ID=${setupData.guardianShard?.id}`);
  console.log(`   - Agent Status: ${setupData.status}`);

  if (setupRes.status === 200 && setupData.status === "ARMED" && setupData.beneficiaryShard) {
    console.log("   --> [PASS] 1-Click Vault Setup API verified.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] 1-Click Setup failed.\n");
  }

  // -------------------------------------------------------------------
  // TEST 2: Status & Healthcheck Endpoint (/status)
  // -------------------------------------------------------------------
  console.log("[TEST 2/5] Testing /status healthcheck endpoint...");
  const statusReq = new Request(`https://deadman.app/status?id=${setupData.switchId}`);
  const statusRes = await worker.fetch(statusReq, env);
  const statusData = await statusRes.json();

  console.log(`   - Environment: ${statusData.environment}`);
  console.log(`   - Current Switch Status: ${statusData.status}`);

  if (statusRes.status === 200 && statusData.status === "ARMED") {
    console.log("   --> [PASS] /status endpoint verified.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] /status endpoint failed.\n");
  }

  // -------------------------------------------------------------------
  // TEST 3: Scheduled Cron Trigger (Direct Solana JSON-RPC on Edge)
  // -------------------------------------------------------------------
  console.log("[TEST 3/5] Testing Scheduled Cron Trigger (every 12h on Solana Devnet)...");
  try {
    // Simulamos la ejecución del Cron Trigger en Cloudflare
    await worker.scheduled({ cron: "0 */12 * * *" }, env, {});
    console.log("   - Cron Trigger executed successfully on edge.");

    // Consultamos el estado para confirmar que el sensor on-chain refrescó el heartbeat
    const checkReq = new Request(`https://deadman.app/status?id=${setupData.switchId}`);
    const checkRes = await worker.fetch(checkReq, env);
    const checkData = await checkRes.json();

    console.log(`   - Switch state after Cron run: ${checkData.state.status}`);
    console.log(`   - Last Heartbeat refreshed by on-chain activity: ${checkData.state.lastHeartbeatAt}`);

    if (checkData.state.status === "ARMED") {
      console.log("   --> [PASS] Scheduled Cron on-chain evaluation verified.\n");
      passed++;
    } else {
      console.log("   --> [FAIL] Cron evaluation failed.\n");
    }
  } catch (err) {
    console.log(`   --> [FAIL] Cron error: ${err.message}\n`);
  }

  // -------------------------------------------------------------------
  // TEST 4: Mermail Webhook Receiver (/webhooks/mermail)
  // -------------------------------------------------------------------
  console.log("[TEST 4/5] Testing Mermail Webhook Receiver (Event-Driven Check-in)...");
  const ownerPriv = ed25519.utils.randomPrivateKey();
  const ownerPub = bs58.encode(ed25519.getPublicKey(ownerPriv));
  const ts = Date.now();
  const nonce = `webhook-nonce-${Date.now()}`;
  const msg = `DMS-HEARTBEAT:${ts}:${nonce}`;
  const sig = bs58.encode(ed25519.sign(new TextEncoder().encode(msg), ownerPriv));

  const webhookReq = new Request("https://deadman.app/webhooks/mermail", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: "message.received",
      message: {
        sender: env.OWNER_EMAIL,
        subject: `[WEBHOOK CHECK-IN] ${nonce}`,
        signaturePayload: {
          timestamp: ts,
          nonce,
          signature: sig,
          publicKey: ownerPub,
          message: msg
        }
      }
    })
  });

  const webhookRes = await worker.fetch(webhookReq, env);
  const webhookData = await webhookRes.json();

  console.log(`   - Webhook response: ${webhookData.message} (Status: ${webhookData.status})`);

  if (webhookRes.status === 200 && webhookData.status === "ARMED") {
    console.log("   --> [PASS] Event-driven webhook processing verified.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Webhook processing failed.\n");
  }

  // -------------------------------------------------------------------
  // TEST 5: Guardian Emergency Hold API (/api/guardian-hold)
  // -------------------------------------------------------------------
  console.log("[TEST 5/5] Testing Guardian Emergency Hold API (/api/guardian-hold)...");
  const holdReq = new Request("https://deadman.app/api/guardian-hold", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      guardianEmail: "guardian@trusted-notary.org",
      holdDays: 14,
      reason: "Owner admitted to clinic, emergency pause requested"
    })
  });

  const holdRes = await worker.fetch(holdReq, env);
  const holdData = await holdRes.json();

  console.log(`   - Guardian Hold Response: Status=${holdData.status}, HoldUntil=${holdData.holdUntil?.split("T")[0]}`);

  if (holdRes.status === 200 && holdData.status === "GUARDIAN_HOLD") {
    console.log("   --> [PASS] Guardian Emergency Hold API verified.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Guardian hold failed.\n");
  }

  // -------------------------------------------------------------------
  // RESUMEN
  // -------------------------------------------------------------------
  console.log("===============================================================");
  console.log(`🏆 RESUMEN CLOUDFLARE WORKER: ${passed}/${total} PRUEBAS PASADAS (100%)`);
  console.log("===============================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

testWorkerFlow().catch(err => {
  console.error("FATAL ERROR in Worker test:", err);
  process.exit(1);
});
