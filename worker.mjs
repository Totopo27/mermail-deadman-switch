/**
 * Cloudflare Worker: Autonomous Mermail Dead Man's Switch
 * Runs 24/7/365 serverless on Cloudflare's Edge network for $0/month.
 * 
 * CAPABILITIES:
 * 1. Scheduled Cron Trigger (every 12 hours):
 *    - Checks on-chain Solana activity (passive liveness) via zero-dependency JSON-RPC.
 *    - Evaluates tiered grace windows and auto-dispatches warnings or contingency.
 * 2. HTTP Webhook Receiver:
 *    - Receives push events from Mermail when an owner emails a check-in.
 * 3. 1-Click Vault Setup API:
 *    - Automates Shamir threshold splitting (2-of-3) and configuration without terminal friction.
 */

import { DeadMansSwitchEngine, NotaryAgentAdvisor } from "./deadman-engine.mjs";
import { splitSecret } from "./shamir.mjs";

// In-memory fallback for local execution / testing without KV
const memoryStore = new Map();

async function getState(env, key) {
  if (env && env.DEADMAN_KV) {
    const val = await env.DEADMAN_KV.get(key, { type: "json" });
    if (val) return val;
  }
  return memoryStore.get(key) || null;
}

async function saveState(env, key, data) {
  if (env && env.DEADMAN_KV) {
    await env.DEADMAN_KV.put(key, JSON.stringify(data));
  }
  memoryStore.set(key, data);
}

/**
 * Direct lightweight Solana JSON-RPC query for Cloudflare Edge.
 * Requires 0 external npm libraries and runs in <300ms.
 */
async function querySolanaOnChainLiveness(rpcUrl, pubkey) {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "getSignaturesForAddress",
        params: [pubkey, { limit: 1 }]
      })
    });
    const data = await res.json();
    if (data && data.result && data.result.length > 0) {
      const tx = data.result[0];
      return {
        hasTx: true,
        signature: tx.signature,
        blockTimeMs: tx.blockTime ? tx.blockTime * 1000 : Date.now()
      };
    }
    return { hasTx: false, signature: null, blockTimeMs: null };
  } catch (err) {
    return { hasTx: false, error: err.message };
  }
}

/**
 * Dispatches an email via Mermail MCP HTTP interface.
 */
async function dispatchMermailEmail(mcpUrl, apiKey, mailboxId, { to, from, subject, text }) {
  const res = await fetch(mcpUrl, {
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
      params: {
        name: "send_email",
        arguments: {
          mailboxId,
          body: { to, from, subject, text }
        }
      }
    })
  });
  return await res.json();
}

