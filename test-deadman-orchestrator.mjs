import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DeadMansSwitchEngine } from "./deadman-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const possiblePaths = [
    path.resolve(__dirname, ".env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "mermail-deadman-switch", ".env"),
    path.resolve(__dirname, "..", ".env")
  ];

  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
      break;
    }
  }
}

loadEnv();

const MCP_URL = process.env.MERMAIL_MCP_URL || "https://console.mermail.app/mcp";
const CUSTODIAN_KEY = process.env.MERMAIL_API_KEY_CUSTODIAN;
const CUSTODIAN_MAILBOX_ID = process.env.CUSTODIAN_MAILBOX_ID;
const CUSTODIAN_EMAIL = process.env.CUSTODIAN_EMAIL;

const OWNER_EMAIL = process.env.OWNER_EMAIL;
const BENEFICIARY_EMAIL = process.env.BENEFICIARY_EMAIL;
const BENEFICIARY_WALLET = process.env.AGENT_WALLET_SOL; // La wallet Solana que fondeamos

async function callMcp(apiKey, name, args) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args }
    })
  });

  if (!res.ok) {
    throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`MCP Error [${data.error.code || "RPC"}]: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data;
}

async function run() {
  console.log("===============================================================");
  console.log("⏳  MERMAIL DEAD MAN'S SWITCH - DIGITAL INHERITANCE & RESCUE");
  console.log("===============================================================\n");

  const engine = new DeadMansSwitchEngine({
    custodianEmail: CUSTODIAN_EMAIL,
    ownerEmail: OWNER_EMAIL,
    beneficiaryEmail: BENEFICIARY_EMAIL,
    beneficiarySolWallet: BENEFICIARY_WALLET
  });

  console.log(`[Switch ID]:         ${engine.state.id}`);
  console.log(`[AI Custodian]:      ${CUSTODIAN_EMAIL}`);
  console.log(`[Owner / Principal]: ${OWNER_EMAIL}`);
  console.log(`[Beneficiary]:       ${BENEFICIARY_EMAIL}`);
  console.log(`[Rescue Wallet]:     ${BENEFICIARY_WALLET}`);
  console.log(`[Heartbeat Rule]:    Mandatory check-in every ${engine.state.heartbeatIntervalDays} days`);
  console.log(`[Grace Window]:      ${engine.state.gracePeriodHours} hours`);
  console.log(`[Last Heartbeat]:    ${engine.state.lastHeartbeatAt}\n`);

  console.log("[1] Evaluating owner inactivity and heartbeat status...");
  const statusEval = engine.evaluateSwitchStatus();

  if (statusEval.isTriggered) {
    console.log(`🚨 \x1b[31mALERT: GRACE PERIOD EXPIRED ${statusEval.daysOverdue} DAYS AGO WITHOUT PROOF OF LIFE\x1b[0m`);
    console.log("   Owner did not respond to warnings or emit a valid check-in.");
    console.log("   Initiating irrevocable contingency protocol towards beneficiary...\n");

    console.log("[2] Composing and delivering contingency directives to beneficiary...");
    const rescueText = `NOTARIAL CONTINGENCY NOTICE - DEAD MAN'S SWITCH EXECUTED

Dear ${BENEFICIARY_EMAIL},

This is an autonomous encrypted contingency communication issued by the Mermail AI Custodian Vault.
The Principal (${OWNER_EMAIL}) has exceeded the maximum inactivity window of ${engine.state.heartbeatIntervalDays} days plus the extended grace period without submitting life verification.

In accordance with approved contingency directives:
1. Secret Share / Directives Vault ID: ${engine.state.contingencyDirectives.encryptedSecretVaultId}
2. Emergency Rescue Allocation: ${engine.state.contingencyDirectives.emergencyRescueSolAmount} SOL
3. Settlement Solana Wallet: ${BENEFICIARY_WALLET}
4. On-chain Transaction Verification: https://explorer.solana.com/address/${BENEFICIARY_WALLET}?cluster=devnet

This contingency protocol is irrevocable and has executed to completion.

Sincerely,
Mermail Dead Man's Switch Agent Vault`;

    const sendRes = await callMcp(CUSTODIAN_KEY, "send_email", {
      mailboxId: CUSTODIAN_MAILBOX_ID,
      body: {
        from: CUSTODIAN_EMAIL,
        to: BENEFICIARY_EMAIL,
        subject: engine.state.contingencyDirectives.finalNoticeSubject,
        text: rescueText
      }
    });

    console.log("✅ Contingency email dispatched to Beneficiary:");
    console.log("   - Message ID:", sendRes.result?.content?.[0]?.text || "Delivered");
    console.log("   - Vault Status: [DISMISSED & DELIVERED]");

    console.log("\n[3] Dispatching on-chain rescue transfer via PayBox / Agent Wallet...");
    try {
      const transferRes = await callMcp(CUSTODIAN_KEY, "paybox_request_transfer", {
        credential: "sol-default",
        recipient: BENEFICIARY_WALLET,
        amount_decimal: engine.state.contingencyDirectives.emergencyRescueSolAmount,
        memo: "DMS_EMERGENCY_RESCUE_TRANSFER"
      });
      console.log("✅ PayBox transfer dispatched successfully:");
      console.log("   - Details:", transferRes.result?.content?.[0]?.text || JSON.stringify(transferRes.result || transferRes));
    } catch (payboxErr) {
      console.warn("⚠️ PayBox transfer notice (Devnet fallback / test environment):", payboxErr.message);
    }
    console.log("   - Solana Devnet Explorer:");
    console.log(`     https://explorer.solana.com/address/${BENEFICIARY_WALLET}?cluster=devnet\n`);

  } else if (statusEval.isWarning) {
    console.log(`⚠️ \x1b[33mWARNING: HEARTBEAT INTERVAL EXCEEDED ${statusEval.daysOverdue} DAYS AGO\x1b[0m`);
    console.log(`   Switch transitioned to WARNING_ISSUED state.`);
    console.log(`   Remaining grace window: ${statusEval.graceHoursRemaining} hours before irrevocable trigger.`);
    console.log("   Sending urgent warning notice to Owner...");

    const warningText = `URGENT PROOF OF LIFE NOTICE (DEAD MAN'S SWITCH)

Dear Principal (${OWNER_EMAIL}),

Your autonomous Mermail custodian has not received an active check-in within the agreed ${engine.state.heartbeatIntervalDays}-day interval.
You have a grace period of ${statusEval.graceHoursRemaining} hours remaining to send a [CHECK-IN] email confirming you are safe and operational.

Failure to respond within this window will irrevocably execute the contingency protocol, transferring emergency assets and encrypted vault directives to your designated beneficiary (${BENEFICIARY_EMAIL}).

Sincerely,
Mermail Dead Man's Switch Agent Vault`;

    const warnRes = await callMcp(CUSTODIAN_KEY, "send_email", {
      mailboxId: CUSTODIAN_MAILBOX_ID,
      body: {
        from: CUSTODIAN_EMAIL,
        to: OWNER_EMAIL,
        subject: engine.state.contingencyDirectives.warningNoticeSubject,
        text: warningText
      }
    });

    console.log("✅ Grace period alert dispatched to Owner:");
    console.log("   - Message ID:", warnRes.result?.content?.[0]?.text || "Delivered");
    console.log("   - Switch Status: [WARNING_ISSUED]\n");

  } else {
    console.log(`🟢 Switch operating normally (ARMED). ${statusEval.daysRemaining} days remaining until next check-in.`);
  }

  console.log("===============================================================");
}

run().catch(err => {
  console.error("Error executing dead man's switch orchestrator:", err);
  process.exit(1);
});
