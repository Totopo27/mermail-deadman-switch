/**
 * Solana Dead Man's Switch Vault - Client SDK
 * Provides PDA derivation, on-chain state inspection, and instruction builders.
 */

import { PublicKey } from "@solana/web3.js";

export const DEADMAN_PROGRAM_ID = new PublicKey("E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX");
export const RENT_RESERVE_MINIMUM_LAMPORTS = 2_500_000; // ~0.0025 SOL for 210 bytes vault account

/**
 * Derives the deterministic PDA address for a user's Dead Man's Switch Vault.
 * @param {PublicKey} ownerPubkey 
 * @param {PublicKey} [programId]
 * @returns {[PublicKey, number]} [pdaAddress, bump]
 */
export function getVaultPda(ownerPubkey, programId = DEADMAN_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deadman_vault"), ownerPubkey.toBuffer()],
    programId
  );
}

/**
 * Evaluates whether a vault is currently claimable by its beneficiary.
 * @param {object} vault
 * @param {number} [currentTimeSec]
 * @returns {{ claimable: boolean, reason: string, secondsRemaining: number }}
 */
export function evaluateVaultClaimability(vault, currentTimeSec = Math.floor(Date.now() / 1000)) {
  if (vault.status === "Triggered") {
    return { claimable: false, reason: "Vault has already been triggered and claimed", secondsRemaining: 0 };
  }

  if (vault.status === "OracleDisputePending") {
    if (currentTimeSec < vault.oracleDisputeUntil) {
      const remaining = vault.oracleDisputeUntil - currentTimeSec;
      return {
        claimable: false,
        reason: `Oracle dispute window active (${remaining}s remaining). Owner has safety window to prove life.`,
        secondsRemaining: remaining
      };
    }
    return {
      claimable: true,
      reason: "Oracle dispute period expired without owner rebuttal. Authorized to trigger payout.",
      secondsRemaining: 0
    };
  }

  if (currentTimeSec < vault.holdUntilTimestamp) {
    const holdRemaining = vault.holdUntilTimestamp - currentTimeSec;
    return {
      claimable: false,
      reason: `Guardian emergency hold active (${holdRemaining}s remaining)`,
      secondsRemaining: holdRemaining
    };
  }

  const deadline = vault.lastHeartbeatTimestamp + vault.heartbeatIntervalSeconds + vault.gracePeriodSeconds;
  if (currentTimeSec < deadline) {
    const remaining = deadline - currentTimeSec;
    return {
      claimable: false,
      reason: `Timelock not expired (${remaining}s remaining). Owner is still considered active.`,
      secondsRemaining: remaining
    };
  }

  return {
    claimable: true,
    reason: "Timelock mathematically expired on Solana. Beneficiary is authorized to execute on-chain claim.",
    secondsRemaining: 0
  };
}

/**
 * In-memory simulator of the Solana on-chain program state machine
 * used for client testing, LiteSVM/Mollusk invariant assertions and pre-flight validation.
 */
export class SolanaDeadmanVaultSimulator {
  constructor({
    owner,
    beneficiary,
    guardian = null,
    oracleAttestation = null,
    pythPriceFeed = null,
    heartbeatIntervalSeconds,
    gracePeriodSeconds
  }) {
    this.owner = new PublicKey(owner);
    this.beneficiary = new PublicKey(beneficiary);
    this.guardian = guardian ? new PublicKey(guardian) : null;
    this.oracleAttestation = oracleAttestation ? new PublicKey(oracleAttestation) : null;
    this.pythPriceFeed = pythPriceFeed ? new PublicKey(pythPriceFeed) : null;
    this.heartbeatIntervalSeconds = heartbeatIntervalSeconds;
    this.gracePeriodSeconds = gracePeriodSeconds;
    this.lastHeartbeatTimestamp = Math.floor(Date.now() / 1000);
    this.holdUntilTimestamp = 0;
    this.totalHoldSecondsConsumed = 0;
    this.oracleCertificateHash = null;
    this.oracleDisputeUntil = 0;
    this.status = "Active";
    this.lamports = 0;
    this.rentReserveLamports = RENT_RESERVE_MINIMUM_LAMPORTS;
    this.isClosed = false;

    // SPL Tokens state
    this.splTokenBalance = 0;
    this.splTokenMint = null;

    const [pda, bump] = getVaultPda(this.owner);
    this.pda = pda;
    this.bump = bump;
  }