export default {
  /**
   * CRON TRIGGER HANDLER: Wakes up every 12 hours on Cloudflare Edge
   */
  async scheduled(event, env, ctx) {
    const switchId = "DMS-VAULT-2026-XEN";
    const stored = await getState(env, switchId);
    if (!stored) {
      console.log(`[CRON]: No active switch state found for ${switchId}.`);
      return;
    }

    const engine = new DeadMansSwitchEngine(stored);
    const rpcUrl = env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const mcpUrl = env.MERMAIL_MCP_URL || "https://console.mermail.app/mcp";

    console.log(`[CRON]: Waking up. Evaluating switch ${switchId} (Current Status: ${engine.state.status})`);

    // 1. SENSOR PASIVO ON-CHAIN: Consulta Solana RPC directamente
    if (engine.ownerSolPubkey && engine.state.status !== "TRIGGERED") {
      const onChain = await querySolanaOnChainLiveness(rpcUrl, engine.ownerSolPubkey);
      if (onChain.hasTx) {
        const daysSinceTx = (Date.now() - onChain.blockTimeMs) / (1000 * 60 * 60 * 24);
        if (daysSinceTx <= engine.state.heartbeatIntervalDays) {
          engine.state.lastHeartbeatAt = new Date(onChain.blockTimeMs).toISOString();
          engine.state.warningIssuedAt = null;
          engine.state.guardianNotifiedAt = null;
          engine.state.guardianHoldUntil = null;
          engine.state.status = "ARMED";
          console.log(`[CRON]: On-chain activity confirmed (${Math.round(daysSinceTx)} days ago). Timer auto-refreshed to ARMED.`);
          await saveState(env, switchId, engine.state);
          return;
        }
      }
    }

    // 2. EVALUACIÓN DE ESTADOS ESCALONADOS
    const evalRes = engine.evaluateSwitchStatus();
    console.log(`[CRON]: Switch evaluation outcome: ${evalRes.status} (Action: ${evalRes.actionRequired})`);

    // A. TRIGGERED: Ejecución Irrevocable de Contingencia
    if (evalRes.isTriggered && engine.state.status === "TRIGGERED" && !stored.contingencyDelivered) {
      const guidance = NotaryAgentAdvisor.generateBeneficiaryGuidance({
        ownerName: engine.ownerEmail,
        beneficiaryEmail: engine.beneficiaryEmail,
        custodiedShare: engine.state.custodiedShare,
        solRescueAmount: 0.05
      });

      if (env.MERMAIL_API_KEY_CUSTODIAN && env.CUSTODIAN_MAILBOX_ID) {
        await dispatchMermailEmail(mcpUrl, env.MERMAIL_API_KEY_CUSTODIAN, env.CUSTODIAN_MAILBOX_ID, {
          to: engine.beneficiaryEmail,
          from: engine.custodianEmail,
          subject: guidance.subject,
          text: guidance.guidanceText
        });
        console.log(`[CRON]: Shard #2 and contingency directives dispatched to beneficiary via Mermail.`);
      }
      engine.state.contingencyDelivered = true;
    }
    // B. WARNING_ISSUED: Alerta escalonada al dueño
    else if (evalRes.isWarning && evalRes.status === "WARNING_ISSUED" && !stored.warningSentToday) {
      if (env.MERMAIL_API_KEY_CUSTODIAN && env.CUSTODIAN_MAILBOX_ID) {
        await dispatchMermailEmail(mcpUrl, env.MERMAIL_API_KEY_CUSTODIAN, env.CUSTODIAN_MAILBOX_ID, {
          to: engine.ownerEmail,
          from: engine.custodianEmail,
          subject: `[URGENTE] Recordatorio de Prueba de Vida - Dead Man's Switch (${evalRes.graceHoursRemaining}h restantes)`,
          text: `Aviso de contingencia: No se detectó actividad on-chain ni pulso de vida. Restan ${evalRes.graceHoursRemaining} horas antes de la ejecución irrevocable.`
        });
      }
      engine.state.warningSentToday = true;
    }

    await saveState(env, switchId, engine.state);
  },

  /**
   * HTTP FETCH HANDLER: API REST y Receptor de Webhooks de Mermail
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Healthcheck & Status
    if (url.pathname === "/health" || url.pathname === "/status") {
      const switchId = url.searchParams.get("id") || "DMS-VAULT-2026-XEN";
      const state = await getState(env, switchId);
      return new Response(JSON.stringify({
        service: "Mermail Dead Man's Switch (Cloudflare Worker)",
        environment: "Cloudflare Edge Serverless",
        status: state ? state.status : "NOT_CONFIGURED",
        state: state || null,
        timestamp: new Date().toISOString()
      }, null, 2), {
        headers: { "content-type": "application/json" }
      });
    }

    // 1-Click Vault Setup API (Sin terminal ni fricción)
    if (url.pathname === "/api/setup-vault" && request.method === "POST") {
      try {
        const body = await request.json();
        const {
          ownerEmail,
          ownerSolPubkey,
          beneficiaryEmail,
          beneficiarySolWallet,
          guardianEmails = [],
          masterSecret,
          heartbeatIntervalDays = 30
        } = body;

        if (!ownerEmail || !beneficiaryEmail || !masterSecret) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
        }

        const engine = new DeadMansSwitchEngine({
          ownerEmail,
          ownerSolPubkey,
          beneficiaryEmail,
          beneficiarySolWallet,
          guardianEmails,
          heartbeatIntervalDays
        });

        // Genera los 3 shards de Shamir (2-de-3)
        const vault = engine.setupThresholdVault(masterSecret, { n: 3, k: 2 });
        await saveState(env, engine.state.id, engine.state);

        return new Response(JSON.stringify({
          success: true,
          message: "Vault configured successfully in Cloudflare. No local daemon needed.",
          switchId: engine.state.id,
          status: "ARMED",
          beneficiaryShard: vault.beneficiaryShare, // Shard #1 para guardar offline
          guardianShard: vault.guardianShare        // Shard #3 para el guardián
        }, null, 2), {
          headers: { "content-type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // Receptor de Webhooks de Mermail (Disparo por eventos en tiempo real)
    if (url.pathname === "/webhooks/mermail" && request.method === "POST") {
      try {
        const payload = await request.json();
        const switchId = "DMS-VAULT-2026-XEN";
        const stored = await getState(env, switchId);

        if (!stored) {
          return new Response(JSON.stringify({ error: "No active switch" }), { status: 404 });
        }

        const engine = new DeadMansSwitchEngine(stored);

        // Si el evento de Mermail contiene un mensaje entrante
        const message = payload.message || payload.data || payload;
        const accepted = engine.auditOwnerHeartbeat(message);

        if (accepted) {
          await saveState(env, switchId, engine.state);
          return new Response(JSON.stringify({
            received: true,
            status: "ARMED",
            message: "Heartbeat validated via webhook and switch re-armed."
          }), { headers: { "content-type": "application/json" } });
        } else {
          return new Response(JSON.stringify({
            received: true,
            status: engine.state.status,
            message: "Inbound message processed; heartbeat not recognized or rejected."
          }), { headers: { "content-type": "application/json" } });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // Endpoint para que un guardián aplique una pausa de emergencia (Hold)
    if (url.pathname === "/api/guardian-hold" && request.method === "POST") {
      const body = await request.json();
      const switchId = "DMS-VAULT-2026-XEN";
      const stored = await getState(env, switchId);
      if (!stored) return new Response(JSON.stringify({ error: "Vault not found" }), { status: 404 });

      const engine = new DeadMansSwitchEngine(stored);
      const holdRes = engine.applyGuardianHold({
        guardianEmail: body.guardianEmail,
        holdDays: body.holdDays || 14,
        reason: body.reason || "Guardian emergency hold requested via Cloudflare API"
      });

      if (holdRes.success) {
        await saveState(env, switchId, engine.state);
        return new Response(JSON.stringify(holdRes), { headers: { "content-type": "application/json" } });
      } else {
        return new Response(JSON.stringify(holdRes), { status: 403 });
      }
    }

    return new Response("Mermail Dead Man's Switch - Cloudflare Serverless Worker", { status: 200 });
  }
};
