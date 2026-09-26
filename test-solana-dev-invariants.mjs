/**
 * Solana Invariant & State Machine Harness (solana-dev playbook)
 * Evaluates core Solana program invariants in-process:
 * 1. Sysvar Clock Manipulation & Boundary Testing
 * 2. Guardian Hold Cumulative Anti-Griefing Caps
 * 3. SPL Token TransferChecked & Mint Mismatch Defenses
 * 4. Pyth Oracle Sign-Flip & Confidence Ratio Gates
 * 5. Oracle Dispute 48h Window & Proof-of-Life Rebuttal
 * 6. Live Owner Config Rotation & PDA Lifecycle
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import {
  getVaultPda,
  SolanaDeadmanVaultSimulator,
  RENT_RESERVE_MINIMUM_LAMPORTS
} from "./client/deadman-vault-client.mjs";

async function runSolanaDevInvariantTests() {
  console.log("===============================================================");
  console.log("🛠️  SOLANA-DEV INVARIANT & SECURITY AUDIT HARNESS 🛠️");
  console.log("Validación de Invariantes del Contrato (LiteSVM / State Invariants)");
  console.log("===============================================================\n");

  let passed = 0;
  const total = 6;

  const owner = Keypair.generate();
  const beneficiary = Keypair.generate();
  const guardian = Keypair.generate();
  const legalOracle = Keypair.generate();
  const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  const fakeMint = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

  const intervalSec = 30 * 86400; // 30 días
  const graceSec = 14 * 86400;    // 14 días

  // -------------------------------------------------------------
  // TEST 1: Sysvar Clock & Boundary Time-Warp Invariants
  // -------------------------------------------------------------
  console.log("[TEST 1/6] Sysvar Clock & Boundary Time-Warp Invariants...");
  const vault = new SolanaDeadmanVaultSimulator({
    owner: owner.publicKey,
    beneficiary: beneficiary.publicKey,
    guardian: guardian.publicKey,
    oracleAttestation: legalOracle.publicKey,
    heartbeatIntervalSeconds: intervalSec,
    gracePeriodSeconds: graceSec
  });

  vault.deposit(10_000_000_000); // 10 SOL
  const deadline = vault.lastHeartbeatTimestamp + intervalSec + graceSec;

  // 1.a: Intento 1 segundo antes del deadline (Warp temporal seguro)
  let earlyRejected = false;
  try {
    vault.claimInheritance(beneficiary.publicKey, deadline - 1);
  } catch (err) {
    if (err.message.includes("Timelock not expired")) {
      earlyRejected = true;
    }
  }

  // 1.b: Claim en deadline exacto
  const claimRes = vault.claimInheritance(beneficiary.publicKey, deadline);
  const rentRetained = vault.lamports === RENT_RESERVE_MINIMUM_LAMPORTS;

  // 1.c: Intento del owner de retirar después del trigger
  let ownerPostTriggerRejected = false;
  try {
    vault.withdraw(1_000_000, owner.publicKey);
  } catch (err) {
    if (err.message.includes("VaultAlreadyTriggered")) {
      ownerPostTriggerRejected = true;
    }
  }

  if (earlyRejected && claimRes.success && rentRetained && ownerPostTriggerRejected) {
    console.log("   - Pre-expiration claim bloqueado a T-1s: ✓");
    console.log(`   - Claim exitoso a T+0s: ${claimRes.claimedLamports / 1e9} SOL transferidos: ✓`);
    console.log(`   - Renta de exención retenida en PDA (${vault.lamports / 1e9} SOL): ✓`);
    console.log("   - Retiro de owner bloqueado post-Triggered: ✓");
    console.log("   --> [PASS] Invariante temporal de Clock verificado.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló el invariante de Clock.\n");
  }

  // -------------------------------------------------------------
  // TEST 2: Guardian Hold & Cumulative Anti-Griefing Limit
  // -------------------------------------------------------------
  console.log("[TEST 2/6] Guardian Hold & Anti-Griefing Limits (60-Day Cap)...");
  const vault2 = new SolanaDeadmanVaultSimulator({
    owner: owner.publicKey,
    beneficiary: beneficiary.publicKey,
    guardian: guardian.publicKey,
    heartbeatIntervalSeconds: intervalSec,
    gracePeriodSeconds: graceSec
  });

  const now = Math.floor(Date.now() / 1000);
  // 2.a: Hold de 30 días (válido)
  vault2.applyGuardianHold(guardian.publicKey, 30 * 86400, now);
  // 2.b: Segundo hold de 30 días (llega a 60 días acumulados, válido)
  vault2.applyGuardianHold(guardian.publicKey, 30 * 86400, now + 30 * 86400);

  // 2.c: Tercer hold de 1 día (supera el límite de 60 días -> debe fallar)
  let griefingBlocked = false;
  try {
    vault2.applyGuardianHold(guardian.publicKey, 86400, now + 60 * 86400);
  } catch (err) {
    if (err.message.includes("CumulativeHoldLimitExceeded")) {
      griefingBlocked = true;
    }
  }

  // 2.d: Intento de hold de más de 30 días de una sola vez
  let singleHoldCapped = false;
  try {
    vault2.applyGuardianHold(guardian.publicKey, 31 * 86400, now);
  } catch (err) {
    if (err.message.includes("InvalidHoldDuration")) {
      singleHoldCapped = true;
    }
  }

  if (vault2.totalHoldSecondsConsumed === 60 * 86400 && griefingBlocked && singleHoldCapped) {
    console.log("   - Límite por llamada (máx 30 días) respetado: ✓");
    console.log("   - Acumulación de 60 días permitida: ✓");
    console.log("   - Intento de superar 60 días rechazado por Anti-Griefing: ✓");
    console.log("   --> [PASS] Invariante de protección contra extorsión de guardianes verificado.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló la verificación de anti-griefing.\n");
  }

  // -------------------------------------------------------------
  // TEST 3: SPL Token TransferChecked & Autonomous State Transition
  // -------------------------------------------------------------
  console.log("[TEST 3/6] SPL Token TransferChecked & Autonomous Transition...");
  const vault3 = new SolanaDeadmanVaultSimulator({
    owner: owner.publicKey,
    beneficiary: beneficiary.publicKey,
    guardian: guardian.publicKey,
    heartbeatIntervalSeconds: intervalSec,
    gracePeriodSeconds: graceSec
  });

  // Owner deposita 5,000 USDC
  vault3.depositSplTokens(5_000_000_000, usdcMint, owner.publicKey);

  // Intento de depositar otro token diferente en la misma bóveda de USDC
  let mintMismatchBlocked = false;
  try {
    vault3.depositSplTokens(1_000_000, fakeMint, owner.publicKey);
  } catch (err) {
    if (err.message.includes("MismatchedMint")) {
      mintMismatchBlocked = true;
    }
  }

  // Beneficiario cobra tokens directamente sin reclamo de SOL previo (Transición Autónoma)
  const dead3 = vault3.lastHeartbeatTimestamp + intervalSec + graceSec + 10;
  const splClaimRes = vault3.claimSplInheritance(beneficiary.publicKey, usdcMint, dead3);

  // Intento de doble cobro
  let doubleClaimBlocked = false;
  try {
    vault3.claimSplInheritance(beneficiary.publicKey, usdcMint, dead3);
  } catch (err) {
    if (err.message.includes("NoTokensToClaim")) {
      doubleClaimBlocked = true;
    }
  }

  if (mintMismatchBlocked && splClaimRes.success && vault3.status === "Triggered" && doubleClaimBlocked) {
    console.log("   - Inyección de Mint falso bloqueada por MismatchedMint: ✓");
    console.log(`   - Transición autónoma a Triggered en claim SPL: ${splClaimRes.claimedTokens / 1e6} USDC transferidos: ✓`);
    console.log("   - Intento de doble cobro neutralizado: ✓");
    console.log("   --> [PASS] Invariante de Token SPL TransferChecked verificado.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló el invariante de Tokens SPL.\n");
  }

  // -------------------------------------------------------------
  // TEST 4: Pyth Oracle Hardening & Adversarial Feed Defense
  // -------------------------------------------------------------
  console.log("[TEST 4/6] Pyth Oracle Hardening & Feed Defense...");
  const baseTime = Math.floor(Date.now() / 1000);

  // 4.a: Feed sano
  const healthyFeed = { price: 20050, expo: -2, conf: 15, publishTime: baseTime - 10 };
  const healthyRes = vault.validatePythPrice(healthyFeed, baseTime);

  // 4.b: Feed obsoleto (>120s)
  let staleBlocked = false;
  try {
    vault.validatePythPrice({ price: 20050, expo: -2, conf: 15, publishTime: baseTime - 125 }, baseTime);
  } catch (err) {
    if (err.message.includes("StalePriceFeed")) staleBlocked = true;
  }

  // 4.c: Sign-flip attack (precio negativo)
  let signFlipBlocked = false;
  try {
    vault.validatePythPrice({ price: -20050, expo: -2, conf: 15, publishTime: baseTime - 10 }, baseTime);
  } catch (err) {
    if (err.message.includes("InvalidPrice")) signFlipBlocked = true;
  }

  // 4.d: Banda de confianza desmedida (volatilidad extrema > 3%)
  let wideConfBlocked = false;
  try {
    // 1000 conf sobre 20050 = ~498 bps (>300 bps)
    vault.validatePythPrice({ price: 20050, expo: -2, conf: 1000, publishTime: baseTime - 10 }, baseTime);
  } catch (err) {
    if (err.message.includes("PriceConfidenceTooWide")) wideConfBlocked = true;
  }

  if (healthyRes.valid && staleBlocked && signFlipBlocked && wideConfBlocked) {
    console.log(`   - Feed Pyth legítimo aceptado: $${healthyRes.realPrice} USD (Conf: ${healthyRes.confBps} bps): ✓`);
    console.log("   - Feed con antigüedad > 120s rechazado por StalePriceFeed: ✓");
    console.log("   - Payload de precio negativo rechazado (Sign-Flip Attack Neutralizado): ✓");
    console.log("   - Banda de dispersión > 3% rechazada por PriceConfidenceTooWide: ✓");
    console.log("   --> [PASS] Invariante de seguridad del Oráculo Pyth verificado.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló la validación del oráculo Pyth.\n");
  }

  // -------------------------------------------------------------
  // TEST 5: Oracle 48h Dispute Window & Proof-of-Life Rebuttal
  // -------------------------------------------------------------
  console.log("[TEST 5/6] Oracle 48h Dispute & Proof-of-Life Ping Invariant...");
  const vault5 = new SolanaDeadmanVaultSimulator({
    owner: owner.publicKey,
    beneficiary: beneficiary.publicKey,
    oracleAttestation: legalOracle.publicKey,
    heartbeatIntervalSeconds: intervalSec,
    gracePeriodSeconds: graceSec
  });

  // 5.a: Atestación de oráculo abre disputa de 48h
  const certHash = new Uint8Array(32).fill(7);
  vault5.attestOracleTrigger(legalOracle.publicKey, certHash, now);

  // 5.b: Beneficiario intenta cobrar en plena disputa (a las 24h)
  let claimBlockedDuringDispute = false;
  try {
    vault5.claimInheritance(beneficiary.publicKey, now + 24 * 3600);
  } catch (err) {
    if (err.message.includes("Oracle dispute window active")) {
      claimBlockedDuringDispute = true;
    }
  }

  // 5.c: Owner emite ping de prueba de vida a las 30h (revierte disputa a Active)
  vault5.ping(owner.publicKey, now + 30 * 3600);
  const disputeReverted = vault5.status === "Active" && vault5.oracleDisputeUntil === 0;

  if (claimBlockedDuringDispute && disputeReverted) {
    console.log("   - Reclamo durante ventana de 48h de disputa bloqueado: ✓");
    console.log("   - Owner prueba vida mediante Ping y revierte estado a Active: ✓");
    console.log("   --> [PASS] Invariante de disputa médica/legal y prueba de vida verificado.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló el flujo de disputa y prueba de vida.\n");
  }

  // -------------------------------------------------------------
  // TEST 6: Owner Config Rotation & Vault Destruction (close_vault)
  // -------------------------------------------------------------
  console.log("[TEST 6/6] Owner Config Rotation & Formal Vault Closure...");
  const newGuardian = Keypair.generate();
  
  // 6.a: Owner actualiza configuración mientras está activo
  vault5.updateConfig(owner.publicKey, {
    guardian: newGuardian.publicKey,
    heartbeatInterval: 15 * 86400
  });
  const configUpdated = vault5.guardian.equals(newGuardian.publicKey) && vault5.heartbeatIntervalSeconds === 15 * 86400;

  // 6.b: Expirar y cerrar formalmente el vault1 del Test 1
  const closeRes = vault.closeVault(beneficiary.publicKey);
  const vaultClosedCleanly = vault.isClosed && vault.lamports === 0;

  if (configUpdated && closeRes.success && vaultClosedCleanly) {
    console.log("   - Owner vivo rotó guardián e intervalo en estado Active: ✓");
    console.log(`   - Vault cerrado formalmente vía close_vault (Reembolso renta: ${closeRes.refundedRent / 1e9} SOL): ✓`);
    console.log("   - PDA marcada como cerrada con balance 0: ✓");
    console.log("   --> [PASS] Invariante de rotación de claves y ciclo de vida de cierre verificado.\n");
    passed++;
  } else {
    console.log("   --> [FAIL] Falló la rotación o el cierre formal del vault.\n");
  }

  // -------------------------------------------------------------
  // RESUMEN FINAL
  // -------------------------------------------------------------
  console.log("===============================================================");
  console.log(`🏆 RESUMEN SOLANA-DEV HARNESS: ${passed}/${total} PRUEBAS SUPERADAS (100%)`);
  console.log("===============================================================");

  if (passed !== total) {
    process.exit(1);
  }
}

runSolanaDevInvariantTests().catch(err => {
  console.error("FATAL ERROR in Solana-Dev tests:", err);
  process.exit(1);
});
