/**
 * Solana Dead Man's Switch Vault - Client SDK
 * Provides PDA derivation, on-chain state inspection, and instruction builders.
 */

import { PublicKey } from "@solana/web3.js";

export const DEADMAN_PROGRAM_ID = new PublicKey("E4dA4YrWnMgFv7NNseHjw8r2yikArPGiEnrxX4YYExdX");

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
  const deadline = vault.lastHeartbeatTimestamp + vault.heartbeatIntervalSeconds + vault.gracePeriodSeconds;
  
  if (vault.status === "Triggered") {
    return { claimable: false, reason: "Vault has already been triggered and claimed", secondsRemaining: 0 };
  }

  if (currentTimeSec < vault.holdUntilTimestamp) {
    const holdRemaining = vault.holdUntilTimestamp - currentTimeSec;
    return {
      claimable: false,
      reason: `Guardian emergency hold active (${holdRemaining}s remaining)`,
      secondsRemaining: holdRemaining
    };
  }

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
 * used for client testing and pre-flight validation.
 */
export class SolanaDeadmanVaultSimulator {
  constructor({ owner, beneficiary, guardian = null, heartbeatIntervalSeconds, gracePeriodSeconds }) {
    this.owner = new PublicKey(owner);
    this.beneficiary = new PublicKey(beneficiary);
    this.guardian = guardian ? new PublicKey(guardian) : null;
    this.heartbeatIntervalSeconds = heartbeatIntervalSeconds;
    this.gracePeriodSeconds = gracePeriodSeconds;
    this.lastHeartbeatTimestamp = Math.floor(Date.now() / 1000);
    this.holdUntilTimestamp = 0;
    this.status = "Active";
    this.lamports = 0;

    const [pda, bump] = getVaultPda(this.owner);
    this.pda = pda;
    this.bump = bump;
  }

  deposit(lamports, currentTimestamp = Math.floor(Date.now() / 1000)) {
    this.lamports += lamports;
    this.lastHeartbeatTimestamp = currentTimestamp;
    return { success: true, newBalance: this.lamports };
  }

  withdraw(lamports, signer) {
    if (!this.owner.equals(signer)) {
      throw new Error("Unauthorized: Only owner can withdraw funds");
    }
    if (this.lamports < lamports) {
      throw new Error("InsufficientFunds in vault PDA");
    }
    this.lamports -= lamports;
    return { success: true, remainingBalance: this.lamports };
  }

  ping(signer, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (!this.owner.equals(signer)) {
      throw new Error("UnauthorizedOwner: Signer is not vault owner");
    }
    if (this.status === "Triggered") {
      throw new Error("VaultAlreadyTriggered");
    }
    this.lastHeartbeatTimestamp = currentTimestamp;
    this.holdUntilTimestamp = 0;
    this.status = "Active";
    return { success: true, timestamp: this.lastHeartbeatTimestamp };
  }

  applyGuardianHold(signer, holdSeconds, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (!this.guardian || !this.guardian.equals(signer)) {
      throw new Error("UnauthorizedGuardian: Signer is not designated guardian");
    }
    this.holdUntilTimestamp = currentTimestamp + holdSeconds;
    this.status = "GuardianHold";
    return { success: true, holdUntil: this.holdUntilTimestamp };
  }

  claimInheritance(signer, currentTimestamp = Math.floor(Date.now() / 1000)) {
    if (!this.beneficiary.equals(signer)) {
      throw new Error("UnauthorizedBeneficiary: Signer is not beneficiary");
    }

    const check = evaluateVaultClaimability(this, currentTimestamp);
    if (!check.claimable) {
      throw new Error(`OnChainRejection: ${check.reason}`);
    }

    const claimedLamports = this.lamports;
    this.lamports = 0;
    this.status = "Triggered";

    return {
      success: true,
      claimedLamports,
      beneficiary: this.beneficiary.toBase58(),
      pda: this.pda.toBase58()
    };
  }
}
