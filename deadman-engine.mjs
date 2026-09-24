/**
 * Dead Man's Switch Engine
 * Autonomous contingency, digital inheritance, and asset rescue engine.
 * 
 * ARCHITECTURE (DUAL-CORE & MIXED LIVENESS):
 * 1. DETERMINISTIC KERNEL:
 *    - On-Chain Inactivity Sensor (Solana RPC getSignaturesForAddress)
 *    - Off-Chain Cryptographic Heartbeat (Ed25519 detached signatures)
 *    - Tiered Grace Windows & Guardian Hold
 *    - Shamir's Secret Sharing (2-of-3) Threshold Vault
 * 2. NOTARY ADVISOR:
 *    - Non-technical Beneficiary Guidance
 *    - Natural Language Emergency Hold Triage
 */

import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { splitSecret, combineShares } from "./shamir.mjs";

function extractEmailAddress(sender) {
  if (!sender || typeof sender !== "string") return "";
  const match = sender.match(/<([^>]+)>/);
  if (match) return match[1].trim().toLowerCase();
  return sender.trim().toLowerCase();
}

/**
 * Validates Ed25519 signature over a message against a Solana public key.
 */
export function verifySolanaSignature({ message, signatureBase58, publicKeyBase58 }) {
  try {
    if (!message || !signatureBase58 || !publicKeyBase58) return false;
    const msgBytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
    const sigBytes = bs58.decode(signatureBase58);
    const pubBytes = bs58.decode(publicKeyBase58);
    return ed25519.verify(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}

export class DeadMansSwitchEngine {
  constructor(config = {}) {
    this.id = config.id || "DMS-VAULT-2026-XEN";
    this.custodianEmail = config.custodianEmail || config.custodianEmail;
    this.ownerEmail = config.ownerEmail;
    this.ownerSolPubkey = config.ownerSolPubkey || null;
    this.beneficiaryEmail = config.beneficiaryEmail;
    this.beneficiarySolWallet = config.beneficiarySolWallet;
    this.guardianEmails = (config.guardianEmails || []).map(e => e.toLowerCase());

    // Security flags
    this.requireCryptoSignature = config.requireCryptoSignature ?? false;
    this.consumedNonces = new Set();

    // Contingency switch configuration and internal state
    this.state = {
      id: this.id,
      ownerEmail: this.ownerEmail,
      ownerSolPubkey: this.ownerSolPubkey,
      custodianEmail: this.custodianEmail,
      beneficiaryEmail: this.beneficiaryEmail,
      beneficiarySolWallet: this.beneficiarySolWallet,
      guardianEmails: this.guardianEmails,
      status: config.status || "ARMED", // ARMED | WARNING_ISSUED | GUARDIAN_HOLD | TRIGGERED | DISARMED
      lastHeartbeatAt: config.lastHeartbeatAt || new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
      heartbeatIntervalDays: config.heartbeatIntervalDays ?? 30, // Base interval
      gracePeriodHours: config.gracePeriodHours ?? 48,           // Backwards-compatible grace hours

      // Tiered Grace Windows configuration (in days)
      tieredConfig: {
        tier1SoftPingDays: config.tier1SoftPingDays ?? 30,     // Day 30: Soft reminder to owner
        tier2UrgentDays: config.tier2UrgentDays ?? 37,         // Day 37: Multi-channel urgent warning
        tier3GuardianDays: config.tier3GuardianDays ?? 45,     // Day 45: Escalation to trusted guardians
        tier4TriggerDays: config.tier4TriggerDays ?? 60        // Day 60: Absolute final deadline
      },

      warningIssuedAt: config.warningIssuedAt || null,
      guardianNotifiedAt: config.guardianNotifiedAt || null,
      triggeredAt: config.triggeredAt || null,
      guardianHoldUntil: config.guardianHoldUntil || null,
      guardianHoldReason: null,

      // On-Chain Liveness sensor tracking
      lastOnChainTxSignature: null,
      lastOnChainBlockTime: null,

      // Threshold Vault Custody (Shamir Secret Sharing)
      custodiedShare: config.custodiedShare || null,

      contingencyDirectives: {
        encryptedSecretVaultId: "VAULT_SHAMIR_SECRET_SHARE_001_AES256",
        emergencyRescueSolAmount: 0.05,
        finalNoticeSubject: "[CONTINGENCY ACTIVATION] Dead Man's Switch Protocol Executed",
        warningNoticeSubject: "[URGENT] Proof of Life Check-in - Dead Man's Switch"
      }
    };
  }

  /**
   * SENSOR 1: PASSIVE ON-CHAIN LIVENESS
   * Polls the Solana blockchain for recent confirmed transactions from the owner's wallet.
   * If a transaction exists within the heartbeat interval, the timer resets automatically
   * with ZERO manual effort required from the user.
   * 
   * @param {import('@solana/web3.js').Connection} connection
   * @returns {Promise<{ active: boolean, lastTxSignature: string|null, blockTime: number|null, message: string }>}
   */
  async auditOnChainLiveness(connection) {
    if (!connection || !this.ownerSolPubkey) {
      return { active: false, lastTxSignature: null, blockTime: null, message: "Missing connection or owner public key" };
    }

    if (this.state.status === "TRIGGERED") {
      return { active: false, lastTxSignature: null, blockTime: null, message: "Switch is already TRIGGERED (irrevocable)" };
    }

    try {
      const ownerPubkey = new PublicKey(this.ownerSolPubkey);
      const signatures = await connection.getSignaturesForAddress(ownerPubkey, { limit: 1 });

      if (!signatures || signatures.length === 0) {
        return { active: false, lastTxSignature: null, blockTime: null, message: "No on-chain transactions found for owner address" };
      }

      const latestTx = signatures[0];
      const blockTimeMs = latestTx.blockTime ? latestTx.blockTime * 1000 : Date.now();
      const now = Date.now();
      const daysSinceTx = (now - blockTimeMs) / (1000 * 60 * 60 * 24);

      this.state.lastOnChainTxSignature = latestTx.signature;
      this.state.lastOnChainBlockTime = blockTimeMs;

      // If on-chain activity occurred within the active interval (e.g., 30 days)
      if (daysSinceTx <= this.state.heartbeatIntervalDays) {
        this.state.lastHeartbeatAt = new Date(blockTimeMs).toISOString();
        this.state.warningIssuedAt = null;
        this.state.guardianNotifiedAt = null;
        this.state.guardianHoldUntil = null;
        this.state.status = "ARMED";
        return {
          active: true,
          lastTxSignature: latestTx.signature,
          blockTime: blockTimeMs,
          daysSinceTx: Math.round(daysSinceTx),
          message: `On-chain activity verified (${Math.round(daysSinceTx)} days ago, tx: ${latestTx.signature.substring(0, 16)}...). Switch refreshed to ARMED.`
        };
      } else {
        return {
          active: false,
          lastTxSignature: latestTx.signature,
          blockTime: blockTimeMs,
          daysSinceTx: Math.round(daysSinceTx),
          message: `Last on-chain activity is ${Math.round(daysSinceTx)} days old (exceeds ${this.state.heartbeatIntervalDays}-day interval). Fallback to email or guardian verification required.`
        };
      }
    } catch (err) {
      return { active: false, lastTxSignature: null, blockTime: null, message: `On-chain query failed: ${err.message}` };
    }
  }

  /**
   * SENSOR 2: ACTIVE OFF-CHAIN EMAIL HEARTBEAT (FALLBACK)
   * Audits incoming email to determine if owner emitted a valid Proof of Life.
   * Supports both standard text regex and Ed25519 cryptographic signatures.
   */
  auditOwnerHeartbeat(email) {
    if (!email) return false;

    // CRITICAL INVARIANT: Once TRIGGERED, execution is irrevocable
    if (this.state.status === "TRIGGERED") {
      return false;
    }

    // STRICT SENDER VERIFICATION (RFC 5322 Layer 1)
    const cleanSender = extractEmailAddress(email.sender);
    const expectedOwner = (this.ownerEmail || "").trim().toLowerCase();
    const isFromOwner = cleanSender.length > 0 && cleanSender === expectedOwner;
    if (!isFromOwner) return false;

    const content = `${email.subject || ""} ${email.body || email.text || ""}`;

    // Cryptographic Ed25519 Heartbeat Layer
    let hasCryptoSignature = false;
    let cryptoValid = false;

    let payload = null;
    if (email.signaturePayload) {
      payload = email.signaturePayload;
    } else {
      const jsonMatch = content.match(/\{[\s\S]*"signature"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          payload = JSON.parse(jsonMatch[0]);
        } catch {}
      }
    }

    if (payload && payload.signature && payload.timestamp) {
      hasCryptoSignature = true;
      const pubkey = payload.publicKey || this.ownerSolPubkey;
      
      const timestampMs = typeof payload.timestamp === "number" ? payload.timestamp : Date.parse(payload.timestamp);
      const isFresh = Math.abs(Date.now() - timestampMs) < 24 * 60 * 60 * 1000;
      const isNewNonce = payload.nonce ? !this.consumedNonces.has(payload.nonce) : true;

      const messageToVerify = payload.message || `DMS-HEARTBEAT:${payload.timestamp}:${payload.nonce || ""}`;
      const isSigValid = verifySolanaSignature({
        message: messageToVerify,
        signatureBase58: payload.signature,
        publicKeyBase58: pubkey
      });

      if (isFresh && isNewNonce && isSigValid) {
        cryptoValid = true;
        if (payload.nonce) this.consumedNonces.add(payload.nonce);
      }
    }

    // Enforce crypto signature if configured
    if (this.requireCryptoSignature) {
      if (!cryptoValid) {
        return false;
      }
    } else if (hasCryptoSignature && !cryptoValid) {
      return false;
    }

    // Natural Language / Regex Heartbeat Detection
    const isHeartbeat = /(\[check-in\]|\[heartbeat\]|\[proof-of-life\]|alive|check-in|heartbeat|active|still here|i am fine|estoy bien)/i.test(content) || cryptoValid;

    if (isHeartbeat) {
      this.state.lastHeartbeatAt = new Date().toISOString();
      this.state.warningIssuedAt = null;
      this.state.guardianNotifiedAt = null;
      this.state.guardianHoldUntil = null;
      this.state.guardianHoldReason = null;
      this.state.status = "ARMED";
      return true;
    }

    return false;
  }

  /**
   * Sets up a Shamir Secret Sharing (k-of-n) threshold scheme.
   */
  setupThresholdVault(masterSecret, { n = 3, k = 2 } = {}) {
    const shares = splitSecret(masterSecret, n, k);
    this.state.custodiedShare = shares[1]; // Agent holds Shard 2
    return {
      beneficiaryShare: shares[0], // Shard 1
      custodianShare: shares[1],   // Shard 2 (retained)
      guardianShare: shares[2]     // Shard 3
    };
  }

  /**
   * Reconstructs the master secret from any valid subset of k shares.
   */
  reconstructVaultSecret(shares) {
    return combineShares(shares);
  }

  /**
   * Applies an emergency hold requested by a designated guardian.
   */
  applyGuardianHold({ guardianEmail, holdDays = 14, reason = "Guardian requested verification hold" }) {
    const cleanGuardian = (guardianEmail || "").trim().toLowerCase();
    if (!this.guardianEmails.includes(cleanGuardian)) {
      return { success: false, error: "Unauthorized guardian address" };
    }

    if (this.state.status === "TRIGGERED") {
      return { success: false, error: "Cannot apply hold to an already TRIGGERED switch" };
    }

    const holdUntil = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000).toISOString();
    this.state.status = "GUARDIAN_HOLD";
    this.state.guardianHoldUntil = holdUntil;
    this.state.guardianHoldReason = reason;

    return {
      success: true,
      status: "GUARDIAN_HOLD",
      holdUntil,
      reason
    };
  }

  /**
   * Evaluates switch status against reference time.
   */
  evaluateSwitchStatus(referenceDate = new Date()) {
    const now = new Date(referenceDate);
    const lastCheckin = new Date(this.state.lastHeartbeatAt);
    const daysSinceLast = (now - lastCheckin) / (1000 * 60 * 60 * 24);
    const gracePeriodDays = (this.state.gracePeriodHours || 48) / 24;
    const intervalDays = this.state.heartbeatIntervalDays;
    const triggerThresholdDays = intervalDays + gracePeriodDays;

    if (this.state.status === "GUARDIAN_HOLD" && this.state.guardianHoldUntil) {
      const holdUntil = new Date(this.state.guardianHoldUntil);
      if (now < holdUntil) {
        return {
          status: "GUARDIAN_HOLD",
          isTriggered: false,
          isWarning: true,
          currentTier: 3,
          holdUntil: this.state.guardianHoldUntil,
          holdReason: this.state.guardianHoldReason,
          actionRequired: "AWAIT_GUARDIAN_VERIFICATION"
        };
      }
    }

    if (this.state.status === "TRIGGERED") {
      return {
        status: "TRIGGERED",
        isTriggered: true,
        isWarning: false,
        currentTier: 4,
        daysOverdue: Math.max(0, Math.round(daysSinceLast - triggerThresholdDays)),
        lastHeartbeat: this.state.lastHeartbeatAt,
        actionRequired: "EXECUTE_CONTINGENCY_PROTOCOL",
        custodiedShare: this.state.custodiedShare
      };
    }

    if (daysSinceLast > triggerThresholdDays) {
      this.state.status = "TRIGGERED";
      if (!this.state.triggeredAt) {
        this.state.triggeredAt = now.toISOString();
      }
      return {
        status: "TRIGGERED",
        isTriggered: true,
        isWarning: false,
        currentTier: 4,
        daysOverdue: Math.round(daysSinceLast - triggerThresholdDays),
        lastHeartbeat: this.state.lastHeartbeatAt,
        actionRequired: "EXECUTE_CONTINGENCY_PROTOCOL",
        custodiedShare: this.state.custodiedShare
      };
    }

    if (daysSinceLast > intervalDays) {
      this.state.status = "WARNING_ISSUED";
      if (!this.state.warningIssuedAt) {
        this.state.warningIssuedAt = now.toISOString();
      }
      const graceHoursRemaining = Math.max(0, Math.round((triggerThresholdDays - daysSinceLast) * 24));
      return {
        status: "WARNING_ISSUED",
        isTriggered: false,
        isWarning: true,
        currentTier: daysSinceLast > (intervalDays + 7) ? 2 : 1,
        daysOverdue: Math.round(daysSinceLast - intervalDays),
        graceHoursRemaining,
        lastHeartbeat: this.state.lastHeartbeatAt,
        actionRequired: "ISSUE_WARNING_NOTICE"
      };
    }

    this.state.status = "ARMED";
    return {
      status: "ARMED",
      isTriggered: false,
      isWarning: false,
      currentTier: 0,
      daysRemaining: Math.round(intervalDays - daysSinceLast),
      lastHeartbeat: this.state.lastHeartbeatAt,
      actionRequired: "STANDBY"
    };
  }

  evaluateTieredStatus(referenceDate = new Date()) {
    const now = new Date(referenceDate);
    const lastCheckin = new Date(this.state.lastHeartbeatAt);
    const days = (now - lastCheckin) / (1000 * 60 * 60 * 24);
    const cfg = this.state.tieredConfig;

    if (this.state.status === "TRIGGERED" || days >= cfg.tier4TriggerDays) {
      this.state.status = "TRIGGERED";
      return { tier: 4, label: "FINAL_TRIGGER", action: "EXECUTE_CONTINGENCY_PROTOCOL", days };
    }
    if (this.state.status === "GUARDIAN_HOLD") {
      return { tier: 3, label: "GUARDIAN_HOLD", action: "AWAIT_GUARDIAN_VERIFICATION", days };
    }
    if (days >= cfg.tier3GuardianDays) {
      return { tier: 3, label: "GUARDIAN_ESCALATION", action: "NOTIFY_GUARDIANS", days };
    }
    if (days >= cfg.tier2UrgentDays) {
      return { tier: 2, label: "URGENT_NOTICE", action: "MULTI_CHANNEL_ALERT", days };
    }
    if (days >= cfg.tier1SoftPingDays) {
      return { tier: 1, label: "SOFT_REMINDER", action: "SEND_SOFT_PING", days };
    }
    return { tier: 0, label: "ARMED_HEALTHY", action: "STANDBY", days };
  }
}

/**
 * NotaryAgentAdvisor (AI / Human-Facing Layer)
 */
export class NotaryAgentAdvisor {
  static generateBeneficiaryGuidance({ ownerName = "The Principal", beneficiaryEmail, custodiedShare, solRescueAmount = 0.05 }) {
    return {
      to: beneficiaryEmail,
      subject: `[Confidential] Emergency Contingency Directive from ${ownerName}`,
      guidanceText: `Dear Beneficiary,\n\n` +
        `This automated dispatch was initiated because ${ownerName}'s Dead Man's Switch protocol has reached final trigger.\n\n` +
        `WHAT HAPPENED:\n` +
        `1. An initial rescue transfer of ${solRescueAmount} SOL has been initiated to your designated Solana wallet.\n` +
        `2. Below is Custodial Secret Shard #2 (of a 2-of-3 Shamir threshold scheme).\n\n` +
        `HOW TO RECOVER THE MASTER VAULT:\n` +
        `- You need your pre-distributed Shard #1 and this Shard #2.\n` +
        `- Shard #2 Data: ${custodiedShare ? custodiedShare.data : "VAULT_SHARD_ACTIVE"}\n` +
        `- If you need step-by-step assistance restoring your wallet, reply to this message. Your AI Notary is standing by to guide you securely.`
    };
  }

  static analyzeInboundEmergencyHoldRequest(emailContent) {
    const isEmergency = /(hospital|accident|surgery|emergency|unable to sign|intensive care|internado|accidente|espera|no ejecutes)/i.test(emailContent);
    return {
      flaggedAsEmergency: isEmergency,
      suggestedAction: isEmergency ? "REQUEST_GUARDIAN_HOLD" : "CONTINUE_STANDARD_PROTOCOL"
    };
  }
}