  deposit(lamports, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (this.status === "Triggered") throw new Error("VaultAlreadyTriggered");
    this.lamports += lamports;
    this.lastHeartbeatTimestamp = currentTimestamp;
    return { success: true, newBalance: this.lamports };
  }

  withdraw(lamports, signer) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.owner.equals(signer)) {
      throw new Error("UnauthorizedOwner: Only owner can withdraw funds");
    }
    if (this.status === "Triggered") {
      throw new Error("VaultAlreadyTriggered");
    }
    if (this.status === "OracleDisputePending") {
      throw new Error("OracleDisputeActive");
    }
    // Must preserve rent exemption minimum
    if (this.lamports - lamports < this.rentReserveLamports) {
      throw new Error("InsufficientFunds: Withdrawal violates rent-exemption minimum balance");
    }
    this.lamports -= lamports;
    return { success: true, remainingBalance: this.lamports };
  }

  depositSplTokens(amount, mint, signer, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.owner.equals(signer)) throw new Error("UnauthorizedOwner");
    if (this.status === "Triggered") throw new Error("VaultAlreadyTriggered");
    if (amount <= 0) throw new Error("ZeroDeposit");

    if (this.splTokenMint && !this.splTokenMint.equals(mint)) {
      throw new Error("MismatchedMint: Token mint does not match existing vault mint");
    }
    this.splTokenMint = mint;
    this.splTokenBalance += amount;
    this.lastHeartbeatTimestamp = currentTimestamp;
    return { success: true, newSplBalance: this.splTokenBalance };
  }

  withdrawSplTokens(amount, mint, signer) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.owner.equals(signer)) throw new Error("UnauthorizedOwner");
    if (this.status === "Triggered") throw new Error("VaultAlreadyTriggered");
    if (this.status === "OracleDisputePending") throw new Error("OracleDisputeActive");

    if (!this.splTokenMint || !this.splTokenMint.equals(mint)) {
      throw new Error("MismatchedMint");
    }
    if (this.splTokenBalance < amount) {
      throw new Error("InsufficientFunds: Not enough SPL tokens");
    }
    this.splTokenBalance -= amount;
    return { success: true, remainingSplBalance: this.splTokenBalance };
  }

  ping(signer, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.owner.equals(signer)) {
      throw new Error("UnauthorizedOwner: Signer is not vault owner");
    }
    if (this.status === "Triggered") {
      throw new Error("VaultAlreadyTriggered");
    }
    if (this.status === "GuardianHold" && currentTimestamp < this.holdUntilTimestamp) {
      throw new Error("GuardianHoldActive: Cannot clear active guardian hold before expiration");
    }

    // Proof of life reverts oracle dispute window
    if (this.status === "OracleDisputePending") {
      if (currentTimestamp > this.oracleDisputeUntil) {
        throw new Error("VaultAlreadyTriggered: Dispute expired");
      }
      this.oracleCertificateHash = null;
      this.oracleDisputeUntil = 0;
    }

    this.lastHeartbeatTimestamp = currentTimestamp;
    this.holdUntilTimestamp = 0;
    this.status = "Active";
    return { success: true, timestamp: this.lastHeartbeatTimestamp };
  }

  applyGuardianHold(signer, holdSeconds, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.guardian || !this.guardian.equals(signer)) {
      throw new Error("UnauthorizedGuardian: Signer is not designated guardian");
    }
    if (this.status === "Triggered") {
      throw new Error("VaultAlreadyTriggered");
    }
    if (holdSeconds <= 0 || holdSeconds > 30 * 86400) {
      throw new Error("InvalidHoldDuration: Hold duration must be <= 30 days");
    }

    const newCumulative = this.totalHoldSecondsConsumed + holdSeconds;
    if (newCumulative > 60 * 86400) {
      throw new Error("CumulativeHoldLimitExceeded: Anti-griefing limit of 60 days exceeded");
    }

    this.holdUntilTimestamp = currentTimestamp + holdSeconds;
    this.totalHoldSecondsConsumed = newCumulative;
    this.status = "GuardianHold";
    return { success: true, holdUntil: this.holdUntilTimestamp, cumulative: this.totalHoldSecondsConsumed };
  }

  attestOracleTrigger(signer, certHash, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.oracleAttestation || !this.oracleAttestation.equals(signer)) {
      throw new Error("UnauthorizedOracle: Signer is not authorized legal/medical oracle");
    }
    if (this.status === "Triggered") throw new Error("VaultAlreadyTriggered");
    if (!certHash || certHash.every(b => b === 0)) throw new Error("InvalidCertificateHash");

    this.oracleCertificateHash = certHash;
    this.oracleDisputeUntil = currentTimestamp + 48 * 3600;
    this.status = "OracleDisputePending";
    return { success: true, disputeUntil: this.oracleDisputeUntil };
  }

  updateConfig(signer, { heartbeatInterval, gracePeriod, guardian, oracle, pythFeed }) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.owner.equals(signer)) throw new Error("UnauthorizedOwner");
    if (this.status !== "Active") throw new Error("VaultNotActive: Only active vaults can be reconfigured");

    if (heartbeatInterval !== undefined) {
      if (heartbeatInterval <= 0) throw new Error("InvalidInterval");
      this.heartbeatIntervalSeconds = heartbeatInterval;
    }
    if (gracePeriod !== undefined) {
      if (gracePeriod <= 0) throw new Error("InvalidGracePeriod");
      this.gracePeriodSeconds = gracePeriod;
    }
    if (guardian !== undefined) this.guardian = guardian ? new PublicKey(guardian) : null;
    if (oracle !== undefined) this.oracleAttestation = oracle ? new PublicKey(oracle) : null;
    if (pythFeed !== undefined) this.pythPriceFeed = pythFeed ? new PublicKey(pythFeed) : null;

    return { success: true };
  }

  validatePythPrice(feedData, currentTimestamp = Math.floor(Date.now() / 1000)) {
    const { price, expo, conf, publishTime } = feedData;
    if (currentTimestamp - publishTime > 120) {
      throw new Error("StalePriceFeed: Pyth feed older than 120 seconds");
    }
    if (price <= 0) {
      throw new Error("InvalidPrice: Reported price is non-positive (sign-flip check)");
    }
    const confBps = (conf * 10_000) / price;
    if (confBps > 300) {
      throw new Error(`PriceConfidenceTooWide: Confidence ratio ${confBps} bps exceeds max 300 bps (3%)`);
    }
    const realPrice = price * Math.pow(10, expo);
    return { valid: true, realPrice, confBps };
  }

  claimInheritance(signer, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.beneficiary.equals(signer)) {
      throw new Error("UnauthorizedBeneficiary: Signer is not beneficiary");
    }

    const check = evaluateVaultClaimability(this, currentTimestamp);
    if (!check.claimable) {
      throw new Error(`OnChainRejection: ${check.reason}`);
    }

    this.status = "Triggered";
    const claimable = Math.max(0, this.lamports - this.rentReserveLamports);
    if (claimable === 0 && this.lamports > 0) {
      throw new Error("InsufficientFunds: All remaining lamports are rent-exempt reserve");
    }

    this.lamports -= claimable;

    return {
      success: true,
      claimedLamports: claimable,
      rentRetained: this.lamports,
      beneficiary: this.beneficiary.toBase58(),
      pda: this.pda.toBase58()
    };
  }

  claimSplInheritance(signer, mint, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (this.isClosed) throw new Error("VaultIsClosed");
    if (!this.beneficiary.equals(signer)) {
      throw new Error("UnauthorizedBeneficiary: Signer is not beneficiary");
    }

    // Autonomous Trigger transition
    if (this.status !== "Triggered") {
      const check = evaluateVaultClaimability(this, currentTimestamp);
      if (!check.claimable) {
        throw new Error(`OnChainRejection: ${check.reason}`);
      }
      this.status = "Triggered";
    }

    if (!this.splTokenMint || !this.splTokenMint.equals(mint)) {
      throw new Error("MismatchedMint");
    }
    if (this.splTokenBalance <= 0) {
      throw new Error("NoTokensToClaim");
    }

    const claimedTokens = this.splTokenBalance;
    this.splTokenBalance = 0;

    return {
      success: true,
      claimedTokens,
      beneficiary: this.beneficiary.toBase58()
    };
  }

  closeVault(signer) {
    if (this.isClosed) throw new Error("VaultAlreadyClosed");
    if (!this.beneficiary.equals(signer)) throw new Error("UnauthorizedBeneficiary");
    if (this.status !== "Triggered") throw new Error("VaultNotTriggered: Cannot close until triggered");
    if (this.splTokenBalance > 0) throw new Error("CannotCloseWithActiveTokens");

    const refundedRent = this.lamports;
    this.lamports = 0;
    this.isClosed = true;

    return {
      success: true,
      refundedRent,
      closedPda: this.pda.toBase58()
    };
  }
}
